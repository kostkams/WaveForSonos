import { extractUrl, parseYouTubeLink } from '../links';

describe('parseYouTubeLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc123', 'dQw4w9WgXcQ', null],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'dQw4w9WgXcQ', null],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk', 'dQw4w9WgXcQ', 'PLabcdefghijk'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ', null],
    ['https://www.youtube.com/playlist?list=PLxyz123', null, 'PLxyz123'],
    ['Schau mal: Lofi Mix https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
  ])('%s', (input, videoId, playlistId) => {
    const r = parseYouTubeLink(input);
    expect(r?.videoId ?? null).toBe(videoId);
    expect(r?.playlistId ?? null).toBe(playlistId);
  });

  it('reads start times', () => {
    expect(parseYouTubeLink('https://youtu.be/dQw4w9WgXcQ?t=90')?.startSec).toBe(90);
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s')?.startSec).toBe(3723);
  });

  it('drops auto mixes', () => {
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ')?.playlistId).toBeNull();
  });

  it('rejects non-YouTube links', () => {
    expect(parseYouTubeLink('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeLink('lofi beats')).toBeNull();
    // 11 characters like a video id, but a search term (regression)
    expect(parseYouTubeLink('stratovario')).toBeNull();
    expect(parseYouTubeLink('dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeLink('https://www.youtube.com/@somechannel')).toBeNull();
  });
});

describe('extractUrl', () => {
  it('finds the first url', () => {
    expect(extractUrl('a https://x.y/z b https://q')).toBe('https://x.y/z');
    expect(extractUrl('nothing here')).toBeNull();
  });
});
