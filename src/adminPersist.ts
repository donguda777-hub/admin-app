export const ADMIN_STORAGE_KEY = "ln-admin-app-state-v1";

export type SheetViewPersist = "project" | "summary";

export type ProjectTabPersist = { id: string; name: string };

/** 공수표 본문: 키 d{일}-w{슬롯} → 입력 문자열 */
export type TimesheetGridPersisted = {
  body: Record<string, string>;
  /** 키: `{라벨}@@w{wi}` 또는 `{라벨}@@total` */
  money: Record<string, number | null>;
  /**
   * 구버전 단가(원). 로드 시 `workerBaseRates`로 병합 후 저장 시 제거.
   * 키: `w0` … `w29`
   */
  workerUnitRates?: Record<string, number | null>;
  /** 작업자 열 기준(원). 키: `w0` … `w29` */
  workerBaseRates: Record<string, number | null>;
  /** 작업자 열 차익(원). 키: `w0` … `w29` */
  workerSpreadRates: Record<string, number | null>;
  /** 업체별 작업자 열 수(프로젝트·연·월별, 합계 30) */
  companyWorkerSlotCounts?: number[];
};

/** 제거된 하단 '항공료' 행이 쓰던 money 키의 행 라벨(구 데이터 정리용) */
const LEGACY_AIRFARE_MONEY_LABEL = "\uD56D\uACF5\uB8CC";

/** 하단 급여·실급여·L&N은 계산 행으로 전환됨: 구 `money` 키 정리용 */
const COMPUTED_MONEY_ROW_LABELS = new Set<string>([
  "\uAE09\uC5EC",
  "\uC2E4\uAE09\uC5EC",
  "L&N",
]);

function moneyKeyRowLabel(key: string): string {
  const i = key.indexOf("@@");
  return i === -1 ? key : key.slice(0, i);
}

function stripLegacyAirfareMoneyKeys(
  money: Record<string, number | null>
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(money)) {
    if (moneyKeyRowLabel(k) === LEGACY_AIRFARE_MONEY_LABEL) continue;
    if (COMPUTED_MONEY_ROW_LABELS.has(moneyKeyRowLabel(k))) continue;
    out[k] = v;
  }
  return out;
}

export function stripLegacyAirfareFromTimesheetGrids(
  grids: Record<string, TimesheetGridPersisted>
): Record<string, TimesheetGridPersisted> {
  const out: Record<string, TimesheetGridPersisted> = {};
  for (const [gk, g] of Object.entries(grids)) {
    out[gk] = {
      body: g.body,
      money: stripLegacyAirfareMoneyKeys(g.money),
      workerBaseRates: { ...(g.workerBaseRates ?? {}) },
      workerSpreadRates: { ...(g.workerSpreadRates ?? {}) },
    };
  }
  return out;
}

export type SummaryTotalsPersist = {
  headcount: number;
  effort: number;
  profitLn: number;
};

/** 인적사항 등급(표시·저장 키 동일) */
export const PERSONNEL_GRADE_LABELS = [
  "\uACC4\uC7A5\uACF5",
  "\uC900\uACC4\uC7A5\uACF5",
  "\uC870\uACF5",
  "\uCD08\uBCF4",
] as const;

export type PersonnelGradeLabel = (typeof PERSONNEL_GRADE_LABELS)[number];

const PERSONNEL_GRADE_LABEL_SET = new Set<string>(PERSONNEL_GRADE_LABELS);

/** 인적사항 표 기본 행 수(좌·우 열 합산, 좌측 먼저 채움) */
export const PERSONNEL_DEFAULT_ROW_COUNT = 80;
/** 좌측 열에 배치되는 행 수(이후 인덱스는 우측 열) */
export const PERSONNEL_LEFT_COLUMN_ROW_COUNT = 40;

export type PersonnelRowPersist = {
  name: string;
  /** 지역 */
  region: string;
  phone: string;
};

/** 등급(한글 키)별 인적사항 행 */
export type PersonnelByGradePersist = Record<string, PersonnelRowPersist[]>;

