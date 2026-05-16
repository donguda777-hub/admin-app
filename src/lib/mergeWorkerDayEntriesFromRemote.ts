import {
  bodyCellKey,
  DEFAULT_COMPANY_WORKER_SLOT_COUNTS,
  normalizeCompanyWorkerSlotCounts,
  timesheetWorkerIdCellKey,
  timesheetWorkerNameCellKey,
  type TimesheetGridPersisted,
} from "../adminPersist";
import {
  companyWorkerSlotRanges,
  mapStoredCompanyToTimesheetGroupIndex,
} from "./timesheetCompanyGroups";

/** Supabase `worker_day_entries` 행(조회 select 결과) */
export type WorkerDayEntryRemoteRow = {
  id?: string | number | null;
  worker_id?: string | null;
  worker_name?: string | null;
  company_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  work_date?: string | null;
  work_hours?: number | string | null;
  memo?: string | null;
  deleted_at?: string | null;
};

export function monthDateRangeForRemoteWorkerEntries(
  year: number,
  month1Based: number
): { start: string; end: string; lastDay: number } {
  const m = String(month1Based).padStart(2, "0");
  const lastDay = new Date(year, month1Based, 0).getDate();
  const end = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
  return {
    start: `${year}-${m}-01`,
    end,
    lastDay,
  };
}

