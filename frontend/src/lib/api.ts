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

// --------------------------------------------------------------------------- //
// Practice usage (daily minutes)
// --------------------------------------------------------------------------- //
export interface PracticeUsage {
  /** null when the daily limit is disabled (DAILY_MINUTES_LIMIT=0). */
  limit_minutes: number | null;
  used_minutes: number;
  /** Exact seconds practised today; absent on servers older than this field. */
  used_seconds?: number;
  remaining_minutes: number | null;
}

export interface MeResponse {
  user_id: string;
  email: string | null;
  usage: PracticeUsage;
}

/** Today's practice allowance of the signed-in user (the source of the usage timer). */
export async function fetchMe(): Promise<MeResponse> {
  const res = await authFetch('/api/me');
  if (!res.ok) throw new ApiError(res.status, `Failed to load today's usage (${res.status})`);
  return res.json();
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

// --------------------------------------------------------------------------- //
// Reports (Step 6)
// --------------------------------------------------------------------------- //
export interface ReportScores {
  fluency: number;
  vocabulary: number;
  grammar: number;
  communication: number;
  pace: number;
  pronunciation: number | null;
  overall: number;
}

export interface ReportMetrics {
  user_word_count: number;
  agent_word_count: number;
  user_turn_count: number;
  total_turn_count: number;
  session_duration_s: number | null;
  user_speaking_s: number;
  words_per_minute: number | null;
  pause_count: number;
  avg_pause_s: number | null;
  longest_pause_s: number | null;
  filler_count: number;
  filler_breakdown: Record<string, number>;
  unique_word_count: number;
  type_token_ratio: number | null;
  top_repeated_words: { word: string; count: number }[];
  avg_turn_length_words: number | null;
  approximate: { filler: boolean; pronunciation: string };
}

export interface GrammarMistake {
  said: string;
  better: string;
  rule: string;
}

export interface WordUpgrade {
  used: string;
  alternatives: string[];
}

export interface CommunicationFeedback {
  clarity: number;
  structure: number;
  confidence: number;
  comments: string;
}

/** Shape stored by reports generated before the communication-coach rubric. */
export interface LegacyInterviewFeedback {
  relevance: number;
  structure: number;
  confidence: number;
  comments: string;
}

export interface ActionStep {
  step: string;
  daily_exercise: string;
}

export interface ReportAnalysis {
  rubric_version: string;
  too_short: boolean;
  scores: ReportScores | null;
  estimated_cefr: string | null;
  summary: string;
  strengths: string[];
  grammar_mistakes: GrammarMistake[];
  words_to_upgrade: WordUpgrade[];
  communication_feedback: CommunicationFeedback | null;
  /** Only on older reports; the UI still reads it. */
  interview_feedback?: LegacyInterviewFeedback | null;
  action_plan: ActionStep[];
  next_session_focus: string;
  /** The best sentence the learner actually said (absent on older reports). */
  best_moment?: string | null;
  metrics?: ReportMetrics;
  notes?: { pronunciation?: string; filler?: string };
}

export interface ReportResponse {
  session_id: string;
  status: 'pending' | 'ready' | 'failed' | 'missing';
  rubric_version: string;
  metrics: ReportMetrics | null;
  report: ReportAnalysis | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  previous: { scores: Partial<ReportScores> } | null;
}

export interface ProgressEntry {
  session_id: string;
  scenario: string | null;
  started_at: string | null;
  scores: {
    overall: number | null;
    fluency: number | null;
    vocabulary: number | null;
    grammar: number | null;
    communication: number | null;
    pace: number | null;
  };
}

export async function fetchSessionReport(sessionId: string): Promise<ReportResponse> {
  const res = await authFetch(`/api/sessions/${sessionId}/report`);
  if (!res.ok) throw new ApiError(res.status, `Failed to load report (${res.status})`);
  return res.json();
}

export async function retrySessionReport(sessionId: string): Promise<ReportResponse> {
  const res = await authFetch(`/api/sessions/${sessionId}/report/retry`, { method: 'POST' });
  if (!res.ok) throw new ApiError(res.status, `Failed to build report (${res.status})`);
  return res.json();
}

export async function fetchProgress(limit = 10): Promise<ProgressEntry[]> {
  const res = await authFetch(`/api/progress?limit=${limit}`);
  if (!res.ok) throw new ApiError(res.status, `Failed to load progress (${res.status})`);
  const body = await res.json();
  return body.reports || [];
}

// --------------------------------------------------------------------------- //
// Word bank (v2): saved words and corrections with spaced repetition
// --------------------------------------------------------------------------- //
export interface WordBankItem {
  id: number;
  term: string;
  alternatives: string[];
  note: string | null;
  source: 'vocabulary' | 'grammar' | 'manual' | string;
  status: 'new' | 'learning' | 'mastered' | string;
  review_count: number;
  correct_count: number;
  interval_days: number;
  next_review_at: string | null;
  due: boolean;
  session_id: string | null;
  created_at: string | null;
}

export interface WordBankSummary {
  total: number;
  due: number;
  new: number;
  learning: number;
  mastered: number;
}

export interface WordBankResponse {
  items: WordBankItem[];
  summary: WordBankSummary;
  hint: string;
}

export async function fetchWordBank(dueOnly = false): Promise<WordBankResponse> {
  const res = await authFetch(`/api/wordbank${dueOnly ? '?due_only=true' : ''}`);
  if (!res.ok) throw new ApiError(res.status, `Failed to load the word bank (${res.status})`);
  return res.json();
}

export async function createWordBankCard(input: {
  term: string;
  alternatives?: string[];
  note?: string | null;
}): Promise<{ item: WordBankItem; created: boolean }> {
  const res = await authFetch('/api/wordbank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status, `Could not save the word (${res.status})`);
  return res.json();
}

export async function reviewWordBankCard(
  itemId: number,
  result: 'again' | 'good' | 'easy',
): Promise<{ item: WordBankItem; summary: WordBankSummary }> {
  const res = await authFetch(`/api/wordbank/${itemId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  });
  if (!res.ok) throw new ApiError(res.status, `Could not save the review (${res.status})`);
  return res.json();
}

export async function deleteWordBankCard(itemId: number): Promise<void> {
  const res = await authFetch(`/api/wordbank/${itemId}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, `Could not delete the word (${res.status})`);
}

// --------------------------------------------------------------------------- //
// Practice insights (streak, weekly goal, totals)
// --------------------------------------------------------------------------- //
export interface SkillScore {
  skill: string;
  label: string;
  score: number;
}

export interface StatsResponse {
  today: string;
  week_start: string;
  streak_days: number;
  active_days: number;
  sessions_total: number;
  sessions_today: number;
  sessions_this_week: number;
  minutes_total: number;
  minutes_this_week: number;
  weekly_goal: number | null;
  weekly_goal_met: boolean;
  weekly_goal_progress: number | null;
  avg_overall: number | null;
  best_overall: number | null;
  latest_overall: number | null;
  improvement: number | null;
  scored_sessions: number;
  average_by_skill: Record<string, number | null>;
  strongest_skill: SkillScore | null;
  weakest_skill: SkillScore | null;
  wordbank: { total: number; due: number; mastered: number };
}

export async function fetchStats(): Promise<StatsResponse> {
  const res = await authFetch('/api/stats');
  if (!res.ok) throw new ApiError(res.status, `Failed to load your stats (${res.status})`);
  return res.json();
}