/** 추가 관리자 권한(마스터 제외) */
export type AdminExtraAccountRole = "AMOUNT_ADMIN" | "BASIC_ADMIN";

/** 추가 관리자 계정(클라이언트 저장) */
export type AdminExtraAccountPersist = {
  id: string;
  password: string;
  user: string;
  /** 없으면 AMOUNT_ADMIN(기존 계정 호환) */
  role?: AdminExtraAccountRole;
};

/** 작업자별 기준·차익 단가 (localStorage, worker_id 또는 이름 키) */
export type WorkerRatePersist = {
  base: number | null;
  spread: number | null;
};

export type AdminPersistV1 = {
  v: 1;
  years: number[];
  timesheetYear: number | null;
  timesheetMonth: number | null;
  openYear: number | null;
  projectsBySheet: Record<string, ProjectTabPersist[]>;
  selectedProjectId: string | null;
  sheetView: SheetViewPersist;
  timesheetGrids: Record<string, TimesheetGridPersisted>;
  summaryTotalsBySheet: Record<string, SummaryTotalsPersist>;
  /** 업체별 작업자 열 수(고정 4개 업체, 합계 30) */
  companyWorkerSlotCounts: number[];
  /** 등급별 인적사항 표 데이터 */
  personnelByGrade: PersonnelByGradePersist;
  /** 마스터 외 추가 로그인 계정(생성 순서 유지) */
  extraAdminAccounts: AdminExtraAccountPersist[];
  /**
   * 작업자별 기준·차익 단가. 키: `id:{worker_id}` 또는 `name:{이름}`.
   * 공수표 슬롯(w0…)과 무관하게 작업자 단위로 저장.
   */
  workerRatesByKey?: Record<string, WorkerRatePersist>;
};

/** 작업자 열 총 개수(고정) */
export const WORKER_COLUMN_COUNT = 30;

export const DEFAULT_COMPANY_WORKER_SLOT_COUNTS: readonly [
  number,
  number,
  number,
  number,
] = [8, 8, 8, 6];

export function defaultTimesheetGridPersisted(): TimesheetGridPersisted {
  return {
    body: {},
    money: {},
    workerBaseRates: {},
    workerSpreadRates: {},
    companyWorkerSlotCounts: [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS],
  };
}

export function normalizeCompanyWorkerSlotCounts(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS];
  }
  const nums: number[] = [];
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS];
    }
    const n = Math.trunc(item);
    if (n < 1) return [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS];
    nums.push(n);
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum !== WORKER_COLUMN_COUNT) {
    return [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS];
  }
  return nums;
}

export const DEFAULT_INITIAL_YEAR = 2026;

