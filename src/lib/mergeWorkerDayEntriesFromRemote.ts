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

/** 프로젝트·기간 내 작업자명 → 업체 그룹 인덱스(미매칭·빈 값은 null) */
function buildWorkerCompanyGroupIndexByName(
  rows: WorkerDayEntryRemoteRow[],
  projectKey: string,
  lastDay: number
): Map<string, number | null> {
  const out = new Map<string, number | null>();
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
    if (!wn) continue;
    const nk = normalizeNameKey(wn);
    const idx = mapStoredCompanyToTimesheetGroupIndex(row.company_name);
    const existing = out.get(nk);
    if (existing === undefined) {
      out.set(nk, idx);
    } else if (existing === null && idx != null) {
      out.set(nk, idx);
    }
  }
  return out;
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

/**
 * Supabase `worker_day_entries` 조회 결과만으로 공수표 body를 만든다.
 * localStorage·기존 그리드 값은 사용하지 않는다. 조회 행이 없으면 빈 그리드.
 */
export function buildTimesheetGridFromRemoteRows(
  rows: WorkerDayEntryRemoteRow[],
  projectNameTrimmed: string,
  lastDay: number,
  slotCount: number,
  diag?: MergeRemoteWorkerDayEntriesDiag
): TimesheetGridPersisted {
  try {
    const body: Record<string, string> = {};
    const aggregated = new Map<string, number>();
    const projectKey = normalizeProjectKey(projectNameTrimmed);
    const workerSlotByName = new Map<string, number>();
    const usedSlots = new Set<number>();

    if (diag) {
      diag.rowCountIn = Array.isArray(rows) ? rows.length : 0;
      diag.rowCountProjectMatch = 0;
      diag.aggKeys = 0;
      diag.cellsWritten = 0;
      diag.slotsFilledByEmptyColumn = 0;
    }

    if (!Array.isArray(rows)) {
      return { ...EMPTY_GRID_BODY, body };
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
      if (!Number.isFinite(h) || h <= 0) continue;
      const aggKey = `${day}\u001f${wn}`;
      aggregated.set(aggKey, (aggregated.get(aggKey) ?? 0) + h);
    }
    if (diag) diag.aggKeys = aggregated.size;

    const workerIdByName = buildWorkerIdByNameMap(rows, projectKey, lastDay);
    const workerCompanyByName = buildWorkerCompanyGroupIndexByName(
      rows,
      projectKey,
      lastDay
    );
    const companyCounts = normalizeCompanyWorkerSlotCounts([
      ...DEFAULT_COMPANY_WORKER_SLOT_COUNTS,
    ]);
    const ranges = companyWorkerSlotRanges(companyCounts);

    const assignWorkerSlot = (workerName: string): number => {
      const nameKey = normalizeNameKey(workerName);
      const existing = workerSlotByName.get(nameKey);
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
            workerSlotByName.set(nameKey, wi);
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
          workerSlotByName.set(nameKey, wi);
          usedSlots.add(wi);
          if (diag) diag.slotsFilledByEmptyColumn += 1;
          return wi;
        }
        return -1;
      };

      const gIdx = workerCompanyByName.get(nameKey);
      if (
        gIdx !== undefined &&
        gIdx !== null &&
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
          workerSlotByName.set(nameKey, wi);
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
        workerSlotByName.set(nameKey, wi);
        usedSlots.add(wi);
        if (diag) diag.slotsFilledByEmptyColumn += 1;
        return wi;
      }
      return -1;
    };

    const uniqueWorkers: string[] = [];
    const seenNk = new Set<string>();
    for (const k of aggregated.keys()) {
      const sep = k.indexOf("\u001f");
      if (sep < 0) continue;
      const workerName = k.slice(sep + 1);
      const nk = normalizeNameKey(workerName);
      if (!nk || seenNk.has(nk)) continue;
      seenNk.add(nk);
      uniqueWorkers.push(workerName);
    }
    uniqueWorkers.sort((a, b) => {
      const na = normalizeNameKey(a);
      const nb = normalizeNameKey(b);
      const ga = workerCompanyByName.get(na);
      const gb = workerCompanyByName.get(nb);
      const ia = ga == null ? 999 : ga;
      const ib = gb == null ? 999 : gb;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, "ko");
    });
    for (const wn of uniqueWorkers) {
      assignWorkerSlot(wn);
    }

    for (const [aggKey, sumHours] of aggregated) {
      const sep = aggKey.indexOf("\u001f");
      if (sep < 0) continue;
      const dayStr = aggKey.slice(0, sep);
      const workerName = aggKey.slice(sep + 1);
      const day = Number.parseInt(dayStr, 10);
      if (!Number.isFinite(day)) continue;

      const wi = workerSlotByName.get(normalizeNameKey(workerName));
      if (wi === undefined) continue;

      const nextVal = formatWorkHoursForBodyCell(sumHours);
      if (nextVal === "") continue;
      body[bodyCellKey(day, wi)] = nextVal;
      if (diag) diag.cellsWritten += 1;
    }

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
  diag?: MergeRemoteWorkerDayEntriesDiag
): TimesheetGridPersisted {
  const body: Record<string, string> = {};
  const workerSlotByName = new Map<string, number>();
  const usedSlots = new Set<number>();

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

  const aggregated = new Map<string, number>();
  const projectKey = normalizeProjectKey(projectNameTrimmed);

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
    const aggKey = `${day}\u001f${wn}`;
    aggregated.set(aggKey, (aggregated.get(aggKey) ?? 0) + h);
  }
  if (diag) diag.aggKeys = aggregated.size;

  const workerIdByName = buildWorkerIdByNameMap(rows, projectKey, lastDay);
  const workerCompanyByName = buildWorkerCompanyGroupIndexByName(
    rows,
    projectKey,
    lastDay
  );
  const companyCounts = normalizeCompanyWorkerSlotCounts(
    layoutGrid.companyWorkerSlotCounts
  );
  const ranges = companyWorkerSlotRanges(companyCounts);

  const assignWorkerSlot = (workerName: string): number => {
    const nameKey = normalizeNameKey(workerName);
    const existing = workerSlotByName.get(nameKey);
    if (existing !== undefined) {
      setWorkerIdOnSlot(body, existing, workerName, workerIdByName);
      return existing;
    }

    const takeNextInRange = (start: number, endEx: number): number => {
      for (let wi = start; wi < endEx && wi < slotCount; wi++) {
        if (usedSlots.has(wi)) continue;
        body[timesheetWorkerNameCellKey(wi)] = workerName;
        setWorkerIdOnSlot(body, wi, workerName, workerIdByName);
        workerSlotByName.set(nameKey, wi);
        usedSlots.add(wi);
        if (diag) diag.slotsFilledByEmptyColumn += 1;
        return wi;
      }
      return -1;
    };

    const gIdx = workerCompanyByName.get(nameKey);
    if (
      gIdx !== undefined &&
      gIdx !== null &&
      gIdx >= 0 &&
      gIdx < ranges.length
    ) {
      const r = ranges[gIdx]!;
      const wi = takeNextInRange(r.start, r.end);
      if (wi >= 0) return wi;
    }

    for (let wi = 0; wi < slotCount; wi++) {
      if (usedSlots.has(wi)) continue;
      body[timesheetWorkerNameCellKey(wi)] = workerName;
      setWorkerIdOnSlot(body, wi, workerName, workerIdByName);
      workerSlotByName.set(nameKey, wi);
      usedSlots.add(wi);
      if (diag) diag.slotsFilledByEmptyColumn += 1;
      return wi;
    }
    return -1;
  };

  const uniqueWorkers: string[] = [];
  const seenNk = new Set<string>();
  for (const k of aggregated.keys()) {
    const sep = k.indexOf("\u001f");
    if (sep < 0) continue;
    const workerName = k.slice(sep + 1);
    const nk = normalizeNameKey(workerName);
    if (!nk || seenNk.has(nk)) continue;
    seenNk.add(nk);
    uniqueWorkers.push(workerName);
  }
  uniqueWorkers.sort((a, b) => {
    const na = normalizeNameKey(a);
    const nb = normalizeNameKey(b);
    const ga = workerCompanyByName.get(na);
    const gb = workerCompanyByName.get(nb);
    const ia = ga == null ? 999 : ga;
    const ib = gb == null ? 999 : gb;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, "ko");
  });
  for (const wn of uniqueWorkers) {
    assignWorkerSlot(wn);
  }

  for (const [aggKey, sumHours] of aggregated) {
    const sep = aggKey.indexOf("\u001f");
    if (sep < 0) continue;
    const dayStr = aggKey.slice(0, sep);
    const workerName = aggKey.slice(sep + 1);
    const day = Number.parseInt(dayStr, 10);
    if (!Number.isFinite(day) || sumHours <= 0) continue;

    const wi = workerSlotByName.get(normalizeNameKey(workerName));
    if (wi === undefined) continue;

    const nextVal = formatWorkHoursForBodyCell(sumHours);
    if (nextVal === "") continue;
    body[bodyCellKey(day, wi)] = nextVal;
    if (diag) diag.cellsWritten += 1;
  }

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
