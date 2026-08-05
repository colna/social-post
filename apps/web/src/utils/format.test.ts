import { describe, expect, it } from 'vitest';
import { formatCount, formatTime, postTypeColor } from './format';

describe('formatCount', () => {
  it('handles null / small / k / w', () => {
    expect(formatCount(null)).toBe('-');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(23000)).toBe('2.3w');
  });
});

describe('formatTime', () => {
  it('returns - for empty / invalid', () => {
    expect(formatTime(null)).toBe('-');
    expect(formatTime('not-a-date')).toBe('-');
  });
  it('formats valid ISO', () => {
    expect(formatTime('2024-01-02T03:04:05Z')).not.toBe('-');
  });
});

describe('postTypeColor', () => {
  it('maps known types and falls back', () => {
    expect(postTypeColor('image')).toBe('green');
    expect(postTypeColor('reel')).toBe('magenta');
    expect(postTypeColor('unknown')).toBe('default');
  });
});