export function defaultAdminPersist(): AdminPersistV1 {
  return {
    v: 1,
    years: [DEFAULT_INITIAL_YEAR],
    timesheetYear: null,
    timesheetMonth: null,
    openYear: null,
    projectsBySheet: {},
    selectedProjectId: null,
    sheetView: "project",
    timesheetGrids: {},
    summaryTotalsBySheet: {},
    companyWorkerSlotCounts: [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS],
    personnelByGrade: {},
    extraAdminAccounts: [],
    workerRatesByKey: {},
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** 공수표 레이아웃(업체명·업체별 칸수·작업자 이름) 복사/붙여넣기 임시 저장 */
export const ADMIN_TIMESHEET_LAYOUT_CLIPBOARD_KEY =
  "ln-admin-timesheet-layout-clipboard-v1";

export type TimesheetLayoutClipboardWorkerRate = {
  base: number | null;
  spread: number | null;
};

export type TimesheetLayoutClipboardV1 = {
  v: 1;
  /** 표시용 업체명 4개(L&N 등), 스펙상 복사·검증용 */
  companyNames: string[];
  companyWorkerSlotCounts: number[];
  workerNames: string[];
  /** 슬롯별 기준·차익(w0…). 구 클립보드에는 없을 수 있음) */
  workerRates?: TimesheetLayoutClipboardWorkerRate[];
  /** 붙여넣기 확인 문구용: 복사 당시 `5월 미국` 형태(구 데이터에는 없을 수 있음) */
  sourceDisplayLabel?: string;
};

function parseClipboardRateField(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number" && Number.isFinite(x)) return Math.trunc(x);
  return null;
}

function parseClipboardWorkerRates(
  x: unknown
): TimesheetLayoutClipboardWorkerRate[] | undefined {
  if (!Array.isArray(x) || x.length !== WORKER_COLUMN_COUNT) {
    return undefined;
  }
  const out: TimesheetLayoutClipboardWorkerRate[] = [];
  for (const item of x) {
    if (!isRecord(item)) return undefined;
    out.push({
      base: parseClipboardRateField(item.base),
      spread: parseClipboardRateField(item.spread),
    });
  }
  return out;
}

/** 붙여넣기: 공수·이름·id 셀 정리 후 클립보드 작업자명만 반영(공수는 복사하지 않음) */
export function applyLayoutClipboardToTimesheetGrid(
  grid: TimesheetGridPersisted,
  clip: TimesheetLayoutClipboardV1,
  slotCount: number = WORKER_COLUMN_COUNT
): TimesheetGridPersisted {
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(grid.body)) {
    if (typeof v !== "string") continue;
    if (/^d\d+-w\d+$/.test(k)) continue;
    if (/^name-w\d+$/.test(k)) continue;
    if (/^workerId-w\d+$/.test(k)) continue;
    body[k] = v;
  }
  for (let wi = 0; wi < slotCount; wi++) {
    const name = (clip.workerNames[wi] ?? "").trim();
    if (name !== "") {
      body[timesheetWorkerNameCellKey(wi)] = name;
    }
  }
  return {
    ...grid,
    body,
    companyWorkerSlotCounts: normalizeCompanyWorkerSlotCounts(
      clip.companyWorkerSlotCounts
    ),
  };
}

/** 클립보드 슬롯별 단가 → workerRatesByKey (이름 키) */
export function workerRatesByKeyFromLayoutClipboard(
  clip: TimesheetLayoutClipboardV1,
  slotCount: number = WORKER_COLUMN_COUNT
): Record<string, WorkerRatePersist> {
  const out: Record<string, WorkerRatePersist> = {};
  const rates = clip.workerRates;
  if (rates == null) return out;
  for (let wi = 0; wi < slotCount; wi++) {
    const name = (clip.workerNames[wi] ?? "").trim();
    if (name === "") continue;
    const r = rates[wi];
    if (r == null) continue;
    if (r.base == null && r.spread == null) continue;
    const key = workerRateStorageKey(null, name);
    out[key] = { base: r.base, spread: r.spread };
  }
  return out;
}

export function saveTimesheetLayoutClipboard(
  data: TimesheetLayoutClipboardV1
): boolean {
  try {
    localStorage.setItem(
      ADMIN_TIMESHEET_LAYOUT_CLIPBOARD_KEY,
      JSON.stringify(data)
    );
    return true;
  } catch {
    return false;
  }
}

export function loadTimesheetLayoutClipboard(): TimesheetLayoutClipboardV1 | null {
  try {
    const raw = localStorage.getItem(ADMIN_TIMESHEET_LAYOUT_CLIPBOARD_KEY);
    if (raw == null || raw.trim() === "") return null;
    const x: unknown = JSON.parse(raw);
    if (!isRecord(x) || x.v !== 1) return null;
    const cn = x.companyNames;
    const cc = x.companyWorkerSlotCounts;
    const wn = x.workerNames;
    if (!Array.isArray(cn) || cn.length !== 4) return null;
    for (const s of cn) {
      if (typeof s !== "string") return null;
    }
    if (!Array.isArray(cc) || cc.length !== 4) return null;
    const counts: number[] = [];
    for (const c of cc) {
      if (typeof c !== "number" || !Number.isFinite(c)) return null;
      const n = Math.trunc(c);
      if (n < 1) return null;
      counts.push(n);
    }
    if (counts.reduce((a, b) => a + b, 0) !== WORKER_COLUMN_COUNT) {
      return null;
    }
    if (!Array.isArray(wn) || wn.length !== WORKER_COLUMN_COUNT) return null;
    const workerNames: string[] = [];
    for (const w of wn) {
      if (typeof w !== "string") return null;
      workerNames.push(w);
    }
    const labelRaw = x.sourceDisplayLabel;
    const sourceDisplayLabel =
      typeof labelRaw === "string" && labelRaw.trim() !== ""
        ? labelRaw.trim()
        : undefined;
    const workerRates = parseClipboardWorkerRates(x.workerRates);
    return {
      v: 1,
      companyNames: cn.slice() as string[],
      companyWorkerSlotCounts: counts,
      workerNames,
      ...(workerRates != null ? { workerRates } : {}),
      ...(sourceDisplayLabel != null ? { sourceDisplayLabel } : {}),
    };
  } catch {
    return null;
  }
}

function asStringArray(x: unknown): number[] | null {
  if (!Array.isArray(x)) return null;
  const out: number[] = [];
  for (const item of x) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    out.push(Math.trunc(item));
  }
  return out;
}

