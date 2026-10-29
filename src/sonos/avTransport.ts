import { parseDidl, ParsedDidl } from './didl';
import { soapCall } from './soap';
import { parseHms, toHms } from './time';

const I = { InstanceID: 0 } as const;

export type TransportState =
  | 'PLAYING'
  | 'PAUSED_PLAYBACK'
  | 'STOPPED'
  | 'TRANSITIONING'
  | 'NO_MEDIA_PRESENT';

export interface PositionInfo {
  /** Track number in queue (0 when none / not a queue). */
  track: number;
  durationSec: number | null;
  positionSec: number | null;
  uri: string;
  metadata: ParsedDidl | null;
}

export interface TransportInfo {
  state: TransportState;
  status: string;
}

export interface MediaInfo {
  currentUri: string;
  nextUri: string;
  numberOfTracks: number;
}

const av = (ip: string, action: string, args: Record<string, string | number> = {}) =>
  soapCall(ip, 'AVTransport', action, { ...I, ...args });

/** Set the current transport URI. `metadata` is a raw (unescaped) DIDL-Lite string or ''. */
export async function setUri(ip: string, uri: string, metadata = ''): Promise<void> {
  await av(ip, 'SetAVTransportURI', { CurrentURI: uri, CurrentURIMetaData: metadata });
}

/** Set the gapless "next" URI. */
export async function setNextUri(ip: string, uri: string, metadata = ''): Promise<void> {
  await av(ip, 'SetNextAVTransportURI', { NextURI: uri, NextURIMetaData: metadata });
}

/** Empty the gapless "next" slot so nothing follows the current track. */
export async function clearNextUri(ip: string): Promise<void> {
  await setNextUri(ip, '', '');
}

export async function play(ip: string): Promise<void> {
  await av(ip, 'Play', { Speed: 1 });
}

export async function pause(ip: string): Promise<void> {
  await av(ip, 'Pause');
}

export async function stop(ip: string): Promise<void> {
  await av(ip, 'Stop');
}

export async function next(ip: string): Promise<void> {
  await av(ip, 'Next');
}

export async function previous(ip: string): Promise<void> {
  await av(ip, 'Previous');
}

/** Seek within the current track (REL_TIME). */
export async function seek(ip: string, seconds: number): Promise<void> {
  await av(ip, 'Seek', { Unit: 'REL_TIME', Target: toHms(seconds) });
}

export async function getPositionInfo(ip: string): Promise<PositionInfo> {
  const r = await av(ip, 'GetPositionInfo');
  const track = Number(r.Track);
  return {
    track: Number.isFinite(track) ? track : 0,
    durationSec: parseHms(r.TrackDuration),
    positionSec: parseHms(r.RelTime),
    uri: r.TrackURI ?? '',
    metadata: parseDidl(r.TrackMetaData, `http://${ip}:1400`),
  };
}

const STATES: TransportState[] = [
  'PLAYING',
  'PAUSED_PLAYBACK',
  'STOPPED',
  'TRANSITIONING',
  'NO_MEDIA_PRESENT',
];

export async function getTransportInfo(ip: string): Promise<TransportInfo> {
  const r = await av(ip, 'GetTransportInfo');
  const raw = (r.CurrentTransportState ?? '').toUpperCase() as TransportState;
  return {
    state: STATES.includes(raw) ? raw : 'STOPPED',
    status: r.CurrentTransportStatus ?? '',
  };
}

export async function getMediaInfo(ip: string): Promise<MediaInfo> {
  const r = await av(ip, 'GetMediaInfo');
  const n = Number(r.NrTracks);
  return {
    currentUri: r.CurrentURI ?? '',
    nextUri: r.NextURI ?? '',
    numberOfTracks: Number.isFinite(n) ? n : 0,
  };
}

/** Make `memberIp` join the group coordinated by `coordinatorUuid` (e.g. "RINCON_000E58...01400"). */
export async function joinGroup(memberIp: string, coordinatorUuid: string): Promise<void> {
  await setUri(memberIp, `x-rincon:${coordinatorUuid}`, '');
}

/** Remove the speaker from its group, making it a standalone coordinator. */
export async function leaveGroup(ip: string): Promise<void> {
  await av(ip, 'BecomeCoordinatorOfStandaloneGroup');
}