function normalizeNameKey(s: string): string {
  return s
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeProjectKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 집계 키: 일·작업자명·업체그룹(0–3 또는 na) */
const AGG_KEY_SEP = "\u001f";

/**
 * 공수표 업체 열 배치와 동일한 기준으로 `worker_day_entries` 행의 업체 그룹 접미사를 계산한다.
 * (`"0"`…`"3"` 또는 `"na"`)
 */
export function timesheetCompanyGroupSuffixForRemoteRow(
  row: WorkerDayEntryRemoteRow,
  workersCompanyByWorkerId: ReadonlyMap<string, string | null> | null | undefined
): string {
  let g = mapStoredCompanyToTimesheetGroupIndex(row.company_name);
  if (g != null) return String(g);
  const wid = String(row.worker_id ?? "").trim();
  if (wid && workersCompanyByWorkerId != null) {
    g = mapStoredCompanyToTimesheetGroupIndex(
      workersCompanyByWorkerId.get(wid) ?? null
    );
    if (g != null) return String(g);
  }
  return "na";
}

function compositeSlotKey(nameKey: string, groupSuffix: string): string {
  return `${nameKey}${AGG_KEY_SEP}${groupSuffix}`;
}

function fillBodyFromRemoteWorkerDayRows(params: {
  rows: WorkerDayEntryRemoteRow[];
  projectNameTrimmed: string;
  lastDay: number;
  slotCount: number;
  companyCounts: number[];
  workersCompanyByWorkerId: ReadonlyMap<string, string | null> | null | undefined;
  diag?: MergeRemoteWorkerDayEntriesDiag;
}): Record<string, string> {
  const {
    rows,
    projectNameTrimmed,
    lastDay,
    slotCount,
    companyCounts,
    workersCompanyByWorkerId,
    diag,
  } = params;
  const body: Record<string, string> = {};
  const aggregated = new Map<string, number>();
  const projectKey = normalizeProjectKey(projectNameTrimmed);

  if (diag) {
    diag.rowCountIn = Array.isArray(rows) ? rows.length : 0;
    diag.rowCountProjectMatch = 0;
    diag.aggKeys = 0;
    diag.cellsWritten = 0;
    diag.slotsFilledByEmptyColumn = 0;
  }

  if (!Array.isArray(rows)) return body;

  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    if (row.deleted_at != null && String(row.deleted_at).trim() !== "") {
      continue;
    }
    const pn = String(row.project_name ?? "").trim();
    if (normalizeProjectKey(pn) !== projectKey) continue;
    if (diag) diag.rowCountProjectMatch += 1;
    const wd =
      typeof row.work_date === "string"
        ? row.work_date
        : row.work_date != null
          ? String(row.work_date)
          : "";
    const day = dayFromWorkDate(wd);
    if (day == null || day < 1 || day > lastDay) continue;
    const wn = String(row.worker_name ?? "").trim();
    if (!wn) continue;
    const hRaw = row.work_hours;
    const h =
      typeof hRaw === "number"
        ? hRaw
        : typeof hRaw === "string"
          ? Number.parseFloat(String(hRaw).trim().replace(/,/g, "."))
          : Number.NaN;
    if (!Number.isFinite(h) || h <= 0) continue;
    const groupSuffix = timesheetCompanyGroupSuffixForRemoteRow(
      row,
      workersCompanyByWorkerId
    );
    const aggKey = `${day}${AGG_KEY_SEP}${wn}${AGG_KEY_SEP}${groupSuffix}`;
    aggregated.set(aggKey, (aggregated.get(aggKey) ?? 0) + h);
  }
  if (diag) diag.aggKeys = aggregated.size;

  const workerIdByName = buildWorkerIdByNameMap(rows, projectKey, lastDay);
  const ranges = companyWorkerSlotRanges(companyCounts);
  const workerSlotByComposite = new Map<string, number>();
  const usedSlots = new Set<number>();

  const assignWorkerSlot = (
    workerName: string,
    groupSuffix: string
  ): number => {
    const nameKey = normalizeNameKey(workerName);
    const ck = compositeSlotKey(nameKey, groupSuffix);
    const existing = workerSlotByComposite.get(ck);
    if (existing !== undefined) {
      setWorkerIdOnSlot(body, existing, workerName, workerIdByName);
      return existing;
    }

    const takeNextInRange = (start: number, endEx: number): number => {
      for (let wi = start; wi < endEx && wi < slotCount; wi++) {
        if (usedSlots.has(wi)) continue;
        const nk = timesheetWorkerNameCellKey(wi);
        if ((body[nk] ?? "").trim() === "") {
          body[nk] = workerName;
          setWorkerIdOnSlot(body, wi, workerName, workerIdByName);
          workerSlotByComposite.set(ck, wi);
          usedSlots.add(wi);
          if (diag) diag.slotsFilledByEmptyColumn += 1;
          return wi;
        }
      }
      for (let wi = start; wi < endEx && wi < slotCount; wi++) {
        if (usedSlots.has(wi)) continue;
        const nk = timesheetWorkerNameCellKey(wi);
        body[nk] = workerName;
        setWorkerIdOnSlot(body, wi, workerName, workerIdByName);
        workerSlotByComposite.set(ck, wi);
        usedSlots.add(wi);
        if (diag) diag.slotsFilledByEmptyColumn += 1;
        return wi;
      }
      return -1;
    };

    const gIdx =
      groupSuffix === "na"
        ? null
        : Number.parseInt(groupSuffix, 10);
    if (
      gIdx != null &&
      Number.isFinite(gIdx) &&
      gIdx >= 0 &&
      gIdx < ranges.length
    ) {
      const r = ranges[gIdx]!;
      const wi = takeNextInRange(r.start, r.end);
      if (wi >= 0) return wi;
    }

    for (let wi = 0; wi < slotCount; wi++) {
      if (usedSlots.has(wi)) continue;
      const nk = timesheetWorkerNameCellKey(wi);
      if ((body[nk] ?? "").trim() === "") {
        body[nk] = workerName;
        setWorkerIdOnSlot(body, wi, workerName, workerIdByName);
        workerSlotByComposite.set(ck, wi);
        usedSlots.add(wi);
        if (diag) diag.slotsFilledByEmptyColumn += 1;
        return wi;
      }
    }
    for (let wi = 0; wi < slotCount; wi++) {
      if (usedSlots.has(wi)) continue;
      const nk = timesheetWorkerNameCellKey(wi);
      body[nk] = workerName;
      setWorkerIdOnSlot(body, wi, workerName, workerIdByName);
      workerSlotByComposite.set(ck, wi);
      usedSlots.add(wi);
      if (diag) diag.slotsFilledByEmptyColumn += 1;
      return wi;
    }
    return -1;
  };

  const slotWorkList: { workerName: string; groupSuffix: string }[] = [];
  const seenComposite = new Set<string>();
  for (const k of aggregated.keys()) {
    const parts = k.split(AGG_KEY_SEP);
    if (parts.length !== 3) continue;
    const workerName = parts[1]!;
    const groupSuffix = parts[2]!;
    const nameKey = normalizeNameKey(workerName);
    if (!nameKey) continue;
    const ck = compositeSlotKey(nameKey, groupSuffix);
    if (seenComposite.has(ck)) continue;
    seenComposite.add(ck);
    slotWorkList.push({ workerName, groupSuffix });
  }
  slotWorkList.sort((a, b) => {
    const oa = a.groupSuffix === "na" ? 999 : Number.parseInt(a.groupSuffix, 10);
    const ob = b.groupSuffix === "na" ? 999 : Number.parseInt(b.groupSuffix, 10);
    const na = Number.isFinite(oa) ? oa : 999;
    const nb = Number.isFinite(ob) ? ob : 999;
    if (na !== nb) return na - nb;
    return a.workerName.localeCompare(b.workerName, "ko");
  });
  for (const { workerName, groupSuffix } of slotWorkList) {
    assignWorkerSlot(workerName, groupSuffix);
  }

  for (const [aggKey, sumHours] of aggregated) {
    const parts = aggKey.split(AGG_KEY_SEP);
    if (parts.length !== 3) continue;
    const dayStr = parts[0]!;
    const workerName = parts[1]!;
    const groupSuffix = parts[2]!;
    const day = Number.parseInt(dayStr, 10);
    if (!Number.isFinite(day)) continue;
    const wi = workerSlotByComposite.get(
      compositeSlotKey(normalizeNameKey(workerName), groupSuffix)
    );
    if (wi === undefined) continue;
    const nextVal = formatWorkHoursForBodyCell(sumHours);
    if (nextVal === "") continue;
    body[bodyCellKey(day, wi)] = nextVal;
    if (diag) diag.cellsWritten += 1;
  }

  return body;
}

