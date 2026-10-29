import { describeUpnpError, SonosError } from './errors';
import { escapeXml, textOf, xmlParser } from './xml';

export type SonosService =
  | 'AVTransport'
  | 'RenderingControl'
  | 'GroupRenderingControl'
  | 'ZoneGroupTopology';

export const SONOS_PORT = 1400;
export const DEFAULT_TIMEOUT_MS = 5000;

export const SERVICES: Record<SonosService, { path: string; urn: string }> = {
  AVTransport: {
    path: '/MediaRenderer/AVTransport/Control',
    urn: 'urn:schemas-upnp-org:service:AVTransport:1',
  },
  RenderingControl: {
    path: '/MediaRenderer/RenderingControl/Control',
    urn: 'urn:schemas-upnp-org:service:RenderingControl:1',
  },
  GroupRenderingControl: {
    path: '/MediaRenderer/GroupRenderingControl/Control',
    urn: 'urn:schemas-upnp-org:service:GroupRenderingControl:1',
  },
  ZoneGroupTopology: {
    path: '/ZoneGroupTopology/Control',
    urn: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1',
  },
};

export type SoapArgs = Record<string, string | number | boolean>;

export interface SoapOptions {
  timeoutMs?: number;
}

/**
 * Build the SOAP envelope. Argument values are XML-escaped exactly once here —
 * callers pass raw strings (e.g. a DIDL-Lite document), never pre-escaped ones.
 * Argument order is preserved (UPnP devices may be order-sensitive).
 */
export function buildEnvelope(service: SonosService, action: string, args: SoapArgs): string {
  const urn = SERVICES[service].urn;
  const body = Object.entries(args)
    .map(([k, v]) => `<${k}>${escapeXml(String(typeof v === 'boolean' ? (v ? 1 : 0) : v))}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${urn}">${body}</u:${action}></s:Body>` +
    '</s:Envelope>'
  );
}

function hostFor(ip: string): string {
  // Allow "ip" or "ip:port"
  return ip.includes(':') ? ip : `${ip}:${SONOS_PORT}`;
}

/** Parse a SOAP fault body into a SonosError (or null if it isn't one). */
export function parseSoapFault(xml: string, action?: string, ip?: string): SonosError | null {
  let doc: any;
  try {
    doc = xmlParser.parse(xml);
  } catch {
    return null;
  }
  const fault = doc?.Envelope?.Body?.Fault;
  if (!fault) return null;
  const upnp = fault?.detail?.UPnPError;
  const codeStr = textOf(upnp?.errorCode);
  const code = codeStr && /^\d+$/.test(codeStr) ? Number(codeStr) : null;
  const description =
    textOf(upnp?.errorDescription) ||
    (code != null ? describeUpnpError(code) : undefined) ||
    textOf(fault?.faultstring) ||
    'UPnP error';
  return new SonosError({ kind: 'upnp', code, description, action, ip });
}

/** Parse a successful response's `<u:ActionResponse>` children into a flat string map. */
export function parseSoapResponse(xml: string, action: string): Record<string, string> {
  const doc: any = xmlParser.parse(xml);
  const body = doc?.Envelope?.Body;
  if (!body) {
    throw new SonosError({ kind: 'parse', description: 'Missing SOAP body', action });
  }
  const resp = body[`${action}Response`];
  const out: Record<string, string> = {};
  if (resp && typeof resp === 'object') {
    for (const [k, v] of Object.entries(resp)) {
      if (k.startsWith('@_')) continue;
      out[k] = textOf(v);
    }
  }
  return out;
}

/**
 * Perform a UPnP SOAP call against a Sonos player (port 1400).
 * Returns the response's out-arguments as strings (entity-decoded).
 * Throws SonosError on UPnP faults, HTTP errors, timeouts and network failures.
 */
export async function soapCall(
  ip: string,
  service: SonosService,
  action: string,
  args: SoapArgs = {},
  options: SoapOptions = {},
): Promise<Record<string, string>> {
  const { path, urn } = SERVICES[service];
  const url = `http://${hostFor(ip)}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${urn}#${action}"`,
      },
      body: buildEnvelope(service, action, args),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (e: any) {
    if (controller.signal.aborted || e?.name === 'AbortError') {
      throw new SonosError({ kind: 'timeout', description: 'Request timed out', action, ip });
    }
    throw new SonosError({
      kind: 'network',
      description: e?.message ? `Network error: ${e.message}` : 'Network error',
      action,
      ip,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const fault = parseSoapFault(text, action, ip);
    if (fault) throw fault;
    throw new SonosError({
      kind: 'http',
      code: res.status,
      description: `HTTP ${res.status}`,
      action,
      ip,
    });
  }

  try {
    return parseSoapResponse(text, action);
  } catch (e) {
    if (e instanceof SonosError) throw e;
    throw new SonosError({ kind: 'parse', description: 'Invalid SOAP response', action, ip });
  }
}
