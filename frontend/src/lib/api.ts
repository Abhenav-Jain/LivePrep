import { supabase } from './supabase';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Fresh access token of the signed-in user (supabase-js refreshes it when it is about to expire). */
async function getAccessToken(): Promise<string> {
  if (!supabase) throw new ApiError(401, 'Login is not configured.');
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new ApiError(401, 'You are signed out.');
  return token;
}

/** fetch() for our own backend, with the user's token attached. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

/**
 * Asks the server for a one-time WebSocket login ticket (valid ~60 s, usable once).
 * A browser WebSocket cannot send headers, so this ticket is sent as the first WebSocket message.
 */
export async function fetchWsTicket(): Promise<string> {
  let res: Response;
  try {
    res = await authFetch('/api/ws-ticket', { method: 'POST' });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'Cannot reach the server.');
  }
  if (!res.ok) throw new ApiError(res.status, `Ticket request failed (${res.status}).`);
  const body: unknown = await res.json().catch(() => null);
  const ticket = (body as { ticket?: unknown } | null)?.ticket;
  if (typeof ticket !== 'string' || ticket.length < 16) throw new ApiError(502, 'Unexpected server answer.');
  return ticket;
}

/** Human-friendly text for an error thrown while preparing a call. */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 0:
        return 'Cannot reach the server. Check your internet connection and try again.';
      case 401:
        return 'Your login has expired. Please sign out and sign in again.';
      case 429:
        return 'Too many attempts. Please wait a minute and try again.';
      case 503:
        return 'The server is temporarily unavailable. Please try again in a moment.';
      default:
        return 'Could not start the call. Please try again.';
    }
  }
  return 'Could not start the call. Please try again.';
}

export interface SessionSummary {
  id: string;
  scenario: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  turn_count: number;
  report_status?: string | null;
  overall_score?: number | null;
}

export interface SessionTurn {
  idx: number;
  speaker: 'user' | 'agent';
  text: string;
  started_at_ms: number | null;
  ended_at_ms: number | null;
}

export interface SessionTranscriptResponse {
  session: {
    id: string;
    scenario: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    duration_s: number | null;
  };
  turns: SessionTurn[];
}

export async function fetchSessions(limit = 20, offset = 0): Promise<SessionSummary[]> {
  const res = await authFetch(`/api/sessions?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new ApiError(res.status, `Failed to load sessions (${res.status})`);
  const body = await res.json();
  return body.sessions || [];
}

export async function fetchSessionTranscript(sessionId: string): Promise<SessionTranscriptResponse> {
  const res = await authFetch(`/api/sessions/${sessionId}/transcript`);
  if (!res.ok) throw new ApiError(res.status, `Failed to load transcript (${res.status})`);
  return res.json();
}
