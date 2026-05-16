import type { WorkerRatePersist } from "../adminPersist";
import type { WorkerDayEntryRemoteRow } from "./mergeWorkerDayEntriesFromRemote";
import { monthDateRangeForRemoteWorkerEntries } from "./mergeWorkerDayEntriesFromRemote";
import { getSupabaseBrowserClient } from "./supabaseClient";

export function projectWorkerRateStorageKey(
  projectId: string,
  workerId: string
): string {
  return `pj:${projectId.trim()}\u001f${workerId.trim()}`;
}

export function stripProjectWorkerRateKeysForProject(
  prev: Record<string, WorkerRatePersist>,
  projectId: string
): Record<string, WorkerRatePersist> {
  const prefix = `pj:${projectId.trim()}\u001f`;
  const out: Record<string, WorkerRatePersist> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (!k.startsWith(prefix)) out[k] = v;
  }
  return out;
}

function parseDbRate(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 원격 `worker_day_entries` 행에서 project_id+worker_id별 base_rate/profit_rate를 추출한다.
 * 동일 키에 여러 행이 있으면 null이 아닌 값으로 채운다.
 */
export function ingestProjectWorkerRatesFromRows(
  projectId: string,
  rows: readonly WorkerDayEntryRemoteRow[]
): Record<string, WorkerRatePersist> {
  const pid = projectId.trim();
  const out: Record<string, WorkerRatePersist> = {};
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    if (String(row.project_id ?? "").trim() !== pid) continue;
    const wid = String(row.worker_id ?? "").trim();
    if (wid === "") continue;
    const base = parseDbRate(row.base_rate);
    const spread = parseDbRate(row.profit_rate);
    if (base == null && spread == null) continue;
    const key = projectWorkerRateStorageKey(pid, wid);
    const prev = out[key];
    out[key] = {
      base: base ?? prev?.base ?? null,
      spread: spread ?? prev?.spread ?? null,
    };
  }
  return out;
}

export async function fetchWorkerProjectRatesForMonth(params: {
  projectId: string;
  workerId: string;
  year: number;
  month1Based: number;
}): Promise<{ base: number | null; spread: number | null; error: string | null }> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    return { base: null, spread: null, error: "not_configured" };
  }
  const { start, end } = monthDateRangeForRemoteWorkerEntries(
    params.year,
    params.month1Based
  );
  try {
    const { data, error } = await supabase
      .from("worker_day_entries")
      .select("base_rate, profit_rate")
      .eq("project_id", params.projectId.trim())
      .eq("worker_id", params.workerId.trim())
      .gte("work_date", start)
      .lte("work_date", end)
      .is("deleted_at", null)
      .order("work_date", { ascending: false })
      .limit(1);
    if (error != null) {
      return {
        base: null,
        spread: null,
        error: error.message ?? "select failed",
      };
    }
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (row == null || typeof row !== "object") {
      return { base: null, spread: null, error: null };
    }
    const o = row as Record<string, unknown>;
    return {
      base: parseDbRate(o.base_rate),
      spread: parseDbRate(o.profit_rate),
      error: null,
    };
  } catch (e) {
    return {
      base: null,
      spread: null,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

export type UpdateWorkerProjectRatesResult = {
  ok: boolean;
  updatedRowCount: number;
  message: string;
};

/**
 * 해당 월·프로젝트·작업자에 속한 모든 `worker_day_entries` 행의 base_rate/profit_rate를 동일 값으로 갱신한다.
 */
export async function updateWorkerProjectRatesForMonth(params: {
  projectId: string;
  workerId: string;
  year: number;
  month1Based: number;
  base: number | null;
  spread: number | null;
}): Promise<UpdateWorkerProjectRatesResult> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    return { ok: false, updatedRowCount: 0, message: "not_configured" };
  }
  const { start, end } = monthDateRangeForRemoteWorkerEntries(
    params.year,
    params.month1Based
  );
  try {
    const { data, error } = await supabase
      .from("worker_day_entries")
      .update({
        base_rate: params.base,
        profit_rate: params.spread,
      })
      .eq("project_id", params.projectId.trim())
      .eq("worker_id", params.workerId.trim())
      .gte("work_date", start)
      .lte("work_date", end)
      .is("deleted_at", null)
      .select("id");
    if (error != null) {
      return {
        ok: false,
        updatedRowCount: 0,
        message: error.message ?? "update failed",
      };
    }
    const n = Array.isArray(data) ? data.length : 0;
    return { ok: true, updatedRowCount: n, message: "" };
  } catch (e) {
    return {
      ok: false,
      updatedRowCount: 0,
      message: e instanceof Error ? e.message : "unknown",
    };
  }
}
