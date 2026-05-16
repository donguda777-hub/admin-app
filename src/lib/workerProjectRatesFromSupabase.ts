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

function normalizeProjectKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeNameKey(s: string): string {
  return s
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function entryId(row: WorkerDayEntryRemoteRow): string | null {
  const id = row.id;
  if (id == null || id === "") return null;
  return String(id);
}

function rowMatchesProjectName(
  row: WorkerDayEntryRemoteRow,
  projectKey: string
): boolean {
  if (projectKey === "") return false;
  return normalizeProjectKey(String(row.project_name ?? "")) === projectKey;
}

export type WorkerProjectRateLookupParams = {
  projectId: string;
  projectName: string;
  workerId: string;
  workerName: string;
  year: number;
  month1Based: number;
};

type RateMatchStrategy =
  | "project_id+worker_id"
  | "project_name+worker_id"
  | "project_name+worker_name";

type FindWorkerDayEntriesForRatesResult = {
  ids: string[];
  strategy: RateMatchStrategy | null;
  rows: WorkerDayEntryRemoteRow[];
};

const RATE_MATCH_SELECT =
  "id, worker_id, worker_name, company_name, project_id, project_name, work_date, work_hours, base_rate, profit_rate, deleted_at";

/**
 * 기준/차익 갱신 대상 `worker_day_entries` 행 id를 우선순위별로 찾는다.
 * (worker-hours-app은 project_name+worker_id 기준으로 공수를 저장한다.)
 */
async function findWorkerDayEntryIdsForRates(
  params: WorkerProjectRateLookupParams
): Promise<FindWorkerDayEntriesForRatesResult> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    return { ids: [], strategy: null, rows: [] };
  }

  const { start, end } = monthDateRangeForRemoteWorkerEntries(
    params.year,
    params.month1Based
  );
  const projectId = params.projectId.trim();
  const projectName = params.projectName.trim();
  const projectKey = normalizeProjectKey(projectName);
  const workerId = params.workerId.trim();
  const workerName = params.workerName.trim();
  const nameKey = normalizeNameKey(workerName);

  const strategiesTried: string[] = [];
  const monthBase = () =>
    supabase
      .from("worker_day_entries")
      .select(RATE_MATCH_SELECT)
      .gte("work_date", start)
      .lte("work_date", end)
      .is("deleted_at", null);

  const toRows = (data: unknown): WorkerDayEntryRemoteRow[] =>
    (Array.isArray(data) ? data : []) as WorkerDayEntryRemoteRow[];

  const idsFromRows = (rows: WorkerDayEntryRemoteRow[]): string[] =>
    rows.map(entryId).filter((id): id is string => id != null);

  // 1. project_id + worker_id + 해당 월
  if (projectId !== "" && workerId !== "") {
    strategiesTried.push("project_id+worker_id");
    const { data, error } = await monthBase()
      .eq("project_id", projectId)
      .eq("worker_id", workerId);
    if (error != null) throw error;
    const rows = toRows(data);
    const ids = idsFromRows(rows);
    if (ids.length > 0) {
      return { ids, strategy: "project_id+worker_id", rows };
    }
  }

  // 2. project_name + worker_id + 해당 월
  if (projectKey !== "" && workerId !== "") {
    strategiesTried.push("project_name+worker_id");
    let rows: WorkerDayEntryRemoteRow[] = [];
    if (projectName !== "") {
      const { data, error } = await monthBase()
        .eq("project_name", projectName)
        .eq("worker_id", workerId);
      if (error != null) throw error;
      rows = toRows(data);
    }
    if (rows.length === 0) {
      const { data, error } = await monthBase().eq("worker_id", workerId);
      if (error != null) throw error;
      rows = toRows(data).filter((r) => rowMatchesProjectName(r, projectKey));
    }
    const ids = idsFromRows(rows);
    if (ids.length > 0) {
      return { ids, strategy: "project_name+worker_id", rows };
    }
  }

  // 3. project_name + worker_name + 해당 월
  if (projectKey !== "" && workerName !== "") {
    strategiesTried.push("project_name+worker_name");
    let rows: WorkerDayEntryRemoteRow[] = [];
    if (projectName !== "") {
      const { data, error } = await monthBase()
        .eq("project_name", projectName)
        .eq("worker_name", workerName);
      if (error != null) throw error;
      rows = toRows(data);
    }
    if (rows.length === 0) {
      const { data, error } = await monthBase().eq("worker_name", workerName);
      if (error != null) throw error;
      rows = toRows(data).filter(
        (r) =>
          rowMatchesProjectName(r, projectKey) &&
          normalizeNameKey(String(r.worker_name ?? "")) === nameKey
      );
    }
    const ids = idsFromRows(rows);
    if (ids.length > 0) {
      return { ids, strategy: "project_name+worker_name", rows };
    }
  }

  let diagnosticSample: WorkerDayEntryRemoteRow[] = [];
  try {
    if (workerId !== "") {
      const { data } = await monthBase().eq("worker_id", workerId).limit(15);
      diagnosticSample = toRows(data);
    } else if (workerName !== "") {
      const { data } = await monthBase().eq("worker_name", workerName).limit(15);
      diagnosticSample = toRows(data);
    } else if (projectName !== "") {
      const { data } = await monthBase().eq("project_name", projectName).limit(15);
      diagnosticSample = toRows(data);
    }
  } catch {
    /* diagnostic only */
  }

  console.error(
    "[Supabase] worker rate: no matching worker_day_entries for base_rate/profit_rate update",
    {
      lookupParams: {
        projectId: projectId || null,
        projectName: projectName || null,
        workerId: workerId || null,
        workerName: workerName || null,
        workDateRange: { start, end },
        year: params.year,
        month: params.month1Based,
      },
      strategiesTried,
      diagnosticSample: diagnosticSample.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        project_name: r.project_name,
        worker_id: r.worker_id,
        worker_name: r.worker_name,
        work_date: r.work_date,
        base_rate: r.base_rate,
        profit_rate: r.profit_rate,
      })),
    }
  );

  return { ids: [], strategy: null, rows: [] };
}