function asProjectList(x: unknown): Record<string, ProjectTabPersist[]> | null {
  if (!isRecord(x)) return null;
  const out: Record<string, ProjectTabPersist[]> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!Array.isArray(v)) return null;
    const row: ProjectTabPersist[] = [];
    for (const p of v) {
      if (!isRecord(p)) return null;
      const id = p.id;
      const name = p.name;
      if (typeof id !== "string" || typeof name !== "string") return null;
      row.push({ id, name });
    }
    out[k] = row;
  }
  return out;
}

function parseWorkerSlotRates(x: unknown): Record<string, number | null> {
  if (x == null) return {};
  if (!isRecord(x)) return {};
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(x)) {
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.trunc(v);
    }
  }
  return out;
}

function mergeWorkerBaseRatesFromLegacy(
  parsedBase: Record<string, number | null>,
  legacyUnit: Record<string, number | null>
): Record<string, number | null> {
  return { ...legacyUnit, ...parsedBase };
}

function asTimesheetGrids(
  x: unknown
): Record<string, TimesheetGridPersisted> | null {
  if (!isRecord(x)) return null;
  const out: Record<string, TimesheetGridPersisted> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!isRecord(v)) return null;
    const body = v.body;
    const money = v.money;
    if (!isRecord(body) || !isRecord(money)) return null;
    const bodyOut: Record<string, string> = {};
    for (const [bk, bv] of Object.entries(body)) {
      if (typeof bv !== "string") return null;
      bodyOut[bk] = bv;
    }
    const moneyOut: Record<string, number | null> = {};
    for (const [mk, mv] of Object.entries(money)) {
      if (mv === null) moneyOut[mk] = null;
      else if (typeof mv === "number" && Number.isFinite(mv)) {
        moneyOut[mk] = Math.trunc(mv);
      } else return null;
    }
    const legacyUnit = parseWorkerSlotRates(v.workerUnitRates);
    const parsedBase = parseWorkerSlotRates(v.workerBaseRates);
    const parsedSpread = parseWorkerSlotRates(v.workerSpreadRates);
    const workerBaseRates = mergeWorkerBaseRatesFromLegacy(parsedBase, legacyUnit);
    const slotCounts =
      v.companyWorkerSlotCounts === undefined
        ? undefined
        : normalizeCompanyWorkerSlotCounts(v.companyWorkerSlotCounts);
    out[k] = {
      body: bodyOut,
      money: stripLegacyAirfareMoneyKeys(moneyOut),
      workerBaseRates,
      workerSpreadRates: parsedSpread,
      ...(slotCounts !== undefined
        ? { companyWorkerSlotCounts: slotCounts }
        : {}),
    };
  }
  return out;
}

function normalizePersonnelRow(x: unknown): PersonnelRowPersist | null {
  if (!isRecord(x)) return null;
  const name = x.name;
  const phone = x.phone;
  if (typeof name !== "string" || typeof phone !== "string") return null;
  const regionRaw = x.region;
  if (typeof regionRaw === "string") {
    return { name, region: regionRaw, phone };
  }
  const residentId = x.residentId;
  const accountNo = x.accountNo;
  if (typeof residentId === "string" && typeof accountNo === "string") {
    return { name, region: "", phone };
  }
  return { name, region: "", phone };
}

