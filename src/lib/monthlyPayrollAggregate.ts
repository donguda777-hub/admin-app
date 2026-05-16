import {
  workerRateStorageKey,
  type WorkerRatePersist,
} from "../adminPersist";
import type { WorkerDayEntryRemoteRow } from "./mergeWorkerDayEntriesFromRemote";
import type { WorkerRemoteRow } from "./personnelWorkersFromSupabase";

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

function normalizeProjectKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function phoneLast4FromWorkerId(workerId: string): string {
  const id = workerId.trim();
  if (id.length >= 4) return id.slice(-4);
  return "";
}

function parseWorkHours(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.trim().replace(/,/g, "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function resolveRatesForWorker(
  workerId: string,
  workerName: string,
  workerRatesByKey: Record<string, WorkerRatePersist>
): WorkerRatePersist {
  const name = workerName.trim();
  const wid = workerId.trim();
  const primary = workerRatesByKey[workerRateStorageKey(wid || null, name)];
  if (primary != null) return primary;
  if (wid !== "") {
    const byName = workerRatesByKey[workerRateStorageKey(null, name)];
    if (byName != null) return byName;
  }
  return { base: null, spread: null };
}

type WorkerAccumulator = {
  totalEffort: number;
  totalNetPay: number | null;
  baseName: string;
  workerId: string;
};

export type MonthlyPayrollRow = {
  workerKey: string;
  workerId: string;
  baseName: string;
  phoneLast4: string;
  displayName: string;
  company: string;
  /** Supabase workers.phone */
  phone: string;
  totalEffort: number;
  /** 세전급여(실급여 합계) */
  totalNetPay: number | null;
};

/** 세후급여 = 세전급여 × 0.967 (원 단위 정수) */
export const MONTHLY_PAYROLL_POST_TAX_FACTOR = 0.967;

export function computeMonthlyPayrollPostTax(
  preTax: number | null
): number | null {
  if (preTax == null || !Number.isFinite(preTax)) return null;
  return Math.round(preTax * MONTHLY_PAYROLL_POST_TAX_FACTOR);
}

const PROJ_WORKER_SEP = "\u001f";

/**
 * `worker_day_entries` 월간 전체 행으로 작업자별 총공수·실급여를 합산한다.
 * 프로젝트·작업자별로 공수를 먼저 합친 뒤, 프로젝트 단위로 round((base-spread)×공수)한 실급여를 작업자별로 합산한다.
 * 단가는 공수표와 동일하게 `workerRatesByKey`만 사용한다(그리드/레거시 슬롯 단가 없음).
 */
export function computeMonthlyPayrollRowsFromServerEntries(
  entries: readonly WorkerDayEntryRemoteRow[],
  workerRatesByKey: Record<string, WorkerRatePersist>,
  workersByWorkerId: Map<string, WorkerRemoteRow>
): MonthlyPayrollRow[] {
  type Bucket = { effort: number; workerId: string; workerName: string };
  const effortByProjectWorker = new Map<string, Bucket>();

  for (const row of entries) {
    if (row == null || typeof row !== "object") continue;
    if (row.deleted_at != null && String(row.deleted_at).trim() !== "") {
      continue;
    }
    const wname = String(row.worker_name ?? "").trim();
    if (!wname) continue;
    const pn = String(row.project_name ?? "").trim();
    if (!pn) continue;
    const h = parseWorkHours(row.work_hours);
    if (!Number.isFinite(h) || h <= 0) continue;

    const wid = String(row.worker_id ?? "").trim();
    const wkey = wid !== "" ? `id:${wid}` : `name:${wname.replace(/\s+/g, " ")}`;
    const pkey = normalizeProjectKey(pn);
    const pw = `${pkey}${PROJ_WORKER_SEP}${wkey}`;

    const prev = effortByProjectWorker.get(pw);
    if (prev == null) {
      effortByProjectWorker.set(pw, {
        effort: h,
        workerId: wid,
        workerName: wname,
      });
    } else {
      prev.effort += h;
      if (wid !== "" && prev.workerId === "") prev.workerId = wid;
    }
  }

  const byWorker = new Map<string, WorkerAccumulator>();

  for (const { effort, workerId, workerName } of effortByProjectWorker.values()) {
    const wkey =
      workerId !== ""
        ? `id:${workerId}`
        : `name:${workerName.replace(/\s+/g, " ")}`;

    const { base, spread } = resolveRatesForWorker(
      workerId,
      workerName,
      workerRatesByKey
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

    const remote = workerId ? workersByWorkerId.get(workerId) : undefined;
    const baseName = (remote?.worker_name ?? workerName).trim();

    const acc = byWorker.get(wkey);
    if (acc == null) {
      byWorker.set(wkey, {
        totalEffort: effort,
        totalNetPay: net,
        baseName,
        workerId: workerId,
      });
    } else {
      acc.totalEffort += effort;
      if (net != null) {
        acc.totalNetPay =
          acc.totalNetPay == null ? net : acc.totalNetPay + net;
      }
      if (workerId !== "" && acc.workerId === "") acc.workerId = workerId;
      const bn = (remote?.worker_name ?? acc.baseName).trim();
      if (bn) acc.baseName = bn;
    }
  }

  const rows: MonthlyPayrollRow[] = [];
  for (const [key, acc] of byWorker) {
    const wid = acc.workerId;
    const remote = wid ? workersByWorkerId.get(wid) : undefined;
    const baseName = (remote?.worker_name ?? acc.baseName).trim();
    const phoneLast4 = wid ? phoneLast4FromWorkerId(wid) : "";
    const company = (remote?.company_name ?? "").trim();
    const phone = (remote?.phone ?? "").trim();
    rows.push({
      workerKey: key,
      workerId: wid,
      baseName,
      phoneLast4,
      displayName: baseName,
      company,
      phone,
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
