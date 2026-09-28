import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToday } from '../hooks/useToday';

describe('useToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rolls over to the next local day just after midnight, repeatedly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 23, 59, 30));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-28');

    act(() => vi.advanceTimersByTime(29_000)); // 23:59:59
    expect(result.current).toBe('2026-09-28');

    act(() => vi.advanceTimersByTime(2_000)); // just past midnight
    expect(result.current).toBe('2026-09-29');

    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(result.current).toBe('2026-09-30');
  });
});