/** 프로젝트·기간 내 작업자명 → worker_id (첫 유효 id) */
function buildWorkerIdByNameMap(
  rows: WorkerDayEntryRemoteRow[],
  projectKey: string,
  lastDay: number
): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    if (row.deleted_at != null && String(row.deleted_at).trim() !== "") {
      continue;
    }
    const pn = String(row.project_name ?? "").trim();
    if (normalizeProjectKey(pn) !== projectKey) continue;
    const wd =
      typeof row.work_date === "string"
        ? row.work_date
        : row.work_date != null
          ? String(row.work_date)
          : "";
    const day = dayFromWorkDate(wd);
    if (day == null || day < 1 || day > lastDay) continue;
    const wn = String(row.worker_name ?? "").trim();
    const wid = String(row.worker_id ?? "").trim();
    if (!wn || !wid) continue;
    const nk = normalizeNameKey(wn);
    if (!out.has(nk)) out.set(nk, wid);
  }
  return out;
}

function setWorkerIdOnSlot(
  body: Record<string, string>,
  wi: number,
  workerName: string,
  workerIdByName: Map<string, string>
): void {
  const wid = workerIdByName.get(normalizeNameKey(workerName)) ?? "";
  const idKey = timesheetWorkerIdCellKey(wi);
  if (wid !== "") body[idKey] = wid;
  else delete body[idKey];
}

