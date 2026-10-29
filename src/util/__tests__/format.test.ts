/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { formatDuration, formatTotal, formatViews } from '../format';

test('formatDuration', () => {
  expect(formatDuration(0)).toBe('0:00');
  expect(formatDuration(65)).toBe('1:05');
  expect(formatDuration(3 * 3600 + 2 * 60 + 14)).toBe('3:02:14');
  expect(formatDuration(null)).toBe('');
});

test('formatTotal in German and English', () => {
  expect(formatTotal(6 * 3600 + 18 * 60, 'de')).toBe('6 Std. 18 Min.');
  expect(formatTotal(59 * 60, 'de')).toBe('59 Min.');
  expect(formatTotal(6 * 3600 + 18 * 60, 'en')).toBe('6 hr 18 min');
});

test('formatViews in German and English', () => {
  expect(formatViews(1_200_000, 'de')).toBe('1,2 Mio. Aufrufe');
  expect(formatViews(1_200_000, 'en')).toBe('1.2M views');
  expect(formatViews(1234, 'en')).toBe('1,234 views');
  expect(formatViews(null, 'de')).toBe('');
});
