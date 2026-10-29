/// <reference types="jest" />
export interface Captured {
  url: string;
  init: RequestInit;
}

export function soapResponse(action: string, urn: string, inner: string): string {
  return (
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action}Response xmlns:u="${urn}">${inner}</u:${action}Response>` +
    '</s:Body></s:Envelope>'
  );
}

export function soapFault(code: number, description?: string): string {
  return (
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><s:Fault>' +
    '<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>' +
    '<UPnPError xmlns="urn:schemas-upnp-org:control-1-0">' +
    `<errorCode>${code}</errorCode>` +
    (description ? `<errorDescription>${description}</errorDescription>` : '') +
    '</UPnPError></detail></s:Fault></s:Body></s:Envelope>'
  );
}

/** Install a fetch mock answering each call with the next queued (status, body). */
export function mockFetch(...responses: { status?: number; body: string }[]): Captured[] {
  const calls: Captured[] = [];
  const queue = [...responses];
  (globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = queue.shift() ?? { status: 200, body: '' };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => r.body,
    } as unknown as Response;
  });
  return calls;
}

/** Minimal XML escaping for building fixtures (mirrors what a Sonos device sends). */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
export const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
export const GRC = 'urn:schemas-upnp-org:service:GroupRenderingControl:1';
export const ZGT = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1';
