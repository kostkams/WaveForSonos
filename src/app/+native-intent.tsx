import { markShared } from '@/playback/shareDedupe';
import { parseYouTubeLink } from '@/youtube/links';

/**
 * The app is registered for youtube.com / youtu.be links. Expo Router would treat such a URL
 * as an unknown route, so YouTube links are turned into the share sheet instead.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/youtu\.?be/i.test(path) && parseYouTubeLink(path)) {
      markShared(path);
      return `/share?text=${encodeURIComponent(path)}`;
    }
    return path;
  } catch {
    return '/';
  }
}
