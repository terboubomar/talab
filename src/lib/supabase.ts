import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;

const url = env["VITE_SUPABASE_URL"] ?? env["SUPABASE_URL"];

const key = env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? env["VITE_SUPABASE_ANON_KEY"];


/** Null until the Supabase project is connected in Project Settings → Connectors. */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export const isSupabaseConnected = Boolean(supabase);