function asPersonnelByGrade(x: unknown): PersonnelByGradePersist {
  if (!isRecord(x)) return {};
  const out: PersonnelByGradePersist = {};
  for (const [k, v] of Object.entries(x)) {
    if (!PERSONNEL_GRADE_LABEL_SET.has(k)) continue;
    if (!Array.isArray(v)) continue;
    const rows: PersonnelRowPersist[] = [];
    for (const item of v) {
      const row = normalizePersonnelRow(item);
      if (row) rows.push(row);
    }
    while (rows.length < PERSONNEL_DEFAULT_ROW_COUNT) {
      rows.push({ name: "", region: "", phone: "" });
    }
    out[k] = rows;
  }
  return out;
}

function asSummaryTotals(
  x: unknown
): Record<string, SummaryTotalsPersist> | null {
  if (!isRecord(x)) return null;
  const out: Record<string, SummaryTotalsPersist> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!isRecord(v)) return null;
    const h = v.headcount;
    const e = v.effort;
    const ln = v.profitLn;
    if (
      typeof h !== "number" ||
      typeof e !== "number" ||
      typeof ln !== "number" ||
      !Number.isFinite(h) ||
      !Number.isFinite(e) ||
      !Number.isFinite(ln)
    ) {
      return null;
    }
    out[k] = {
      headcount: Math.trunc(h),
      effort: Math.trunc(e),
      profitLn: Math.trunc(ln),
    };
  }
  return out;
}

function parseExtraAdminRole(raw: unknown): AdminExtraAccountRole {
  if (raw === "BASIC_ADMIN") return "BASIC_ADMIN";
  return "AMOUNT_ADMIN";
}

function asExtraAdminAccounts(x: unknown): AdminExtraAccountPersist[] {
  if (!Array.isArray(x)) return [];
  const out: AdminExtraAccountPersist[] = [];
  for (const item of x) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const password = item.password;
    const user = item.user;
    if (
      typeof id !== "string" ||
      typeof password !== "string" ||
      typeof user !== "string"
    ) {
      continue;
    }
    out.push({
      id,
      password,
      user,
      role: parseExtraAdminRole(item.role),
    });
  }
  return out;
}

export function loadAdminPersist(): AdminPersistV1 {
  const base = defaultAdminPersist();
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (raw == null || raw === "") return base;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.v !== 1) return base;

    const years = asStringArray(parsed.years);
    const projectsBySheet = asProjectList(parsed.projectsBySheet);
    const timesheetGrids = asTimesheetGrids(parsed.timesheetGrids);
    const summaryTotalsBySheet = asSummaryTotals(parsed.summaryTotalsBySheet);
    const personnelByGrade = asPersonnelByGrade(parsed.personnelByGrade);
    const extraAdminAccounts = asExtraAdminAccounts(parsed.extraAdminAccounts);
    const workerRatesByKey = parseWorkerRatesByKey(parsed.workerRatesByKey);

    if (
      years == null ||
      projectsBySheet == null ||
      timesheetGrids == null ||
      summaryTotalsBySheet == null
    ) {
      return base;
    }

    const ty = parsed.timesheetYear;
    const tm = parsed.timesheetMonth;
    const oy = parsed.openYear;
    const sp = parsed.selectedProjectId;
    const sv = parsed.sheetView;

    return {
      v: 1,
      years: years.length > 0 ? years : base.years,
      timesheetYear:
        ty === null || typeof ty === "number" ? (ty as number | null) : null,
      timesheetMonth:
        tm === null || typeof tm === "number" ? (tm as number | null) : null,
      openYear:
        oy === null || typeof oy === "number" ? (oy as number | null) : null,
      projectsBySheet,
      selectedProjectId:
        sp === null || typeof sp === "string" ? (sp as string | null) : null,
      sheetView: sv === "summary" || sv === "project" ? sv : "project",
      timesheetGrids,
      summaryTotalsBySheet,
      companyWorkerSlotCounts: normalizeCompanyWorkerSlotCounts(
        parsed.companyWorkerSlotCounts
      ),
      personnelByGrade,
      extraAdminAccounts,
      workerRatesByKey,
    };
  } catch {
    return base;
  }
}

