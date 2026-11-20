import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** True when both public login settings are present. */
export const isAuthConfigured = /^https?:\/\//.test(url) && key.length > 20;

/** Supabase browser client (login only). Null when the public settings are missing. */
export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // lets the "magic link" in the email sign the user in
      },
    })
  : null;