/** Supabase에 공수 없는 슬롯에도 붙여넣기·레이아웃으로 넣은 작업자명 유지 */
function preserveLayoutWorkerNamesInBody(
  body: Record<string, string>,
  layoutGrid: TimesheetGridPersisted,
  slotCount: number
): void {
  for (let wi = 0; wi < slotCount; wi++) {
    const nk = timesheetWorkerNameCellKey(wi);
    if ((body[nk] ?? "").trim() !== "") continue;
    const layoutName = (
      layoutGrid.body[timesheetWorkerNameCellKey(wi)] ?? ""
    ).trim();
    if (layoutName !== "") body[nk] = layoutName;
  }
}

function dayFromWorkDate(workDate: string): number | null {
  const s = workDate.trim().split("T")[0];
  const parts = s.split("-");
  if (parts.length < 3) return null;
  const d = Number.parseInt(parts[2]!, 10);
  if (!Number.isFinite(d)) return null;
  return d;
}

function formatWorkHoursForBodyCell(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-12) return "";
  const r = Math.round(value * 10000) / 10000;
  if (Math.abs(r) < 1e-12) return "";
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(4).replace(/\.?0+$/, "");
}

function findWorkerIndexForName(
  body: Record<string, string>,
  targetName: string,
  slotCount: number
): number {
  const t = normalizeNameKey(targetName);
  if (!t) return -1;
  for (let wi = 0; wi < slotCount; wi++) {
    const cell = normalizeNameKey(body[timesheetWorkerNameCellKey(wi)] ?? "");
    if (cell === t) return wi;
  }
  return -1;
}

/** 해당 일의 이름·공수가 모두 비어 있는 첫 슬롯 (원격 작업자 배정용) */
function findFirstEmptySlotForDay(
  body: Record<string, string>,
  day: number,
  slotCount: number
): number {
  for (let wi = 0; wi < slotCount; wi++) {
    const nk = timesheetWorkerNameCellKey(wi);
    const ck = bodyCellKey(day, wi);
    const name = (body[nk] ?? "").trim();
    const effort = (body[ck] ?? "").trim();
    if (name === "" && effort === "") return wi;
  }
  return -1;
}

export type MergeRemoteWorkerDayEntriesDiag = {
  rowCountIn: number;
  rowCountProjectMatch: number;
  aggKeys: number;
  cellsWritten: number;
  slotsFilledByEmptyColumn: number;
};

const EMPTY_GRID_BODY: TimesheetGridPersisted = {
  body: {},
  money: {},
  workerBaseRates: {},
  workerSpreadRates: {},
};

export type ApplyRemoteEffortOptions = {
  /** worker_id → workers.company_name (행에 company_name 없을 때만 사용) */
  workersCompanyByWorkerId?: ReadonlyMap<string, string | null> | null;
};

/**
 * Supabase `worker_day_entries` 조회 결과만으로 공수표 body를 만든다.
 * localStorage·기존 그리드 값은 사용하지 않는다. 조회 행이 없으면 빈 그리드.
 */
export function buildTimesheetGridFromRemoteRows(
  rows: WorkerDayEntryRemoteRow[],
  projectNameTrimmed: string,
  lastDay: number,
  slotCount: number,
  diag?: MergeRemoteWorkerDayEntriesDiag,
  opts?: ApplyRemoteEffortOptions | null
): TimesheetGridPersisted {
  try {
    if (diag) {
      diag.rowCountIn = Array.isArray(rows) ? rows.length : 0;
      diag.rowCountProjectMatch = 0;
      diag.aggKeys = 0;
      diag.cellsWritten = 0;
      diag.slotsFilledByEmptyColumn = 0;
    }

    if (!Array.isArray(rows)) {
      return { ...EMPTY_GRID_BODY, body: {} };
    }

    const companyCounts = normalizeCompanyWorkerSlotCounts([
      ...DEFAULT_COMPANY_WORKER_SLOT_COUNTS,
    ]);
    const body = fillBodyFromRemoteWorkerDayRows({
      rows,
      projectNameTrimmed,
      lastDay,
      slotCount,
      companyCounts,
      workersCompanyByWorkerId: opts?.workersCompanyByWorkerId ?? null,
      diag,
    });

    return {
      ...EMPTY_GRID_BODY,
      body,
      money: {},
      workerBaseRates: {},
      workerSpreadRates: {},
    };
  } catch (e) {
    console.error("[Supabase] buildTimesheetGridFromRemoteRows failed", e);
    return { ...EMPTY_GRID_BODY, body: {} };
  }
}

