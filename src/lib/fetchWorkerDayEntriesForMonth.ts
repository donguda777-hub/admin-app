import type { WorkerDayEntryRemoteRow } from "./mergeWorkerDayEntriesFromRemote";
import { monthDateRangeForRemoteWorkerEntries } from "./mergeWorkerDayEntriesFromRemote";
import { getSupabaseBrowserClient } from "./supabaseClient";
import { WORKER_DAY_ENTRY_SELECT_COLUMNS } from "./workerDayEntrySelectColumns";

export type FetchWorkerDayEntriesForMonthResult = {
  rows: WorkerDayEntryRemoteRow[];
  error: string | null;
};

/**
 * 선택 연·월 구간의 `worker_day_entries` 전부(모든 프로젝트)를 조회한다.
 * 관리자가 공수표에서 프로젝트를 연 적이 없어도 동일하다.
 */
export async function fetchWorkerDayEntriesForMonth(
  year: number,
  month1Based: number
): Promise<FetchWorkerDayEntriesForMonthResult> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    return { rows: [], error: "not_configured" };
  }
  const { start, end } = monthDateRangeForRemoteWorkerEntries(
    year,
    month1Based
  );
  try {
    /** PostgREST/프로젝트 설정에 따라 한 번에 가져오는 행 수가 제한될 수 있어 페이지로 모두 수집한다. */
    const pageSize = 1000;
    const rows: WorkerDayEntryRemoteRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("worker_day_entries")
        .select(WORKER_DAY_ENTRY_SELECT_COLUMNS)
        .gte("work_date", start)
        .lte("work_date", end)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error != null) {
        return { rows: [], error: error.message ?? "select failed" };
      }
      const chunk = (Array.isArray(data) ? data : []) as WorkerDayEntryRemoteRow[];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return { rows, error: null };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}
