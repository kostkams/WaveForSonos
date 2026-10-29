/// <reference types="jest" />
import { buildDidl, buildEnvelope, parseDidl } from '..';
import { xmlParser } from '../xml';

const track = {
  id: 'yt:dQw4w9WgXcQ',
  title: 'Rock & Roll <Live> "2024"',
  artist: "Guns N' Roses",
  album: 'Live & Loud',
  artworkUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?a=1&b=2',
  streamUrl: 'http://192.168.1.50:8080/stream/dQw4w9WgXcQ?fmt=m4a&t=1',
  mimeType: 'audio/mp4',
  durationSec: 213,
};

describe('buildDidl', () => {
  it('produces Sonos-compatible DIDL-Lite', () => {
    const xml = buildDidl(track);
    expect(xml.startsWith('<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"')).toBe(true);
    expect(xml).toContain('xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"');
    expect(xml).toContain('xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"');
    expect(xml).toContain('xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"');
    expect(xml).toContain('<item id="yt:dQw4w9WgXcQ" parentID="-1" restricted="true">');
    expect(xml).toContain(
      '<res protocolInfo="http-get:*:audio/mp4:*" duration="0:03:33">' +
        'http://192.168.1.50:8080/stream/dQw4w9WgXcQ?fmt=m4a&amp;t=1</res>',
    );
    expect(xml).toContain('<dc:title>Rock &amp; Roll &lt;Live&gt; &quot;2024&quot;</dc:title>');
    expect(xml).toContain('<dc:creator>Guns N&apos; Roses</dc:creator>');
    expect(xml).toContain('<upnp:album>Live &amp; Loud</upnp:album>');
    expect(xml).toContain(
      '<upnp:albumArtURI>https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?a=1&amp;b=2</upnp:albumArtURI>',
    );
    expect(xml).toContain('<upnp:class>object.item.audioItem.musicTrack</upnp:class>');
    expect(xml.endsWith('</item></DIDL-Lite>')).toBe(true);
    // well-formed
    expect(() => xmlParser.parse(xml)).not.toThrow();
  });

  it('omits duration / album / art when unknown', () => {
    const xml = buildDidl({ ...track, durationSec: undefined, album: undefined, artworkUrl: undefined });
    expect(xml).toContain('<res protocolInfo="http-get:*:audio/mp4:*">');
    expect(xml).not.toContain('duration=');
    expect(xml).not.toContain('upnp:album>');
    expect(xml).not.toContain('albumArtURI');
  });

  it('is escaped exactly twice once embedded in a SOAP argument', () => {
    const env = buildEnvelope('AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: track.streamUrl,
      CurrentURIMetaData: buildDidl(track),
    });
    expect(env).toContain('&lt;dc:title&gt;Rock &amp;amp; Roll &amp;lt;Live&amp;gt;');
    expect(env).not.toContain('&amp;amp;amp;');
    // The device decodes the SOAP layer once and must get our DIDL back verbatim
    const doc: any = xmlParser.parse(env);
    expect(doc.Envelope.Body.SetAVTransportURI.CurrentURIMetaData).toBe(buildDidl(track));
    expect(doc.Envelope.Body.SetAVTransportURI.CurrentURI).toBe(track.streamUrl);
  });
});

describe('parseDidl', () => {
  it('round-trips buildDidl', () => {
    expect(parseDidl(buildDidl(track))).toEqual({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      streamContent: null,
    });
  });

  it('parses typical Sonos TrackMetaData and resolves relative art', () => {
    const xml =
      '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
      'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
      '<item id="-1" parentID="-1" restricted="true"><res protocolInfo="sonos.com-http:*:audio/mpeg:*" duration="0:04:01">' +
      'x-sonos-http:track.mp3?sid=2</res><r:streamContent></r:streamContent>' +
      '<upnp:albumArtURI>/getaa?s=1&amp;u=x-sonos-http%3atrack.mp3</upnp:albumArtURI>' +
      '<dc:title>Song</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
      '<dc:creator>Band</dc:creator><upnp:album>Record</upnp:album></item></DIDL-Lite>';
    expect(parseDidl(xml, 'http://192.168.1.20:1400')).toEqual({
      title: 'Song',
      artist: 'Band',
      album: 'Record',
      artworkUrl: 'http://192.168.1.20:1400/getaa?s=1&u=x-sonos-http%3atrack.mp3',
      streamContent: null,
    });
  });

  it('returns null for empty / NOT_IMPLEMENTED / garbage', () => {
    expect(parseDidl('')).toBeNull();
    expect(parseDidl(null)).toBeNull();
    expect(parseDidl('NOT_IMPLEMENTED')).toBeNull();
    expect(parseDidl('<foo/>')).toBeNull();
  });
});
