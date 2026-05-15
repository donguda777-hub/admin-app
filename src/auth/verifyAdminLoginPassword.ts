import { loadAdminPersist } from "../adminPersist";
import {
  MASTER_ADMIN_ID,
  MASTER_ADMIN_PASSWORD,
  normalizeAdminAccountId,
} from "./masterCredentials";

/** 로그인 화면과 동일 기준: 마스터 또는 extraAdminAccounts 비밀번호 일치 */
export function verifyAdminLoginPassword(
  userId: string,
  password: string
): boolean {
  const tid = userId.trim();
  const tpw = password.trim();
  if (
    normalizeAdminAccountId(tid) ===
      normalizeAdminAccountId(MASTER_ADMIN_ID) &&
    tpw === MASTER_ADMIN_PASSWORD
  ) {
    return true;
  }
  const extras = loadAdminPersist().extraAdminAccounts;
  return extras.some(
    (a) =>
      normalizeAdminAccountId(a.id) === normalizeAdminAccountId(tid) &&
      a.password === tpw
  );
}
