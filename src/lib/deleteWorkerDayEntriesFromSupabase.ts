import { getSupabaseBrowserClient } from "./supabaseClient";
import {
  monthDateRangeForRemoteWorkerEntries,
  timesheetCompanyGroupSuffixForRemoteRow,
  type WorkerDayEntryRemoteRow,
} from "./mergeWorkerDayEntriesFromRemote";

function normalizeProjectKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function logWorkerDayDeleteError(label: string, err: unknown): void {
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    console.error(label, {
      message: typeof o.message === "string" ? o.message : undefined,
      code: typeof o.code === "string" ? o.code : undefined,
      details: typeof o.details === "string" ? o.details : undefined,
      hint: typeof o.hint === "string" ? o.hint : undefined,
      raw: err,
    });
    return;
  }
  console.error(label, err);
}

export type DeleteWorkerDayEntriesParams = {
  workerId: string;
  projectNameTrimmed: string;
  year: number;
  month1Based: number;
  /** 공수표 업체 열 인덱스 0..3 (TIMESHEET_COMPANY_GROUP_NAMES 순서) */
  companyGroupIndex: number;
  workersCompanyByWorkerId: ReadonlyMap<string, string | null> | null;
};

export type DeleteWorkerDayEntriesResult =
  | { ok: true; deletedCount: number }
  | { ok: false; message: string };

/**
 * 선택 프로젝트·연월·작업자·공수표 업체 그룹(표시 기준)에 해당하는 `worker_day_entries` 행만 삭제한다.
 * 그룹 판별은 공수표 병합 로직과 동일하게 `timesheetCompanyGroupSuffixForRemoteRow`를 사용한다.
 */
export async function deleteWorkerDayEntriesForMonthProjectAndCompanyGroup(
  p: DeleteWorkerDayEntriesParams
): Promise<DeleteWorkerDayEntriesResult> {
  const workerId = p.workerId.trim();
  if (!workerId) return { ok: false, message: "missing worker_id" };
  const projectKey = normalizeProjectKey(p.projectNameTrimmed);
  if (!projectKey) return { ok: false, message: "missing project" };
  const gi = Math.trunc(p.companyGroupIndex);
  if (!Number.isFinite(gi) || gi < 0 || gi > 3) {
    return { ok: false, message: "invalid company group" };
  }
  const suffixTarget = String(gi);

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    return { ok: false, message: "supabase not configured" };
  }

  const { start, end } = monthDateRangeForRemoteWorkerEntries(
    p.year,
    p.month1Based
  );

  try {
    const { data, error } = await supabase
      .from("worker_day_entries")
      .select("id, worker_id, project_name, company_name, deleted_at")
      .eq("worker_id", workerId)
      .gte("work_date", start)
      .lte("work_date", end)
      .is("deleted_at", null);

    if (error != null) {
      logWorkerDayDeleteError(
        "[Supabase] worker_day_entries delete prefetch failed",
        error
      );
      return { ok: false, message: error.message ?? "select failed" };
    }

    const rows = (Array.isArray(data) ? data : []) as WorkerDayEntryRemoteRow[];
    const ids: string[] = [];
    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      const pn = String(row.project_name ?? "").trim();
      if (normalizeProjectKey(pn) !== projectKey) continue;
      const suff = timesheetCompanyGroupSuffixForRemoteRow(
        row,
        p.workersCompanyByWorkerId
      );
      if (suff !== suffixTarget) continue;
      const id = row.id;
      if (id != null && String(id).trim() !== "") {
        ids.push(String(id));
      }
    }

    if (ids.length === 0) {
      return { ok: true, deletedCount: 0 };
    }

    const { error: delErr } = await supabase
      .from("worker_day_entries")
      .delete()
      .in("id", ids);

    if (delErr != null) {
      logWorkerDayDeleteError(
        "[Supabase] worker_day_entries delete failed",
        delErr
      );
      return { ok: false, message: delErr.message ?? "delete failed" };
    }

    return { ok: true, deletedCount: ids.length };
  } catch (e) {
    logWorkerDayDeleteError("[Supabase] worker_day_entries delete threw", e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "unknown error",
    };
  }
}
