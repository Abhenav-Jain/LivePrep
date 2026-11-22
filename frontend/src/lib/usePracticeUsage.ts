import { useCallback, useEffect, useRef, useState } from 'react';
import { describeApiError, fetchMe, PracticeUsage } from './api';

/** Refresh the server total occasionally so another tab or device shows up here too. */
const HEARTBEAT_MS = 5 * 60 * 1000;
/** The server writes the session a moment after the socket closes. */
const POST_CALL_REFRESH_MS = 2000;

export interface PracticeUsageState {
  /** Today's allowance as the server reported it (finished calls only). */
  usage: PracticeUsage | null;
  /** Seconds spent in the call that is running right now (0 when idle). */
  liveSeconds: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Tracks today's practice time. `isLive` must be true while a call is connected: the seconds
 * of the running call are counted locally, because the backend only stores a session when it
 * ends, and the total is refreshed once the call is over.
 */
export function usePracticeUsage(isLive: boolean): PracticeUsageState {
  const [usage, setUsage] = useState<PracticeUsage | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [liveSeconds, setLiveSeconds] = useState<number>(0);
  const wasLiveRef = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUsage(me.usage);
      setError(null);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isLive) {
      setLiveSeconds(0);
      if (!wasLiveRef.current) return;
      wasLiveRef.current = false;
      // Refresh right away and once more after the server has stored the session.
      void refresh();
      const timer = window.setTimeout(() => void refresh(), POST_CALL_REFRESH_MS);
      return () => window.clearTimeout(timer);
    }

    wasLiveRef.current = true;
    const startedAt = Date.now();
    setLiveSeconds(0);
    const timer = window.setInterval(() => {
      setLiveSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLive, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), HEARTBEAT_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { usage, liveSeconds, loading, error, refresh };
}
