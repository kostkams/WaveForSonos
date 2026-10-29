import { AppState } from 'react-native';

import { Native, type MediaItem } from '@/native';
import * as sonos from '@/sonos';
import { useHistory } from '@/state/historyStore';
import { currentItem, toQueueItem, usePlayer, type QueueItem } from '@/state/playerStore';
import { useSettings } from '@/state/settingsStore';
import { useSpeakers } from '@/state/speakerStore';
import { isLocal, isPlayable, localArtName } from '@/util/media';
import { currentTargetIp, ensureTargetIp, errorText, onLeadChange, refreshVolumes } from './speakers';
import { initVolumeKeys, lastKeyAt, resetRemoteVolumeSync } from './volumeKeys';

const player = () => usePlayer.getState();

let baseUrl: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Set when the user stopped/paused on purpose, so a STOPPED state is not treated as track end. */
let userStopped = false;
let lastState: sonos.TransportState | null = null;
/** Index whose stream is queued on Sonos via SetNextAVTransportURI */
let nextQueuedFor: string | null = null;
/** True while Sonos' "next" slot may hold one of our tracks (so it has to be emptied when nothing follows). */
let sonosHasNext = false;
/** Bumped by every playIndex call; a call whose token is outdated was superseded and stops. */
let playGen = 0;
/** Number of playIndex calls in flight; polling ignores the speaker meanwhile (it is briefly STOPPED). */
let transitioning = 0;
/** Bumped on every transport command, so a poll answer from before it is thrown away. */
let transportSeq = 0;
/** Start offset (s) of the current stream: AAC compatibility streams restart at ?start=N, Sonos counts from 0. */
let streamOffset = 0;

async function proxyBase(): Promise<string> {
  if (!baseUrl) {
    const info = await Native.startProxy();
    baseUrl = info.baseUrl;
    // Service (re)started: hand it the current volume so the hardware keys work right away.
    resetRemoteVolumeSync();
    void refreshVolumes();
  }
  return baseUrl;
}

/** Forget the proxy address (e.g. after a Wi-Fi change) so the next call asks again. */
export function resetProxy() {
  baseUrl = null;
}

/**
 * YouTube videos without an audio-only stream (e.g. "made for kids"): the proxy extracts the AAC
 * track of the audio+video file, which only works as ADTS (the .aac route). Filled by prepare().
 */
const muxedIds = new Set<string>();

/** ADTS streams (compatibility mode, or a muxed video) only apply to YouTube; local files stay as they are. */
const usesAac = (item: QueueItem) =>
  !isLocal(item) && (muxedIds.has(item.id) || useSettings.getState().streamFormat === 'aac');

/**
 * Resolves a YouTube stream on the phone before Sonos gets its URL, so a video without playable
 * audio fails here with a message instead of silently on the speaker. Also learns whether it is muxed.
 */
async function prepare(item: QueueItem): Promise<void> {
  if (isLocal(item)) return;
  const { muxed } = await Native.prepareStream(item.id);
  if (muxed) muxedIds.add(item.id);
  else muxedIds.delete(item.id);
}

/** Tells two queue entries of the same track apart in our stream URLs (the proxy ignores it). */
function entryTag(item: QueueItem): string {
  return item.key.startsWith(`${item.id}-`) ? item.key.slice(item.id.length + 1) : item.key;
}

function streamUrl(base: string, item: QueueItem, startSec?: number | null): string {
  const tag = `q=${encodeURIComponent(entryTag(item))}`;
  if (isLocal(item)) return `${base}/local/${item.id}.${item.ext ?? 'mp3'}?${tag}`;
  const aac = usesAac(item);
  const url = `${base}/stream/${item.id}.${aac ? 'aac' : 'm4a'}?${tag}`;
  return aac && startSec ? `${url}&start=${Math.floor(startSec)}` : url;
}

const LOCAL_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  wma: 'audio/x-ms-wma',
};

