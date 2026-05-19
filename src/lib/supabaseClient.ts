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
  if (url.includes("YOUR_PROJECT_REF")) return null;
  if (anonKey === "your_anon_public_key_here") return null;
  return { url, anonKey };
}

/** 운영 빌드에서 Supabase env 가 없으면 로그인 차단용 메시지 */
export function getSupabaseConfigErrorMessage(): string | null {
  if (isSupabaseConfigured()) return null;
  if (import.meta.env.PROD) {
    return "\uC11C\uBC84 \uC124\uC815(Supabase \uD658\uACBD\uBCC0\uC218)\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uBC30\uD3EC \uAD00\uB9AC\uC790\uC5D0\uAC8C VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY \uB4F1\uB85D\uC744 \uD655\uC778\uD558\uC138\uC694.";
  }
  return null;
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
