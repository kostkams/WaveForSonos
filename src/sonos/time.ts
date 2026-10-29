/**
 * Time helpers for UPnP "H:MM:SS" strings as used by Sonos AVTransport.
 */

/** Seconds → "H:MM:SS" (hours not zero-padded, as Sonos expects). Negative/NaN → "0:00:00". */
export function toHms(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * "H:MM:SS" (optionally with fractional seconds, or "MM:SS") → seconds.
 * Returns null for empty / "NOT_IMPLEMENTED" / unparseable values.
 */
export function parseHms(str: string | null | undefined): number | null {
  if (str == null) return null;
  const trimmed = String(str).trim();
  if (!trimmed || trimmed.toUpperCase() === 'NOT_IMPLEMENTED') return null;
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Math.floor(total);
}