/** Artwork URL Sonos can load: YouTube thumbnails directly, local covers through our proxy. */
function artworkFor(item: QueueItem, base: string | null): string | null {
  if (!isLocal(item)) return item.thumbnail;
  const name = localArtName(item.thumbnail);
  return name && base ? `${base}/local-art/${name}` : null;
}

function didlFor(item: QueueItem, uri: string): string {
  const mimeType = isLocal(item) ? (LOCAL_MIME[item.ext ?? ''] ?? 'audio/mpeg') : usesAac(item) ? 'audio/aac' : 'audio/mp4';
  return sonos.buildDidl({
    id: item.id,
    title: item.title,
    artist: item.channel,
    album: 'Wave for Sonos',
    artworkUrl: artworkFor(item, baseUrl) ?? undefined,
    streamUrl: uri,
    mimeType,
    durationSec: item.durationSec ?? undefined,
  });
}

function isOurs(uri: string | undefined | null): boolean {
  return !!uri && !!baseUrl && uri.startsWith(baseUrl);
}

/** Track id inside one of our stream URLs (YouTube video id or local file id). */
function idFromUri(uri: string): string | null {
  const m = uri.match(/\/(?:stream|local)\/([A-Za-z0-9_-]+)\./);
  return m ? m[1] : null;
}

