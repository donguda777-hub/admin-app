import type { AdminExtraAccountPersist } from "../adminPersist";
import { isMasterAdminAccountId, normalizeAdminAccountId } from "./masterCredentials";

export type ExtraAdminRole = "AMOUNT_ADMIN" | "BASIC_ADMIN";

export type AdminRole = "MASTER" | ExtraAdminRole;

export const EXTRA_ADMIN_ROLE_LABELS: Record<ExtraAdminRole, string> = {
  AMOUNT_ADMIN: "\uAE08\uC561\uC5F4\uB78C \uAD00\uB9AC\uC790",
  BASIC_ADMIN: "\uC77C\uBC18 \uAD00\uB9AC\uC790",
};

export function normalizeExtraAdminRole(raw: unknown): ExtraAdminRole {
  if (raw === "BASIC_ADMIN") return "BASIC_ADMIN";
  return "AMOUNT_ADMIN";
}

export function resolveAdminRole(
  userId: string,
  extraAccounts: readonly AdminExtraAccountPersist[]
): AdminRole {
  if (isMasterAdminAccountId(userId)) return "MASTER";
  const hit = extraAccounts.find(
    (a) => normalizeAdminAccountId(a.id) === normalizeAdminAccountId(userId)
  );
  if (hit == null) return "BASIC_ADMIN";
  return normalizeExtraAdminRole(hit.role);
}

export function canManageAdminAccounts(role: AdminRole): boolean {
  return role === "MASTER";
}

/** 급여·실급여·L&N 행/열 표시 */
export function canViewAmountRows(role: AdminRole): boolean {
  return role === "MASTER" || role === "AMOUNT_ADMIN";
}

/** L&N 금액 보기(마스킹 해제) */
export function canUnlockAmountRows(role: AdminRole): boolean {
  return canViewAmountRows(role);
}