/**
 * 원격 `worker_day_entries` 행에서 프로젝트·작업자별 base_rate/profit_rate를 추출한다.
 * project_id가 비어 있는 행은 project_name(정규화)으로 매칭한다.
 */
export function ingestProjectWorkerRatesFromRows(
  projectId: string,
  projectName: string,
  rows: readonly WorkerDayEntryRemoteRow[]
): Record<string, WorkerRatePersist> {
  const pid = projectId.trim();
  const projectKey = normalizeProjectKey(projectName);
  const out: Record<string, WorkerRatePersist> = {};

  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const rowPid = String(row.project_id ?? "").trim();
    const matchesProject =
      (pid !== "" && rowPid === pid) ||
      (projectKey !== "" &&
        rowMatchesProjectName(row, projectKey));
    if (!matchesProject) continue;

    const wid = String(row.worker_id ?? "").trim();
    if (wid === "") continue;
    const base = parseDbRate(row.base_rate);
    const spread = parseDbRate(row.profit_rate);
    if (base == null && spread == null) continue;

    const storagePid = pid !== "" ? pid : `name:${projectKey}`;
    const key = projectWorkerRateStorageKey(storagePid, wid);
    const prev = out[key];
    out[key] = {
      base: base ?? prev?.base ?? null,
      spread: spread ?? prev?.spread ?? null,
    };
  }
  return out;
}

export async function fetchWorkerProjectRatesForMonth(
  params: WorkerProjectRateLookupParams
): Promise<{ base: number | null; spread: number | null; error: string | null }> {
  if (getSupabaseBrowserClient() == null) {
    return { base: null, spread: null, error: "not_configured" };
  }
  try {
    const { rows, strategy } = await findWorkerDayEntryIdsForRates(params);
    if (strategy == null || rows.length === 0) {
      return { base: null, spread: null, error: null };
    }
    const row = rows[0]!;
    return {
      base: parseDbRate(row.base_rate),
      spread: parseDbRate(row.profit_rate),
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
  matchStrategy: RateMatchStrategy | null;
};

/**
 * 해당 월·프로젝트·작업자에 속한 기존 공수 행만 찾아 base_rate/profit_rate를 갱신한다.
 * 공수 행을 새로 만들지 않는다.
 */
export async function updateWorkerProjectRatesForMonth(
  params: WorkerProjectRateLookupParams & {
    base: number | null;
    spread: number | null;
  }
): Promise<UpdateWorkerProjectRatesResult> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    return {
      ok: false,
      updatedRowCount: 0,
      message: "not_configured",
      matchStrategy: null,
    };
  }
  try {
    const { ids, strategy } = await findWorkerDayEntryIdsForRates(params);
    if (ids.length === 0) {
      return {
        ok: true,
        updatedRowCount: 0,
        message: "",
        matchStrategy: null,
      };
    }

    const { data, error } = await supabase
      .from("worker_day_entries")
      .update({
        base_rate: params.base,
        profit_rate: params.spread,
      })
      .in("id", ids)
      .select("id");

    if (error != null) {
      return {
        ok: false,
        updatedRowCount: 0,
        message: error.message ?? "update failed",
        matchStrategy: strategy,
      };
    }
    const n = Array.isArray(data) ? data.length : 0;
    if (strategy != null && n > 0) {
      console.log("[Supabase] worker rate update ok", {
        strategy,
        updatedRowCount: n,
        projectName: params.projectName.trim() || null,
        workerId: params.workerId.trim() || null,
      });
    }
    return {
      ok: true,
      updatedRowCount: n,
      message: "",
      matchStrategy: strategy,
    };
  } catch (e) {
    return {
      ok: false,
      updatedRowCount: 0,
      message: e instanceof Error ? e.message : "unknown",
      matchStrategy: null,
    };
  }
}
