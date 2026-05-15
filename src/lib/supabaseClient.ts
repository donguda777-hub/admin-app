import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (anon key only). Returns null if env is missing.
 * worker_day_entries는 조회(select) 및 프로젝트명 정정 시 project_name 일괄 update.
 * projects는 추가·이름 수정 가능.
 */
let browserClient: SupabaseClient | null = null;

function readEnv(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readEnv() != null;
}

/** Singleton anon client for admin-app. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const env = readEnv();
  if (env == null) return null;
  if (browserClient == null) {
    browserClient = createClient(env.url, env.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return browserClient;
}
