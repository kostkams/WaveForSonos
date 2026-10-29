import { isDuplicateShare, markShared } from '@/playback/shareDedupe';
import { parseYouTubeLink } from '@/youtube/links';

/**
 * The app is registered for youtube.com / youtu.be links. Expo Router would treat such a URL
 * as an unknown route, so YouTube links are turned into the share sheet instead.
 *
 * The native module reports the same VIEW intent as `onSharedText` (see _layout.tsx); whichever
 * arrives second is dropped via shareDedupe. Returning null keeps the app on its current screen.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (!/youtu\.?be/i.test(path)) return path;
    if (!parseYouTubeLink(path)) {
      // Channel / feed / search links: nothing to play. Don't show "Unmatched Route".
      markShared(path);
      return initial ? '/' : null;
    }
    // On a cold start the native initial text is read later and deduped against this mark.
    // Expo Router may resolve the initial URL more than once, so never drop it here.
    if (initial) {
      markShared(path);
    } else if (isDuplicateShare(path)) {
      return null;
    }
    return `/share?text=${encodeURIComponent(path)}`;
  } catch {
    return '/';
  }
}
