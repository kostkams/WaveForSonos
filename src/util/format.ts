import { currentLang, localeOf, translate, type Lang } from '@/i18n';

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** "6 Std. 18 Min." / "6 hr 18 min" */
export function formatTotal(sec: number, lang: Lang = currentLang()): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return translate(lang, 'format.minutes', { m });
  return translate(lang, 'format.hoursMinutes', { h, m });
}

export function formatViews(n: number | null | undefined, lang: Lang = currentLang()): string {
  if (n === null || n === undefined || n < 0) return '';
  const fmt = (x: number) => x.toLocaleString(localeOf(lang), { maximumFractionDigits: 1 });
  if (n >= 1_000_000_000) return translate(lang, 'format.viewsBillion', { n: fmt(n / 1_000_000_000) });
  if (n >= 1_000_000) return translate(lang, 'format.viewsMillion', { n: fmt(n / 1_000_000) });
  return translate(lang, 'format.views', { n: n.toLocaleString(localeOf(lang)) });
}
