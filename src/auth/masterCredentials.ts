/** Client-side master credentials (no server in this phase). */
export const MASTER_ADMIN_ID = "donguda";
export const MASTER_ADMIN_PASSWORD = "lee21400**";

/** ID 비교용: 앞뒤 공백 제거 + 소문자 통일 */
export function normalizeAdminAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 마스터(donguda) 계정 여부 */
export function isMasterAdminAccountId(userId: string): boolean {
  return (
    normalizeAdminAccountId(userId) ===
    normalizeAdminAccountId(MASTER_ADMIN_ID)
  );
}
