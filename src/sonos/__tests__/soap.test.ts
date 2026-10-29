/// <reference types="jest" />
import { buildEnvelope, soapCall, SonosError } from '..';
import { AVT, mockFetch, RC, soapFault, soapResponse } from '../__fixtures__/helpers';

describe('soapCall', () => {
  afterEach(() => jest.useRealTimers());

  it('posts a well-formed envelope with SOAPACTION header to port 1400', async () => {
    const calls = mockFetch({ body: soapResponse('GetVolume', RC, '<CurrentVolume>23</CurrentVolume>') });
    const out = await soapCall('192.168.1.10', 'RenderingControl', 'GetVolume', {
      InstanceID: 0,
      Channel: 'Master',
    });
    expect(out).toEqual({ CurrentVolume: '23' });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('http://192.168.1.10:1400/MediaRenderer/RenderingControl/Control');
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('text/xml; charset="utf-8"');
    expect(headers.SOAPACTION).toBe(`"${RC}#GetVolume"`);
    expect(init.signal).toBeDefined();
    const body = init.body as string;
    expect(body.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(body).toContain('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(body).toContain('s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"');
    expect(body).toContain(
      `<s:Body><u:GetVolume xmlns:u="${RC}"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume></s:Body>`,
    );
  });

  it('uses correct endpoints per service', async () => {
    const ok = (a: string) => ({ body: soapResponse(a, '', '') });
    const calls = mockFetch(ok('Play'), ok('GetGroupVolume'), ok('GetZoneGroupState'));
    await soapCall('1.2.3.4', 'AVTransport', 'Play');
    await soapCall('1.2.3.4', 'GroupRenderingControl', 'GetGroupVolume');
    await soapCall('1.2.3.4', 'ZoneGroupTopology', 'GetZoneGroupState');
    expect(calls.map((c) => c.url)).toEqual([
      'http://1.2.3.4:1400/MediaRenderer/AVTransport/Control',
      'http://1.2.3.4:1400/MediaRenderer/GroupRenderingControl/Control',
      'http://1.2.3.4:1400/ZoneGroupTopology/Control',
    ]);
  });

  it('escapes argument values', () => {
    const env = buildEnvelope('AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: 'http://x/a?b=1&c=2',
      CurrentURIMetaData: '<DIDL-Lite a="1">Tom & "Jerry"</DIDL-Lite>',
    });
    expect(env).toContain('<CurrentURI>http://x/a?b=1&amp;c=2</CurrentURI>');
    expect(env).toContain(
      '<CurrentURIMetaData>&lt;DIDL-Lite a=&quot;1&quot;&gt;Tom &amp; &quot;Jerry&quot;&lt;/DIDL-Lite&gt;</CurrentURIMetaData>',
    );
  });

  it('decodes entity-escaped response values', async () => {
    mockFetch({
      body: soapResponse('GetMediaInfo', AVT, '<CurrentURI>http://x/?a=1&amp;b=2</CurrentURI><NextURI></NextURI>'),
    });
    const out = await soapCall('1.2.3.4', 'AVTransport', 'GetMediaInfo', { InstanceID: 0 });
    expect(out.CurrentURI).toBe('http://x/?a=1&b=2');
    expect(out.NextURI).toBe('');
  });

  it('throws a typed SonosError on UPnP faults', async () => {
    mockFetch({ status: 500, body: soapFault(701) });
    const err = await soapCall('1.2.3.4', 'AVTransport', 'Play', { InstanceID: 0, Speed: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.kind).toBe('upnp');
    expect(err.code).toBe(701);
    expect(err.description).toBe('Transition not available');
    expect(err.isTransitionNotAvailable).toBe(true);
    expect(err.action).toBe('Play');
    expect(err.ip).toBe('1.2.3.4');
  });

  it('prefers the device-provided errorDescription and maps 714 / 800', async () => {
    mockFetch({ status: 500, body: soapFault(714, 'Bad MIME') }, { status: 500, body: soapFault(800) });
    const e1 = await soapCall('1.2.3.4', 'AVTransport', 'SetAVTransportURI').catch((e) => e);
    expect(e1.code).toBe(714);
    expect(e1.description).toBe('Bad MIME');
    expect(e1.isIllegalMimeType).toBe(true);
    const e2 = await soapCall('1.2.3.4', 'AVTransport', 'Play').catch((e) => e);
    expect(e2.code).toBe(800);
    expect(e2.isNotCoordinator).toBe(true);
  });

  it('throws an http SonosError for non-SOAP error responses', async () => {
    mockFetch({ status: 404, body: 'Not found' });
    const err = await soapCall('1.2.3.4', 'AVTransport', 'Play').catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.kind).toBe('http');
    expect(err.code).toBe(404);
  });

  it('wraps network errors', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const err = await soapCall('1.2.3.4', 'AVTransport', 'Play').catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.kind).toBe('network');
  });

  it('times out via AbortController after 5 s', async () => {
    jest.useFakeTimers();
    (globalThis as any).fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            rej(e);
          });
        }),
    );
    const p = soapCall('1.2.3.4', 'AVTransport', 'Play').catch((e) => e);
    jest.advanceTimersByTime(5000);
    const err = await p;
    expect(err).toBeInstanceOf(SonosError);
    expect(err.kind).toBe('timeout');
  });
});
