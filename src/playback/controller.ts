import { AppState } from 'react-native';

import { Native, type MediaItem } from '@/native';
import * as sonos from '@/sonos';
import { useHistory } from '@/state/historyStore';
import { currentItem, toQueueItem, usePlayer, type QueueItem } from '@/state/playerStore';
import { useSettings } from '@/state/settingsStore';
import { useSpeakers } from '@/state/speakerStore';
import { currentTargetIp, ensureTargetIp, errorText, refreshVolumes } from './speakers';
import { initVolumeKeys, lastKeyAt, resetRemoteVolumeSync } from './volumeKeys';

const player = () => usePlayer.getState();

let baseUrl: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Set when the user stopped/paused on purpose, so a STOPPED state is not treated as track end. */
let userStopped = false;
let lastState: sonos.TransportState | null = null;
/** Index whose stream is queued on Sonos via SetNextAVTransportURI */
let nextQueuedFor: string | null = null;

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

function streamUrl(base: string, item: QueueItem, startSec?: number | null): string {
  const fmt = useSettings.getState().streamFormat;
  const url = `${base}/stream/${item.id}.${fmt}`;
  return fmt === 'aac' && startSec ? `${url}?start=${Math.floor(startSec)}` : url;
}

function didlFor(item: QueueItem, uri: string): string {
  const fmt = useSettings.getState().streamFormat;
  return sonos.buildDidl({
    id: item.id,
    title: item.title,
    artist: item.channel,
    album: 'Wave for Sonos',
    artworkUrl: item.thumbnail ?? undefined,
    streamUrl: uri,
    mimeType: fmt === 'aac' ? 'audio/aac' : 'audio/mp4',
    durationSec: item.durationSec ?? undefined,
  });
}

function isOurs(uri: string | undefined | null): boolean {
  return !!uri && !!baseUrl && uri.startsWith(baseUrl);
}

function idFromUri(uri: string): string | null {
  const m = uri.match(/\/stream\/([A-Za-z0-9_-]{11})\./);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- queue

/** Inserts items after the current track and starts the first of them. */
export async function playNow(items: MediaItem[], startSec?: number | null): Promise<void> {
  const videos = items.filter((i) => i.type === 'video');
  if (!videos.length) return;
  const { queue, index } = player();
  const at = index < 0 ? queue.length : index + 1;
  const added = videos.map(toQueueItem);
  player().set({ queue: [...queue.slice(0, at), ...added, ...queue.slice(at)] });
  await playIndex(at, startSec);
}

export function enqueue(items: MediaItem[]): number {
  const videos = items.filter((i) => i.type === 'video').map(toQueueItem);
  player().set({ queue: [...player().queue, ...videos] });
  nextQueuedFor = null;
  void queueNextOnSonos();
  return videos.length;
}

export function removeAt(i: number) {
  const { queue, index } = player();
  if (i < 0 || i >= queue.length) return;
  const q = queue.filter((_, k) => k !== i);
  player().set({ queue: q, index: i < index ? index - 1 : i === index ? Math.min(index, q.length - 1) : index });
  nextQueuedFor = null;
  void queueNextOnSonos();
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
  player().set({ index: i, busy: true, error: null, positionSec: startSec ?? 0, durationSec: item.durationSec, foreign: false });
  try {
    const [base, ip] = await Promise.all([proxyBase(), ensureTargetIp()]);
    const uri = streamUrl(base, item, startSec);
    userStopped = false;
    await sonos.setUri(ip, uri, didlFor(item, uri));
    await sonos.play(ip);
    if (startSec && useSettings.getState().streamFormat === 'm4a') await seekWhenReady(ip, startSec);
    player().set({ transport: 'PLAYING' });
    useHistory.getState().record(item);
    nextQueuedFor = null;
    void queueNextOnSonos();
    notify();
    startPolling();
  } catch (e) {
    player().set({ error: errorText(e) });
  } finally {
    player().set({ busy: false });
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
  const n = nextIndex();
  const ip = currentTargetIp();
  if (n === null || !ip || !baseUrl || player().shuffle) return;
  const item = player().queue[n];
  if (!item || nextQueuedFor === item.key) return;
  try {
    const uri = streamUrl(baseUrl, item);
    await sonos.setNextUri(ip, uri, didlFor(item, uri));
    nextQueuedFor = item.key;
  } catch {
    // Not supported for plain URIs on every firmware; polling handles the advance.
    nextQueuedFor = item.key;
  }
}

export async function togglePlay(): Promise<void> {
  const ip = currentTargetIp();
  const { transport, index } = player();
  if (!ip) return;
  try {
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
  const target = Math.max(0, Math.min(sec, (player().durationSec ?? sec) - 1));
  player().set({ positionSec: target });
  try {
    if (useSettings.getState().streamFormat === 'aac') {
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
async function poll() {
  if (polling) return;
  const ip = currentTargetIp();
  if (!ip) return;
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
    const s = player();
    const cur = currentItem(s);

    if (!isOurs(pos.uri) && t.state !== 'STOPPED' && t.state !== 'NO_MEDIA_PRESENT') {
      // Somebody started something else (Sonos app, other phone).
      if (!s.foreign) player().set({ foreign: true, transport: t.state });
      lastState = t.state;
      return;
    }

    // Sonos moved on to the track we queued as "next".
    const playingId = idFromUri(pos.uri);
    if (isOurs(pos.uri) && cur && playingId && playingId !== cur.id) {
      const n = nextIndex();
      if (n !== null && s.queue[n]?.id === playingId) {
        player().set({ index: n, durationSec: s.queue[n].durationSec });
        useHistory.getState().record(s.queue[n]);
        nextQueuedFor = null;
        void queueNextOnSonos();
        notify();
      }
    }

    player().set({
      transport: t.state,
      positionSec: pos.positionSec ?? s.positionSec,
      durationSec: pos.durationSec ?? s.durationSec,
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
      artworkUrl: cur.thumbnail,
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
