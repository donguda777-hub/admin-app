import type { WorkerRatePersist } from "../adminPersist";
import { fetchWorkerDayEntriesForMonth } from "./fetchWorkerDayEntriesForMonth";
import {
  buildFlatWorkersByWorkerId,
  computeMonthlyPayrollRowsFromServerEntries,
} from "./monthlyPayrollAggregate";
import type { MonthlyPayrollRow } from "./monthlyPayrollAggregate";
import { fetchWorkersGroupedByPersonnelGrade } from "./personnelWorkersFromSupabase";

export type { MonthlyPayrollRow } from "./monthlyPayrollAggregate";

export type MonthlyPayrollLoadResult = {
  rows: MonthlyPayrollRow[];
  /** `worker_day_entries` 조회 실패 시에만 설정. workers 조회 실패는 소속만 비고 집계는 진행한다. */
  error: string | null;
};

/**
 * 월급여 전용 로더. 공수표 그리드/state/cache/localStorage와 무관하게
 * 해당 연·월의 `worker_day_entries` 전체 + `workers`(소속·이름)만으로 집계한다.
 */
export async function loadMonthlyPayrollData(
  year: number,
  month1Based: number,
  workerRatesByKey: Record<string, WorkerRatePersist>
): Promise<MonthlyPayrollLoadResult> {
  const [entriesRes, workersRes] = await Promise.all([
    fetchWorkerDayEntriesForMonth(year, month1Based),
    fetchWorkersGroupedByPersonnelGrade(),
  ]);

  if (entriesRes.error != null) {
    return { rows: [], error: entriesRes.error };
  }

  if (workersRes.error != null && workersRes.error !== "not_configured") {
    console.error("[Supabase] loadMonthlyPayrollData: workers select failed", {
      message: workersRes.error,
      year,
      month1Based,
    });
  }

  const workersByWorkerId = buildFlatWorkersByWorkerId(workersRes.byGrade);
  const rows = computeMonthlyPayrollRowsFromServerEntries(
    entriesRes.rows,
    workerRatesByKey,
    workersByWorkerId
  );

  return { rows, error: null };
}
