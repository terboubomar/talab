import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;

/** The Talab database (existing, read-only schema). */
const url = env["VITE_TALAB_SUPABASE_URL"] ?? env["VITE_SUPABASE_URL"];

const key =
  env["VITE_TALAB_SUPABASE_ANON_KEY"] ??
  env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  env["VITE_SUPABASE_ANON_KEY"];

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export const isSupabaseConnected = Boolean(supabase);
