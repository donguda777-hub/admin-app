import {
  WORKER_COLUMN_COUNT,
  bodyCellKey,
  defaultTimesheetGridPersisted,
  normalizeTimesheetProjectName,
  resolveWorkerRatesForSlot,
  timesheetGridStorageKey,
  timesheetWorkerIdCellKey,
  timesheetWorkerNameCellKey,
  type TimesheetGridPersisted,
  type WorkerRatePersist,
} from "../adminPersist";
import type { WorkerRemoteRow } from "./personnelWorkersFromSupabase";

function parseEffortCellValue(raw: string): number {
  const t = raw.trim().replace(/,/g, ".").replace(/\s+/g, "");
  if (t === "") return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** Supabase workers를 worker_id 단일 맵으로 평탄화 */
export function buildFlatWorkersByWorkerId(
  byGrade: Record<string, WorkerRemoteRow[]> | null
): Map<string, WorkerRemoteRow> {
  const m = new Map<string, WorkerRemoteRow>();
  if (byGrade == null) return m;
  for (const rows of Object.values(byGrade)) {
    for (const w of rows) {
      const id = (w.worker_id ?? "").trim();
      if (id !== "") m.set(id, w);
    }
  }
  return m;
}

function phoneLast4FromWorkerId(workerId: string): string {
  const id = workerId.trim();
  if (id.length >= 4) return id.slice(-4);
  return "";
}

type Acc = {
  totalEffort: number;
  totalNetPay: number | null;
  baseName: string;
  workerId: string;
};

export type MonthlyPayrollRow = {
  /** 내부 집계 키 (id:… / name:…) */
  workerKey: string;
  workerId: string;
  baseName: string;
  phoneLast4: string;
  displayName: string;
  company: string;
  totalEffort: number;
  totalNetPay: number | null;
};

/**
 * 선택 연·월의 모든 프로젝트 공수표 그리드에서 작업자별 총공수·실급여(기존 공수표와 동일 식)를 합산한다.
 */
export function computeMonthlyPayrollRows(params: {
  year: number;
  month1Based: number;
  projects: readonly { name: string }[];
  timesheetGrids: Record<string, TimesheetGridPersisted>;
  workerRatesByKey: Record<string, WorkerRatePersist>;
  workersByWorkerId: Map<string, WorkerRemoteRow>;
}): MonthlyPayrollRow[] {
  const {
    year,
    month1Based,
    projects,
    timesheetGrids,
    workerRatesByKey,
    workersByWorkerId,
  } = params;

  const y = year;
  const m0 = month1Based - 1;
  const last = new Date(y, m0 + 1, 0).getDate();
  const days = Array.from({ length: last }, (_, i) => i + 1);

  const byKey = new Map<string, Acc>();

  for (const p of projects) {
    const nameNorm = normalizeTimesheetProjectName(p.name);
    if (!nameNorm) continue;

    const gridKey = timesheetGridStorageKey(year, month1Based, nameNorm);
    const grid = timesheetGrids[gridKey] ?? defaultTimesheetGridPersisted();
    const body = grid.body ?? {};

    for (let wi = 0; wi < WORKER_COLUMN_COUNT; wi++) {
      const wname = (body[timesheetWorkerNameCellKey(wi)] ?? "").trim();
      if (!wname) continue;

      const wid = (body[timesheetWorkerIdCellKey(wi)] ?? "").trim();
      const aggKey = wid !== "" ? `id:${wid}` : `name:${wname.replace(/\s+/g, " ")}`;

      let effort = 0;
      for (const day of days) {
        effort += parseEffortCellValue(body[bodyCellKey(day, wi)] ?? "");
      }
      if (effort === 0) continue;

      const { base, spread } = resolveWorkerRatesForSlot(
        wi,
        body,
        workerRatesByKey,
        grid
      );
      let net: number | null = null;
      if (
        base != null &&
        spread != null &&
        Number.isFinite(base) &&
        Number.isFinite(spread)
      ) {
        net = Math.round((base - spread) * effort);
      }

      const remote = wid ? workersByWorkerId.get(wid) : undefined;
      const baseName = (remote?.worker_name ?? wname).trim();

      const prev = byKey.get(aggKey);
      if (prev == null) {
        byKey.set(aggKey, {
          totalEffort: effort,
          totalNetPay: net,
          baseName,
          workerId: wid,
        });
      } else {
        prev.totalEffort += effort;
        if (net != null) {
          prev.totalNetPay =
            prev.totalNetPay == null
              ? net
              : prev.totalNetPay + net;
        }
        if (wid !== "" && prev.workerId === "") prev.workerId = wid;
        const bn = (remote?.worker_name ?? prev.baseName).trim();
        if (bn) prev.baseName = bn;
      }
    }
  }

  const rows: MonthlyPayrollRow[] = [];
  for (const [key, acc] of byKey) {
    const wid = acc.workerId;
    const remote = wid ? workersByWorkerId.get(wid) : undefined;
    const baseName = (remote?.worker_name ?? acc.baseName).trim();
    const phoneLast4 = wid ? phoneLast4FromWorkerId(wid) : "";
    const company = (remote?.company_name ?? "").trim();
    rows.push({
      workerKey: key,
      workerId: wid,
      baseName,
      phoneLast4,
      displayName: baseName,
      company,
      totalEffort: acc.totalEffort,
      totalNetPay: acc.totalNetPay,
    });
  }

  const nameCount = new Map<string, number>();
  for (const r of rows) {
    nameCount.set(r.baseName, (nameCount.get(r.baseName) ?? 0) + 1);
  }
  for (const r of rows) {
    const dup = (nameCount.get(r.baseName) ?? 0) > 1;
    r.displayName =
      dup && r.phoneLast4 !== ""
        ? `${r.baseName}(${r.phoneLast4})`
        : r.baseName;
  }

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  return rows;
}