/**
 * 로컬 레이아웃(업체별 칸수)은 유지하고, 작업자 이름·공수는 Supabase 조회만 반영한다.
 * work_hours > 0 인 행이 없는 작업자는 이름·공수 모두 표시하지 않는다.
 */
export function applyRemoteEffortToLayoutGrid(
  layoutGrid: TimesheetGridPersisted,
  rows: WorkerDayEntryRemoteRow[],
  projectNameTrimmed: string,
  lastDay: number,
  slotCount: number,
  diag?: MergeRemoteWorkerDayEntriesDiag,
  opts?: ApplyRemoteEffortOptions | null
): TimesheetGridPersisted {
  const body: Record<string, string> = {};

  if (diag) {
    diag.rowCountIn = Array.isArray(rows) ? rows.length : 0;
    diag.rowCountProjectMatch = 0;
    diag.aggKeys = 0;
    diag.cellsWritten = 0;
    diag.slotsFilledByEmptyColumn = 0;
  }

  if (!Array.isArray(rows)) {
    preserveLayoutWorkerNamesInBody(body, layoutGrid, slotCount);
    return {
      ...layoutGrid,
      body,
      money: { ...layoutGrid.money },
      workerBaseRates: { ...(layoutGrid.workerBaseRates ?? {}) },
      workerSpreadRates: { ...(layoutGrid.workerSpreadRates ?? {}) },
    };
  }

  const companyCounts = normalizeCompanyWorkerSlotCounts(
    layoutGrid.companyWorkerSlotCounts
  );
  const filled = fillBodyFromRemoteWorkerDayRows({
    rows,
    projectNameTrimmed,
    lastDay,
    slotCount,
    companyCounts,
    workersCompanyByWorkerId: opts?.workersCompanyByWorkerId ?? null,
    diag,
  });
  Object.assign(body, filled);

  preserveLayoutWorkerNamesInBody(body, layoutGrid, slotCount);

  return {
    ...layoutGrid,
    body,
    money: { ...layoutGrid.money },
    workerBaseRates: { ...(layoutGrid.workerBaseRates ?? {}) },
    workerSpreadRates: { ...(layoutGrid.workerSpreadRates ?? {}) },
  };
}

/** localStorage에 남은 작업자 이름 셀 제거(표시는 Supabase 조회 후에만 채움) */
export function stripWorkerNamesFromTimesheetGrid(
  grid: TimesheetGridPersisted,
  slotCount: number = 30
): TimesheetGridPersisted {
  const body = { ...grid.body };
  for (let wi = 0; wi < slotCount; wi++) {
    delete body[timesheetWorkerNameCellKey(wi)];
  }
  return { ...grid, body };
}

export function stripWorkerNamesFromTimesheetGrids(
  grids: Record<string, TimesheetGridPersisted>,
  slotCount: number = 30
): Record<string, TimesheetGridPersisted> {
  const out: Record<string, TimesheetGridPersisted> = {};
  for (const [k, g] of Object.entries(grids)) {
    out[k] = stripWorkerNamesFromTimesheetGrid(g, slotCount);
  }
  return out;
}

