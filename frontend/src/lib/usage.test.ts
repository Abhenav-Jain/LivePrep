import { describe, expect, it } from 'vitest';
import type { PracticeUsage } from './api';
import {
  baseUsedSeconds,
  formatClock,
  formatDuration,
  limitSecondsFor,
  remainingSecondsFor,
  usageTone,
  usedSecondsFor,
} from './usage';

const limited: PracticeUsage = {
  limit_minutes: 30,
  used_minutes: 10,
  used_seconds: 615,
  remaining_minutes: 20,
};

describe('usage helpers', () => {
  it('converts the limit to seconds and treats a null limit as unlimited', () => {
    expect(limitSecondsFor(limited)).toBe(1800);
    expect(limitSecondsFor({ limit_minutes: null, used_minutes: 0, remaining_minutes: null })).toBeNull();
    expect(limitSecondsFor(null)).toBeNull();
  });

  it('uses exact seconds when the server sends them', () => {
    expect(baseUsedSeconds(limited)).toBe(615);
  });

  it('falls back to whole minutes when used_seconds is missing', () => {
    expect(baseUsedSeconds({ limit_minutes: 30, used_minutes: 7, remaining_minutes: 23 })).toBe(420);
    expect(baseUsedSeconds(null)).toBe(0);
  });

  it('adds the running call to today’s total', () => {
    expect(usedSecondsFor(limited, 45)).toBe(660);
    expect(usedSecondsFor(limited, 0)).toBe(615);
  });

  it('never returns negative time left', () => {
    expect(remainingSecondsFor(limited, 900)).toBe(900);
    expect(remainingSecondsFor(limited, 2400)).toBe(0);
    expect(remainingSecondsFor(null, 2400)).toBeNull();
  });

  it('switches tone near and at the end of the allowance', () => {
    expect(usageTone(1500, 1800)).toBe('ok');
    expect(usageTone(300, 1800)).toBe('low');
    expect(usageTone(0, 1800)).toBe('empty');
    expect(usageTone(null, 1800)).toBe('ok');
  });

  it('formats durations and clock text', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(3900)).toBe('1h 5m');
    expect(formatClock(45)).toBe('0:45');
    expect(formatClock(1650)).toBe('27:30');
    expect(formatClock(-5)).toBe('0:00');
  });
});
