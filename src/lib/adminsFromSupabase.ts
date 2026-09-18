import type { AdminExtraAccountPersist } from "../adminPersist";
import { normalizeExtraAdminRole } from "../auth/adminRoles";
import {
  MASTER_ADMIN_ID,
  MASTER_ADMIN_PASSWORD,
  isMasterAdminAccountId,
  normalizeAdminAccountId,
} from "../auth/masterCredentials";
import { getSupabaseBrowserClient } from "./supabaseClient";

type AdminRemoteRow = {
  login_id: string;
  password: string;
  display_name: string;
  role: string;
  is_master: boolean;
};

function remoteRowToPersist(row: AdminRemoteRow): AdminExtraAccountPersist {
  return {
    id: row.login_id,
    password: row.password,
    user: row.display_name,
    role: normalizeExtraAdminRole(row.role),
  };
}

/** Supabase 미설정 시 마스터만 로컬 하드코딩으로 검증 (개발용) */
function verifyAdminLoginPasswordLocalFallback(
  userId: string,
  password: string
): boolean {
  const tid = normalizeAdminAccountId(userId);
  const tpw = password.trim();
  return (
    isMasterAdminAccountId(tid) && tpw === MASTER_ADMIN_PASSWORD.trim()
  );
}

/**
 * 관리자 ID·비밀번호를 Supabase public.admins 에서 검증한다.
 */
export async function verifyAdminLoginPassword(
  userId: string,
  password: string
): Promise<boolean> {
  const tid = normalizeAdminAccountId(userId);
  const tpw = password.trim();
  if (tid === "" || tpw === "") return false;

  const sb = getSupabaseBrowserClient();
  if (sb == null) {
    if (import.meta.env.PROD) return false;
    return verifyAdminLoginPasswordLocalFallback(userId, password);
  }

  const { data, error } = await sb
    .from("admins")
    .select("password")
    .eq("login_id", tid)
    .maybeSingle();

  if (error != null || data == null) return false;
  const row = data as { password?: string };
  return typeof row.password === "string" && row.password === tpw;
}

export async function fetchExtraAdminAccountsFromSupabase(): Promise<
  AdminExtraAccountPersist[] | null
> {
  const sb = getSupabaseBrowserClient();
  if (sb == null) return null;

  const { data, error } = await sb
    .from("admins")
    .select("login_id,password,display_name,role,is_master")
    .eq("is_master", false)
    .order("created_at", { ascending: true });

  if (error != null) {
    console.error("[admin-app] admins fetch (extra accounts) failed:", error);
    return null;
  }
  const rows = (data ?? []) as AdminRemoteRow[];
  return rows.map(remoteRowToPersist);
}

/**
 * localStorage(ln-admin-app-state-v1)의 extraAdminAccounts를 Supabase로 1회 업로드.
 * 마스터 로그인 후 AdminMainScreen 마운트 시 호출.
 */
export async function migrateLocalExtraAdminsToSupabase(
  localFallback: readonly AdminExtraAccountPersist[]
): Promise<{ uploaded: number; failed: number; errors: string[] }> {
  const extras = localFallback.filter((a) => !isMasterAdminAccountId(a.id));
  const result = { uploaded: 0, failed: 0, errors: [] as string[] };

  if (extras.length === 0) {
    console.info(
      "[admin-app] migrateLocalExtraAdminsToSupabase: no local extra accounts to upload"
    );
    return result;
  }

  console.info(
    "[admin-app] migrateLocalExtraAdminsToSupabase: uploading",
    extras.length,
    "account(s)"
  );

  for (const a of extras) {
    const err = await upsertExtraAdminAccountToSupabase(a);
    if (err != null) {
      result.failed += 1;
      result.errors.push(`${normalizeAdminAccountId(a.id)}: ${err}`);
      console.error(
        "[admin-app] migrateLocalExtraAdminsToSupabase upsert failed:",
        a.id,
        err
      );
    } else {
      result.uploaded += 1;
    }
  }

  console.info("[admin-app] migrateLocalExtraAdminsToSupabase done:", result);
  return result;
}

export async function upsertExtraAdminAccountToSupabase(
  account: AdminExtraAccountPersist
): Promise<string | null> {
  const sb = getSupabaseBrowserClient();
  if (sb == null) return "not_configured";

  const loginId = normalizeAdminAccountId(account.id);
  if (loginId === "" || isMasterAdminAccountId(loginId)) {
    return "invalid_id";
  }

  const { error } = await sb.from("admins").upsert(
    {
      login_id: loginId,
      password: account.password.trim(),
      display_name: account.user.trim(),
      role: normalizeExtraAdminRole(account.role),
      is_master: false,
    },
    { onConflict: "login_id" }
  );

  return error != null ? error.message : null;
}

export async function deleteExtraAdminAccountFromSupabase(
  loginId: string
): Promise<string | null> {
  const sb = getSupabaseBrowserClient();
  if (sb == null) return "not_configured";

  const id = normalizeAdminAccountId(loginId);
  if (id === "" || isMasterAdminAccountId(id)) return "invalid_id";

  const { error } = await sb.from("admins").delete().eq("login_id", id);
  return error != null ? error.message : null;
}

export type LoadExtraAdminAccountsOptions = {
  /** false면 local→Supabase 업로드 생략 (기본 true) */
  allowMigrate?: boolean;
};

/**
 * 서버 계정 목록 로드. extra 계정이 서버에 없고 로컬에만 있으면 1회 업로드(마이그레이션).
 */
export async function loadExtraAdminAccountsForSession(
  localFallback: readonly AdminExtraAccountPersist[],
  options?: LoadExtraAdminAccountsOptions
): Promise<AdminExtraAccountPersist[]> {
  const allowMigrate = options?.allowMigrate !== false;
  const localExtras = localFallback.filter((a) => !isMasterAdminAccountId(a.id));

  const remote = await fetchExtraAdminAccountsFromSupabase();
  if (remote == null) {
    console.warn(
      "[admin-app] loadExtraAdminAccountsForSession: using local list only (Supabase fetch failed)"
    );
    return localExtras;
  }

  if (allowMigrate && remote.length === 0 && localExtras.length > 0) {
    await migrateLocalExtraAdminsToSupabase(localFallback);
    const again = await fetchExtraAdminAccountsFromSupabase();
    return again ?? [];
  }

  if (allowMigrate && remote.length === 0 && localExtras.length === 0) {
    console.info(
      "[admin-app] loadExtraAdminAccountsForSession: remote has no extra admins; local extraAdminAccounts is empty (check ln-admin-app-state-v1 in DevTools)"
    );
  }

  return remote;
}

/** 마스터 행 표시용 (서버에 없어도 UI 호환) */
export function masterAdminListRow(): AdminExtraAccountPersist {
  return {
    id: MASTER_ADMIN_ID,
    password: "",
    user: MASTER_ADMIN_ID,
    role: "AMOUNT_ADMIN",
  };
}