/**
 * 원격 행을 기존 그리드 body에 병합한다. 이미 공수 값이 있는 셀은 덮어쓰지 않는다.
 * 성명이 비어 있는 열에는 원격 worker_name을 채운 뒤 공수를 넣을 수 있다.
 * 변경이 없으면 grid는 null. 예외 시 null(화면 유지).
 * @deprecated admin-app은 {@link buildTimesheetGridFromRemoteRows} 사용(조회 전용)
 */
export function mergeRemoteWorkerDayEntriesIntoGrid(
  grid: TimesheetGridPersisted,
  rows: WorkerDayEntryRemoteRow[],
  projectNameTrimmed: string,
  lastDay: number,
  slotCount: number,
  diag?: MergeRemoteWorkerDayEntriesDiag
): TimesheetGridPersisted | null {
  try {
    if (!Array.isArray(rows)) return null;
    const body = { ...grid.body };
    let changed = false;
    const aggregated = new Map<string, number>();
    const projectKey = normalizeProjectKey(projectNameTrimmed);
    if (diag) {
      diag.rowCountIn = rows.length;
      diag.rowCountProjectMatch = 0;
      diag.aggKeys = 0;
      diag.cellsWritten = 0;
      diag.slotsFilledByEmptyColumn = 0;
    }

    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      if (row.deleted_at != null && String(row.deleted_at).trim() !== "") {
        continue;
      }
      const pn = String(row.project_name ?? "").trim();
      if (normalizeProjectKey(pn) !== projectKey) continue;
      if (diag) diag.rowCountProjectMatch += 1;
      const wd =
        typeof row.work_date === "string"
          ? row.work_date
          : row.work_date != null
            ? String(row.work_date)
            : "";
      const day = dayFromWorkDate(wd);
      if (day == null || day < 1 || day > lastDay) continue;
      const wn = String(row.worker_name ?? "").trim();
      if (!wn) continue;
      const hRaw = row.work_hours;
      const h =
        typeof hRaw === "number"
          ? hRaw
          : typeof hRaw === "string"
            ? Number.parseFloat(String(hRaw).trim().replace(/,/g, "."))
            : Number.NaN;
      if (!Number.isFinite(h)) continue;
      const aggKey = `${day}\u001f${wn}`;
      aggregated.set(aggKey, (aggregated.get(aggKey) ?? 0) + h);
    }
    if (diag) diag.aggKeys = aggregated.size;

    for (const [aggKey, sumHours] of aggregated) {
      const sep = aggKey.indexOf("\u001f");
      if (sep < 0) continue;
      const dayStr = aggKey.slice(0, sep);
      const workerName = aggKey.slice(sep + 1);
      const day = Number.parseInt(dayStr, 10);
      if (!Number.isFinite(day)) continue;
      let wi = findWorkerIndexForName(body, workerName, slotCount);
      let filledByEmpty = false;
      if (wi < 0) {
        wi = findFirstEmptySlotForDay(body, day, slotCount);
        if (wi < 0) continue;
        filledByEmpty = true;
        const nk = timesheetWorkerNameCellKey(wi);
        if ((body[nk] ?? "").trim() === "") {
          body[nk] = workerName;
          changed = true;
        }
      }
      const ck = bodyCellKey(day, wi);
      const existing = (body[ck] ?? "").trim();
      if (existing !== "") continue;
      const nextVal = formatWorkHoursForBodyCell(sumHours);
      if (nextVal === "") continue;
      body[ck] = nextVal;
      changed = true;
      if (diag) {
        diag.cellsWritten += 1;
        if (filledByEmpty) diag.slotsFilledByEmptyColumn += 1;
      }
    }

    if (!changed) return null;
    return {
      ...grid,
      body,
      money: { ...grid.money },
      workerBaseRates: { ...(grid.workerBaseRates ?? {}) },
      workerSpreadRates: { ...(grid.workerSpreadRates ?? {}) },
    };
  } catch (e) {
    console.error("[Supabase] mergeRemoteWorkerDayEntriesIntoGrid failed", e);
    return null;
  }
}
