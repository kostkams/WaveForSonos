/// <reference types="jest" />
import {
  buildDidl,
  getMediaInfo,
  getPositionInfo,
  getTransportInfo,
  joinGroup,
  leaveGroup,
  play,
  seek,
  setGroupVolume,
  setNextUri,
  setUri,
  setVolume,
} from '..';
import { AVT, esc, GRC, mockFetch, RC, soapResponse } from '../__fixtures__/helpers';

const IP = '192.168.1.20';
const action = (c: { init: RequestInit }) =>
  (c.init.headers as Record<string, string>).SOAPACTION.replace(/"/g, '').split('#')[1];

describe('AVTransport', () => {
  it('setUri sends InstanceID 0, URI and escaped metadata', async () => {
    const calls = mockFetch({ body: soapResponse('SetAVTransportURI', AVT, '') });
    const didl = buildDidl({
      id: 'x',
      title: 'A & B',
      artist: 'C',
      streamUrl: 'http://p/s?a=1&b=2',
      mimeType: 'audio/mp4',
    });
    await setUri(IP, 'http://p/s?a=1&b=2', didl);
    const body = calls[0].init.body as string;
    expect(action(calls[0])).toBe('SetAVTransportURI');
    expect(body).toContain('<InstanceID>0</InstanceID><CurrentURI>http://p/s?a=1&amp;b=2</CurrentURI>');
    expect(body).toContain(`<CurrentURIMetaData>${esc(didl)}</CurrentURIMetaData>`);
  });

  it('setNextUri uses NextURI args', async () => {
    const calls = mockFetch({ body: soapResponse('SetNextAVTransportURI', AVT, '') });
    await setNextUri(IP, 'http://p/2', '');
    expect(calls[0].init.body).toContain('<InstanceID>0</InstanceID><NextURI>http://p/2</NextURI><NextURIMetaData></NextURIMetaData>');
  });

  it('play sends Speed 1; seek uses REL_TIME H:MM:SS', async () => {
    const calls = mockFetch({ body: soapResponse('Play', AVT, '') }, { body: soapResponse('Seek', AVT, '') });
    await play(IP);
    await seek(IP, 3725);
    expect(calls[0].init.body).toContain('<InstanceID>0</InstanceID><Speed>1</Speed>');
    expect(calls[1].init.body).toContain('<Unit>REL_TIME</Unit><Target>1:02:05</Target>');
  });

  it('getPositionInfo parses times and metadata', async () => {
    const meta =
      '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
      'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
      '<item id="-1" parentID="-1" restricted="true"><res protocolInfo="http-get:*:audio/mp4:*" duration="0:03:33">http://p/s</res>' +
      '<dc:title>Never &amp; Ever</dc:title><dc:creator>Rick</dc:creator>' +
      '<upnp:albumArtURI>https://img/x.jpg</upnp:albumArtURI>' +
      '<upnp:class>object.item.audioItem.musicTrack</upnp:class></item></DIDL-Lite>';
    mockFetch({
      body: soapResponse(
        'GetPositionInfo',
        AVT,
        `<Track>1</Track><TrackDuration>0:03:33</TrackDuration><TrackMetaData>${esc(meta)}</TrackMetaData>` +
          '<TrackURI>http://p/s?a=1&amp;b=2</TrackURI><RelTime>0:01:05</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime>' +
          '<RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount>',
      ),
    });
    const info = await getPositionInfo(IP);
    expect(info).toEqual({
      track: 1,
      durationSec: 213,
      positionSec: 65,
      uri: 'http://p/s?a=1&b=2',
      metadata: {
        title: 'Never & Ever',
        artist: 'Rick',
        album: null,
        artworkUrl: 'https://img/x.jpg',
        streamContent: null,
      },
    });
  });

  it('getPositionInfo handles idle player', async () => {
    mockFetch({
      body: soapResponse(
        'GetPositionInfo',
        AVT,
        '<Track>0</Track><TrackDuration>NOT_IMPLEMENTED</TrackDuration><TrackMetaData>NOT_IMPLEMENTED</TrackMetaData>' +
          '<TrackURI></TrackURI><RelTime>NOT_IMPLEMENTED</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime>',
      ),
    });
    expect(await getPositionInfo(IP)).toEqual({
      track: 0,
      durationSec: null,
      positionSec: null,
      uri: '',
      metadata: null,
    });
  });

  it('getPositionInfo treats 0:00:00 as zero', async () => {
    mockFetch({
      body: soapResponse(
        'GetPositionInfo',
        AVT,
        '<Track>1</Track><TrackDuration>0:00:00</TrackDuration><TrackMetaData></TrackMetaData>' +
          '<TrackURI>x-rincon-mp3radio://a</TrackURI><RelTime>0:00:00</RelTime>',
      ),
    });
    const info = await getPositionInfo(IP);
    expect(info.durationSec).toBe(0);
    expect(info.positionSec).toBe(0);
    expect(info.metadata).toBeNull();
  });

  it('getTransportInfo / getMediaInfo', async () => {
    mockFetch(
      {
        body: soapResponse(
          'GetTransportInfo',
          AVT,
          '<CurrentTransportState>PAUSED_PLAYBACK</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>',
        ),
      },
      {
        body: soapResponse(
          'GetMediaInfo',
          AVT,
          '<NrTracks>1</NrTracks><MediaDuration>NOT_IMPLEMENTED</MediaDuration><CurrentURI>http://p/1</CurrentURI>' +
            '<CurrentURIMetaData></CurrentURIMetaData><NextURI>http://p/2</NextURI><NextURIMetaData></NextURIMetaData>',
        ),
      },
    );
    expect(await getTransportInfo(IP)).toEqual({ state: 'PAUSED_PLAYBACK', status: 'OK' });
    expect(await getMediaInfo(IP)).toEqual({ currentUri: 'http://p/1', nextUri: 'http://p/2', numberOfTracks: 1 });
  });

  it('joinGroup / leaveGroup', async () => {
    const calls = mockFetch(
      { body: soapResponse('SetAVTransportURI', AVT, '') },
      { body: soapResponse('BecomeCoordinatorOfStandaloneGroup', AVT, '') },
    );
    await joinGroup('192.168.1.21', 'RINCON_000E58A0123401400');
    await leaveGroup('192.168.1.21');
    expect(calls[0].url).toBe('http://192.168.1.21:1400/MediaRenderer/AVTransport/Control');
    expect(calls[0].init.body).toContain('<CurrentURI>x-rincon:RINCON_000E58A0123401400</CurrentURI>');
    expect(action(calls[1])).toBe('BecomeCoordinatorOfStandaloneGroup');
    expect(calls[1].init.body).toContain('<InstanceID>0</InstanceID>');
  });
});

describe('Rendering', () => {
  it('setVolume clamps and uses Channel Master', async () => {
    const calls = mockFetch({ body: soapResponse('SetVolume', RC, '') });
    await setVolume(IP, 140);
    expect(calls[0].init.body).toContain(
      '<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>100</DesiredVolume>',
    );
  });

  it('setGroupVolume snapshots first', async () => {
    const calls = mockFetch(
      { body: soapResponse('SnapshotGroupVolume', GRC, '') },
      { body: soapResponse('SetGroupVolume', GRC, '') },
    );
    await setGroupVolume(IP, 33.4);
    expect(calls.map(action)).toEqual(['SnapshotGroupVolume', 'SetGroupVolume']);
    expect(calls[1].url).toBe(`http://${IP}:1400/MediaRenderer/GroupRenderingControl/Control`);
    expect(calls[1].init.body).toContain('<InstanceID>0</InstanceID><DesiredVolume>33</DesiredVolume>');
  });
});