export function createEmptyPersonnelRows(
  count: number = PERSONNEL_DEFAULT_ROW_COUNT
): PersonnelRowPersist[] {
  return Array.from({ length: count }, () => ({
    name: "",
    region: "",
    phone: "",
  }));
}

/** 연·월·프로젝트명으로 공수표 레이아웃 키 생성 */
export function normalizeTimesheetProjectName(projectName: string): string {
  return projectName.trim().replace(/\s+/g, " ");
}

export function timesheetGridStorageKey(
  year: number,
  month: number,
  projectName: string
): string {
  const name = normalizeTimesheetProjectName(projectName);
  return `${year}-${month}-${name || "__unnamed__"}`;
}

export function bodyCellKey(day: number, workerIndex: number): string {
  return `d${day}-w${workerIndex}`;
}

/** 작업자 열 성명(공수표 body). 일별 공수 키와 겹치지 않도록 별도 prefix 사용 */
export function timesheetWorkerNameCellKey(workerIndex: number): string {
  return `name-w${workerIndex}`;
}

/** 작업자 열 Supabase worker_id (조회 시 body에만 보관, 저장 시 이름과 함께 strip 가능) */
export function timesheetWorkerIdCellKey(workerIndex: number): string {
  return `workerId-w${workerIndex}`;
}

export function workerUnitRateKey(workerIndex: number): string {
  return `w${workerIndex}`;
}

/** localStorage 단가 키: worker_id 우선, 없으면 이름 */
export function workerRateStorageKey(
  workerId: string | null | undefined,
  workerName: string
): string {
  const id = (workerId ?? "").trim();
  if (id !== "") return `id:${id}`;
  const name = workerName.trim().replace(/\s+/g, " ");
  return `name:${name}`;
}

function parseWorkerRatesByKey(x: unknown): Record<string, WorkerRatePersist> {
  if (!isRecord(x)) return {};
  const out: Record<string, WorkerRatePersist> = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof k !== "string" || k.trim() === "" || !isRecord(v)) continue;
    const baseRaw = v.base;
    const spreadRaw = v.spread;
    const base =
      baseRaw === null || baseRaw === undefined
        ? null
        : typeof baseRaw === "number" && Number.isFinite(baseRaw)
          ? Math.trunc(baseRaw)
          : null;
    const spread =
      spreadRaw === null || spreadRaw === undefined
        ? null
        : typeof spreadRaw === "number" && Number.isFinite(spreadRaw)
          ? Math.trunc(spreadRaw)
          : null;
    if (base === null && spread === null) continue;
    out[k] = { base, spread };
  }
  return out;
}

/** 슬롯별 단가: workerRatesByKey → 구 그리드 w0 단가 순으로 조회 */
export function resolveWorkerRatesForSlot(
  workerIndex: number,
  body: Record<string, string>,
  workerRatesByKey: Record<string, WorkerRatePersist>,
  legacyGrid?: Pick<TimesheetGridPersisted, "workerBaseRates" | "workerSpreadRates">
): WorkerRatePersist {
  const name = (body[timesheetWorkerNameCellKey(workerIndex)] ?? "").trim();
  const workerId = (body[timesheetWorkerIdCellKey(workerIndex)] ?? "").trim();
  const primary = workerRatesByKey[workerRateStorageKey(workerId || null, name)];
  if (primary != null) return primary;
  if (workerId !== "") {
    const byName = workerRatesByKey[workerRateStorageKey(null, name)];
    if (byName != null) return byName;
  }
  const slot = workerUnitRateKey(workerIndex);
  return {
    base: legacyGrid?.workerBaseRates?.[slot] ?? null,
    spread: legacyGrid?.workerSpreadRates?.[slot] ?? null,
  };
}

export function moneyCellKeyWorker(label: string, workerIndex: number): string {
  return `${label}@@w${workerIndex}`;
}

export function moneyCellKeyTotal(label: string): string {
  return `${label}@@total`;
}
