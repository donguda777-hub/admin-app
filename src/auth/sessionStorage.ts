import { normalizeAdminAccountId } from "./masterCredentials";

const STORAGE_KEY = "adminAppLoggedInUserId";
/** 구버전(로그인 여부만 저장) — 마이그레이션 시 제거 */
const LEGACY_STORAGE_KEY = "adminAppLoggedIn";

/** 현재 로그인한 관리자 ID(정규화). 없으면 null */
export function readAdminSessionUserId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return null;
    return raw;
  } catch {
    return null;
  }
}

export function readAdminSession(): boolean {
  return readAdminSessionUserId() != null;
}

export function writeAdminSession(userId: string): void {
  localStorage.setItem(STORAGE_KEY, normalizeAdminAccountId(userId));
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
