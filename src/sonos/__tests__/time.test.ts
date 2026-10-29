/// <reference types="jest" />
import { parseHms, toHms } from '../time';

describe('time helpers', () => {
  it('formats H:MM:SS', () => {
    expect(toHms(0)).toBe('0:00:00');
    expect(toHms(59)).toBe('0:00:59');
    expect(toHms(61)).toBe('0:01:01');
    expect(toHms(3725)).toBe('1:02:05');
    expect(toHms(36000)).toBe('10:00:00');
    expect(toHms(12.9)).toBe('0:00:12');
    expect(toHms(-5)).toBe('0:00:00');
    expect(toHms(NaN)).toBe('0:00:00');
  });

  it('parses H:MM:SS', () => {
    expect(parseHms('0:00:00')).toBe(0);
    expect(parseHms('0:03:21')).toBe(201);
    expect(parseHms('1:02:05')).toBe(3725);
    expect(parseHms('00:01:30.500')).toBe(90);
    expect(parseHms('03:21')).toBe(201);
  });

  it('returns null for unknown values', () => {
    expect(parseHms('NOT_IMPLEMENTED')).toBeNull();
    expect(parseHms('')).toBeNull();
    expect(parseHms(undefined)).toBeNull();
    expect(parseHms(null)).toBeNull();
    expect(parseHms('abc')).toBeNull();
    expect(parseHms('1:2:3:4')).toBeNull();
  });

  it('round-trips', () => {
    for (const s of [0, 1, 59, 600, 3599, 3600, 7322]) expect(parseHms(toHms(s))).toBe(s);
  });
});