/** Queue entry tag inside one of our stream URLs (see entryTag), null for URLs without one. */
function tagFromUri(uri: string): string | null {
  const m = uri.match(/[?&]q=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------------------------------------------------------------- queue

/** Inserts items after the current track and starts the first of them. */
export async function playNow(items: MediaItem[], startSec?: number | null): Promise<void> {
  const videos = items.filter(isPlayable);
  if (!videos.length) return;
  const { queue, index } = player();
  const at = index < 0 ? queue.length : index + 1;
  const added = videos.map(toQueueItem);
  player().set({ queue: [...queue.slice(0, at), ...added, ...queue.slice(at)] });
  await playIndex(at, startSec);
}

export function enqueue(items: MediaItem[]): number {
  const videos = items.filter(isPlayable).map(toQueueItem);
  player().set({ queue: [...player().queue, ...videos] });
  nextQueuedFor = null;
  void queueNextOnSonos();
  return videos.length;
}

export function removeAt(i: number) {
  const { queue, index, transport, foreign, repeat } = player();
  if (i < 0 || i >= queue.length) return;
  const q = queue.filter((_, k) => k !== i);
  nextQueuedFor = null;
  if (i !== index) {
    player().set({ queue: q, index: i < index ? index - 1 : index });
    void queueNextOnSonos();
    return;
  }
  // The current track was removed: the following one becomes current, and the speaker has to agree.
  const following = i < q.length ? i : repeat && q.length ? 0 : -1;
  const shown = following >= 0 ? following : q.length - 1;
  player().set({ queue: q, index: shown, positionSec: 0, durationSec: q[shown]?.durationSec ?? null });
  if (foreign) return;
  if ((transport === 'PLAYING' || transport === 'TRANSITIONING') && following >= 0) void playIndex(following);
  else if (transport === 'PLAYING' || transport === 'TRANSITIONING' || transport === 'PAUSED_PLAYBACK') void halt(currentTargetIp());
  else void queueNextOnSonos();
}

export function move(from: number, to: number) {
  const { queue, index } = player();
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
  const q = [...queue];
  const [it] = q.splice(from, 1);
  q.splice(to, 0, it);
  let idx = index;
  if (from === index) idx = to;
  else if (from < index && to >= index) idx = index - 1;
  else if (from > index && to <= index) idx = index + 1;
  player().set({ queue: q, index: idx });
  nextQueuedFor = null;
  void queueNextOnSonos();
}

export function clearUpcoming() {
  const { queue, index } = player();
  const cur = currentItem({ queue, index });
  player().set({ queue: cur ? [cur] : [], index: cur ? 0 : -1 });
  nextQueuedFor = null;
  void queueNextOnSonos();
}

function nextIndex(): number | null {
  const { queue, index, shuffle, repeat } = player();
  if (!queue.length) return null;
  if (shuffle && queue.length > 1) {
    let n = index;
    while (n === index) n = Math.floor(Math.random() * queue.length);
    return n;
  }
  if (index + 1 < queue.length) return index + 1;
  return repeat ? 0 : null;
}

// ---------------------------------------------------------------- transport

export async function playIndex(i: number, startSec?: number | null): Promise<void> {
  const item = player().queue[i];
  if (!item) return;
  const gen = ++playGen;
  const stale = () => gen !== playGen;
  transitioning++;
  transportSeq++;
  // A new track starts: an earlier PLAYING must not turn the STOPPED in between into a "track ended".
  lastState = null;
  player().set({ index: i, busy: true, error: null, positionSec: startSec ?? 0, durationSec: item.durationSec, foreign: false });
  try {
    // Nothing is sent to Sonos when the video has no playable stream (prepare rejects → error).
    const [base, ip] = await Promise.all([proxyBase(), ensureTargetIp(), prepare(item)]);
    if (stale()) return;
    const uri = streamUrl(base, item, startSec);
    userStopped = false;
    streamOffset = usesAac(item) && startSec ? Math.floor(startSec) : 0;
    await sonos.setUri(ip, uri, didlFor(item, uri));
    if (stale()) return;
    await sonos.play(ip);
    if (stale()) return;
    if (startSec && !usesAac(item)) await seekWhenReady(ip, startSec);
    if (stale()) return;
    player().set({ transport: 'PLAYING' });
    useHistory.getState().record(item);
    nextQueuedFor = null;
    void queueNextOnSonos();
    notify();
    startPolling();
  } catch (e) {
    if (!stale()) player().set({ error: errorText(e) });
  } finally {
    transitioning--;
    transportSeq++;
    if (!stale()) player().set({ busy: false });
  }
}

async function seekWhenReady(ip: string, sec: number) {
  for (let k = 0; k < 10; k++) {
    const t = await sonos.getTransportInfo(ip);
    if (t.state === 'PLAYING' || t.state === 'PAUSED_PLAYBACK') {
      await sonos.seek(ip, sec);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Puts the next track into Sonos' "next" slot so the change is gapless. Best effort. */
async function queueNextOnSonos() {
  const ip = currentTargetIp();
  // Only while one of our tracks is loaded; never touch someone else's playback.
  if (!ip || !baseUrl || player().index < 0 || player().foreign) return;
  // Shuffle picks the next track at random when it is needed, so nothing is queued ahead.
  const n = player().shuffle ? null : nextIndex();
  const item = n === null ? undefined : player().queue[n];
  if (!item) {
    // Nothing follows any more: Sonos must not play a track that was queued before.
    if (sonosHasNext) {
      sonosHasNext = false;
      nextQueuedFor = null;
      await sonos.clearNextUri(ip).catch(() => undefined);
    }
    return;
  }
  if (nextQueuedFor === item.key) return;
  nextQueuedFor = item.key;
  try {
    // Decides the stream format (muxed videos need the .aac route).
    await prepare(item);
  } catch {
    // Not playable: queue nothing; when it is due, playIndex reports the error.
    if (nextQueuedFor === item.key && sonosHasNext) {
      sonosHasNext = false;
      await sonos.clearNextUri(ip).catch(() => undefined);
    }
    return;
  }
  // The queue changed (a newer call takes care of the next slot) or playback was stopped meanwhile.
  if (nextQueuedFor !== item.key || !baseUrl) return;
  sonosHasNext = true;
  try {
    const uri = streamUrl(baseUrl, item);
    await sonos.setNextUri(ip, uri, didlFor(item, uri));
  } catch {
    // Not supported for plain URIs on every firmware; polling handles the advance.
  }
}

/** Stops our playback on `ip` on purpose, so the STOPPED that follows is not taken for a track end. */
async function halt(ip: string | null) {
  userStopped = true;
  transportSeq++;
  lastState = null;
  player().set({ transport: 'STOPPED' });
  if (ip) await sonos.stop(ip).catch(() => undefined);
  notify();
}

/**
 * The leading room was deselected and the group now has another coordinator: stop the old one
 * and continue the current track on the new lead.
 */
export async function moveToNewLead(oldLeadIp: string): Promise<void> {
  const s = player();
  if (s.foreign || !currentItem(s)) return;
  const wasPlaying = s.transport === 'PLAYING' || s.transport === 'TRANSITIONING';
  const at = s.positionSec;
  await halt(oldLeadIp);
  if (wasPlaying) await playIndex(player().index, at > 1 ? at : null);
}

export async function togglePlay(): Promise<void> {
  const ip = currentTargetIp();
  const { transport, index } = player();
  if (!ip) return;
  try {
    transportSeq++;
    if (transport === 'PLAYING' || transport === 'TRANSITIONING') {
      userStopped = true;
      await sonos.pause(ip);
      player().set({ transport: 'PAUSED_PLAYBACK' });
    } else if (transport === 'STOPPED' && index >= 0) {
      await playIndex(index, player().positionSec > 5 ? player().positionSec : null);
      return;
    } else {
      userStopped = false;
      await sonos.play(ip);
      player().set({ transport: 'PLAYING' });
      startPolling();
    }
    notify();
  } catch (e) {
    player().set({ error: errorText(e) });
  }
}

export async function next(): Promise<void> {
  const n = nextIndex();
  if (n !== null) await playIndex(n);
}

export async function previous(): Promise<void> {
  const { index, positionSec } = player();
  if (positionSec > 5 || index <= 0) return seekTo(0);
  await playIndex(index - 1);
}

export async function seekTo(sec: number): Promise<void> {
  const ip = currentTargetIp();
  const item = currentItem(player());
  if (!ip || !item) return;
  // A duration of 0 means unknown (Sonos reports 0:00:00 for live/remuxed streams).
  const target = Math.max(0, Math.min(sec, (player().durationSec || sec) - 1));
  player().set({ positionSec: target });
  try {
    if (usesAac(item)) {
      // Raw AAC streams aren't seekable on Sonos: restart the stream at the new offset.
      await playIndex(player().index, target);
    } else {
      await sonos.seek(ip, target);
    }
  } catch (e) {
    player().set({ error: errorText(e) });
  }
}

export const skipBy = (delta: number) => seekTo(player().positionSec + delta);

export async function stopAll(): Promise<void> {
  const ip = currentTargetIp();
  userStopped = true;
  transportSeq++;
  stopPolling();
  if (ip) await sonos.stop(ip).catch(() => undefined);
  await Native.stopProxy().catch(() => undefined);
  baseUrl = null;
  player().set({ transport: 'STOPPED' });
}

// ---------------------------------------------------------------- polling

export function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => void poll(), 1500);
}

export function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

let polling = false;
let pollCount = 0;
let lastPollIp: string | null = null;
/** One polling tick (exported for tests). */
export async function poll() {
  // While a track is being started the speaker is briefly STOPPED; that is no track end.
  if (polling || transitioning) return;
  const ip = currentTargetIp();
  if (!ip) return;
  if (ip !== lastPollIp) {
    // Another speaker leads now; its state says nothing about how our track went on.
    lastPollIp = ip;
    lastState = null;
  }
  const seq = transportSeq;
  polling = true;
  try {
    // Pick up volume changes made elsewhere (Sonos app, buttons on the speaker) every ~6 s,
    // so the hardware keys continue from the real value.
    if (++pollCount % 4 === 0 && Date.now() - lastKeyAt > 3000) {
      sonos
        .getGroupVolume(ip)
        .then((v) => {
          if (Date.now() - lastKeyAt > 3000) useSpeakers.getState().set({ groupVolume: v });
        })
        .catch(() => undefined);
    }
    const [t, pos] = await Promise.all([sonos.getTransportInfo(ip), sonos.getPositionInfo(ip)]);
    // A transport command went out meanwhile: this answer may predate it.
    if (transitioning || seq !== transportSeq) return;
    const s = player();
    let cur = currentItem(s);

    if (!isOurs(pos.uri) && t.state !== 'STOPPED' && t.state !== 'NO_MEDIA_PRESENT') {
      // Somebody started something else (Sonos app, other phone). When it stops, that is not our track ending.
      if (!s.foreign) player().set({ foreign: true, transport: t.state });
      lastState = null;
      return;
    }

    // Playing our stream again (maybe resumed from the Sonos app): a later STOPPED is a real track end.
    if (isOurs(pos.uri) && t.state === 'PLAYING') userStopped = false;

    // Sonos moved on to the track we queued as "next".
    const playingId = idFromUri(pos.uri);
    const playingTag = tagFromUri(pos.uri);
    if (isOurs(pos.uri) && cur && playingId && (playingId !== cur.id || (playingTag !== null && playingTag !== entryTag(cur)))) {
      const n = playingTag !== null ? s.queue.findIndex((q) => entryTag(q) === playingTag) : nextIndex();
      if (n !== null && n >= 0 && s.queue[n]?.id === playingId) {
        streamOffset = 0;
        cur = s.queue[n];
        player().set({ index: n, durationSec: cur.durationSec });
        useHistory.getState().record(cur);
        nextQueuedFor = null;
        void queueNextOnSonos();
        notify();
      }
    }

    player().set({
      transport: t.state,
      positionSec: pos.positionSec != null ? pos.positionSec + streamOffset : s.positionSec,
      // 0:00:00 means unknown; keep the duration we already have.
      durationSec: pos.durationSec || player().durationSec,
      foreign: false,
    });

    const ended = (lastState === 'PLAYING' || lastState === 'TRANSITIONING') && t.state === 'STOPPED' && !userStopped;
    lastState = t.state;
    if (ended) {
      if (useSettings.getState().autoAdvance && nextIndex() !== null) await next();
      else notify();
    }
  } catch {
    // speaker briefly unreachable; try again on the next tick
  } finally {
    polling = false;
  }
}

function notify() {
  const s = player();
  const cur = currentItem(s);
  if (!cur) return;
  try {
    Native.updateNowPlaying({
      title: cur.title,
      artist: cur.channel,
      artworkUrl: artworkFor(cur, baseUrl),
      playing: s.transport === 'PLAYING' || s.transport === 'TRANSITIONING',
    });
  } catch {
    // service not running
  }
}

// ---------------------------------------------------------------- wiring

let wired = false;
/** Hooks up notification buttons and app state. Call once at startup. */
export function initController() {
  if (wired) return;
  wired = true;
  initVolumeKeys();
  onLeadChange(moveToNewLead);
  // Shuffle/repeat are toggled straight on the store; the Sonos "next" slot has to follow.
  usePlayer.subscribe((s, prev) => {
    if (s.shuffle === prev.shuffle && s.repeat === prev.repeat) return;
    nextQueuedFor = null;
    void queueNextOnSonos();
  });
  Native.addListener('onMediaAction', ({ action }) => {
    if (action === 'play' || action === 'pause') void togglePlay();
    else if (action === 'next') void next();
    else if (action === 'previous') void previous();
    else if (action === 'stop') void stopAll();
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && player().index >= 0 && baseUrl) {
      // The Wi-Fi address may have changed while we were in the background.
      Native.startProxy()
        .then((info) => {
          baseUrl = info.baseUrl;
        })
        .catch(() => undefined);
      startPolling();
    }
  });
}
