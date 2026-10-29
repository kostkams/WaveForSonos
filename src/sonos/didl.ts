import { toHms } from './time';
import { asArray, escapeXml, textOf, xmlParser } from './xml';

export interface DidlTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  streamUrl: string;
  mimeType: string;
  durationSec?: number;
}

export interface ParsedDidl {
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  /** Sonos' r:streamContent (radio "now playing" text), if present. */
  streamContent: string | null;
}

/**
 * Build a single-item DIDL-Lite document for SetAVTransportURI / SetNextAVTransportURI.
 * Values are XML-escaped once here; the SOAP layer escapes the whole document again
 * when embedding it as the CurrentURIMetaData argument (that is the expected double escaping).
 */
export function buildDidl(track: DidlTrack): string {
  const e = escapeXml;
  const durationAttr =
    track.durationSec != null && Number.isFinite(track.durationSec) && track.durationSec > 0
      ? ` duration="${toHms(track.durationSec)}"`
      : '';
  const parts = [
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"' +
      ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"' +
      ' xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"' +
      ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">',
    `<item id="${e(track.id)}" parentID="-1" restricted="true">`,
    `<res protocolInfo="http-get:*:${e(track.mimeType)}:*"${durationAttr}>${e(track.streamUrl)}</res>`,
    `<dc:title>${e(track.title)}</dc:title>`,
    `<dc:creator>${e(track.artist)}</dc:creator>`,
    `<upnp:artist>${e(track.artist)}</upnp:artist>`,
  ];
  if (track.album) parts.push(`<upnp:album>${e(track.album)}</upnp:album>`);
  if (track.artworkUrl) parts.push(`<upnp:albumArtURI>${e(track.artworkUrl)}</upnp:albumArtURI>`);
  parts.push('<upnp:class>object.item.audioItem.musicTrack</upnp:class>', '</item>', '</DIDL-Lite>');
  return parts.join('');
}

function nonEmpty(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

/**
 * Parse DIDL-Lite metadata (e.g. TrackMetaData from GetPositionInfo).
 * Returns null for empty input, "NOT_IMPLEMENTED" or unparseable XML.
 * Relative album art URIs (e.g. "/getaa?...") are resolved against `baseUrl`
 * (e.g. "http://192.168.1.20:1400") when given.
 */
export function parseDidl(xml: string | null | undefined, baseUrl?: string): ParsedDidl | null {
  if (!xml) return null;
  const trimmed = xml.trim();
  if (!trimmed || trimmed === 'NOT_IMPLEMENTED' || !trimmed.startsWith('<')) return null;
  let doc: any;
  try {
    doc = xmlParser.parse(trimmed);
  } catch {
    return null;
  }
  const root = doc?.['DIDL-Lite'];
  if (!root || typeof root !== 'object') return null;
  const item = asArray(root.item ?? root.container)[0];
  if (!item || typeof item !== 'object') return null;

  const first = (v: unknown) => textOf(asArray(v as unknown[])[0]);
  let artworkUrl = nonEmpty(first(item.albumArtURI));
  if (artworkUrl && artworkUrl.startsWith('/') && baseUrl) {
    artworkUrl = baseUrl.replace(/\/+$/, '') + artworkUrl;
  }
  return {
    title: nonEmpty(first(item.title)),
    artist: nonEmpty(first(item.creator)) ?? nonEmpty(first(item.artist)) ?? nonEmpty(first(item.albumArtist)),
    album: nonEmpty(first(item.album)),
    artworkUrl,
    streamContent: nonEmpty(first(item.streamContent)),
  };
}
