import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  ADMIN_STORAGE_KEY,
  DEFAULT_COMPANY_WORKER_SLOT_COUNTS,
  DEFAULT_INITIAL_YEAR,
  PERSONNEL_DEFAULT_ROW_COUNT,
  PERSONNEL_GRADE_LABELS,
  PERSONNEL_LEFT_COLUMN_ROW_COUNT,
  WORKER_COLUMN_COUNT,
  bodyCellKey,
  createEmptyPersonnelRows,
  defaultTimesheetGridPersisted,
  applyLayoutClipboardToTimesheetGrid,
  loadAdminPersist,
  loadTimesheetLayoutClipboard,
  normalizeCompanyWorkerSlotCounts,
  normalizeTimesheetProjectName,
  saveTimesheetLayoutClipboard,
  workerRatesByKeyFromLayoutClipboard,
  stripLegacyAirfareFromTimesheetGrids,
  timesheetGridStorageKey,
  timesheetWorkerIdCellKey,
  timesheetWorkerNameCellKey,
  resolveWorkerRatesForSlot,
  workerRateStorageKey,
  type AdminExtraAccountPersist,
  type AdminExtraAccountRole,
  type AdminPersistV1,
  type PersonnelRowPersist,
  type TimesheetGridPersisted,
  type TimesheetLayoutClipboardV1,
  type WorkerRatePersist,
} from "../adminPersist";
import {
  applyRemoteEffortToLayoutGrid,
  monthDateRangeForRemoteWorkerEntries,
  stripWorkerNamesFromTimesheetGrids,
  type MergeRemoteWorkerDayEntriesDiag,
  type WorkerDayEntryRemoteRow,
} from "../lib/mergeWorkerDayEntriesFromRemote";
import {
  fetchWorkersGroupedByPersonnelGrade,
  mergePersonnelGradeForDisplay,
  type WorkerRemoteRow,
} from "../lib/personnelWorkersFromSupabase";
import {
  fetchActiveProjectsFromSupabase,
  insertProjectToSupabase,
  normalizeProjectName,
  renameProjectNameWithWorkerEntriesInSupabase,
} from "../lib/projectsFromSupabase";
import { getSupabaseBrowserClient } from "../lib/supabaseClient";
import {
  MASTER_ADMIN_ID,
  normalizeAdminAccountId,
} from "../auth/masterCredentials";
import {
  EXTRA_ADMIN_ROLE_LABELS,
  canManageAdminAccounts,
  canUnlockAmountRows,
  canViewAmountRows,
  normalizeExtraAdminRole,
  resolveAdminRole,
  type AdminRole,
} from "../auth/adminRoles";
type AdminMainScreenProps = {
  onLogout: () => void;
  loggedInUserId: string;
};

type ProjectTab = { id: string; name: string };

type SheetView = "project" | "summary";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const FOOTER_LABELS = [
  "\uACF5\uC218",
  "\uAE09\uC5EC",
  "\uC2E4\uAE09\uC5EC",
  "L&N",
] as const;

/** ?ÅÎã® ?ÖÏ≤¥ Í∑∏Î£π(Ï¥?30Ïπ?. ?ÖÏ≤¥Î™?Î∞îÎ°ú ?ÑÎûò ?âÏ? ?ëÏóÖ??Ïπ??¥Î¶Ñ¬∑Í∏∞Ï?¬∑Ï∞®Ïùµ ???ùÏóÖ) */
const COMPANY_GROUP_TONES = {
  ln: {
    header: "bg-[#f3ebe0] text-slate-800",
    worker: "bg-[#f3ebe0]",
  },
  lline: {
    header: "bg-[#e2ebf7] text-slate-800",
    worker: "bg-[#e2ebf7]",
  },
  minyeong: {
    header: "bg-[#dff3e6] text-slate-800",
    worker: "bg-[#dff3e6]",
  },
  individual: {
    header: "bg-[#e6e8ec] text-slate-800",
    worker: "bg-[#e6e8ec]",
  },
} as const;

type CompanyToneKey = keyof typeof COMPANY_GROUP_TONES;

/** ?ÖÏ≤¥Î™Ö¬∑ÏÉâ ??Í≥†Ï†ï, Ïπ∏Ïàò???ÑÎ°ú?ùÌä∏Î≥?Í∑∏Î¶¨??`companyWorkerSlotCounts`Î°?Ï°∞Ï†à */
const COMPANY_ROW_DEFS: ReadonlyArray<{
  name: string;
  tone: CompanyToneKey;
}> = [
  { name: "L&N", tone: "ln" },
  { name: "L-LINE", tone: "lline" },
  { name: "\uBBFC\uC601", tone: "minyeong" },
  { name: "\uAC1C\uC778", tone: "individual" },
];

const WORKER_SLOT_COUNT = WORKER_COLUMN_COUNT;

/** table-layout:fixed + colgroup: ?º¬∑Ïûë?ÖÏûê¬∑?©Í≥Ñ Í∞ÄÎ°?ÎπÑÏú® (?©Í≥ÑÎß?Ï°∞Í∏à ?ìÍ≤å) */
const COL_DAY_PCT = 2.5;
const COL_SUM_PCT = 11;
const COL_WORKER_PCT =
  (100 - COL_DAY_PCT - COL_SUM_PCT) / WORKER_SLOT_COUNT;

/** ?ëÏóÖ?êÎ≥Ñ Í∏àÏï° ?ÅÌïú (1??ÎØ∏Îßå, Ï≤úÎßå ?®ÏúÑÍπåÏ?) */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** ?¥Î???01x?? 10?êÎ¶¨ 3-3-4, 11?êÎ¶¨ 3-4-4; Í∑??∏Îäî ÏµúÎ? 11?êÎ¶¨ÍπåÏ? 3-4-4 ?ïÌÉú */
function formatKoreanPhoneDisplay(digits: string): string {
  const d = digitsOnly(digits).slice(0, 15);
  if (d.length === 0) return "";
  if (/^01[016789]/.test(d)) {
    const m = d.slice(0, 11);
    if (m.length <= 3) return m;
    if (m.length <= 6) return `${m.slice(0, 3)}-${m.slice(3)}`;
    if (m.length < 11) {
      return `${m.slice(0, 3)}-${m.slice(3, 6)}-${m.slice(6)}`;
    }
    return `${m.slice(0, 3)}-${m.slice(3, 7)}-${m.slice(7)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

function formatMoneyAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Math.round(value));
}

/** ?ºÏûê Í≥µÏàò ?Ä Î¨∏Ïûê?????´Ïûê (ÎπàÏπ∏¬∑Î∂àÍ? ??0) */
function parseEffortCellValue(raw: string): number {
  const t = raw.trim().replace(/,/g, ".").replace(/\s+/g, "");
  if (t === "") return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** ?òÎã® Í≥µÏàò ???úÏãú: 0?¥Î©¥ Îπ?Î¨∏Ïûê?? ?ÑÎãàÎ©?ÏµúÎ? ?åÏàò 4?êÎ¶¨ÍπåÏ? ÍπîÎÅî??*/
function formatEffortFooterTotal(total: number): string {
  if (!Number.isFinite(total) || Math.abs(total) < 1e-12) return "";
  const r = Math.round(total * 10000) / 10000;
  if (Math.abs(r) < 1e-12) return "";
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(4).replace(/\.?0+$/, "");
}

/** ?òÎã® Í≥µÏàò ???ºÎ≤® (FOOTER_LABELS Ï≤???™©) */
const FOOTER_EFFORT_LABEL = FOOTER_LABELS[0];
/** ?òÎã® Í∏âÏó¨ ???ºÎ≤® (Í≥ÑÏÇ∞ ?ÑÏö©, FOOTER_LABELS ?òÏß∏) */
const FOOTER_SALARY_LABEL = FOOTER_LABELS[1];
/** ?òÎã® ?§Í∏â?????ºÎ≤® (Í≥ÑÏÇ∞ ?ÑÏö©) */
const FOOTER_NET_PAY_LABEL = FOOTER_LABELS[2];
/** ?òÎã® L&N ???ºÎ≤® (Í≥ÑÏÇ∞ ?ÑÏö©, Î¨∏Ïûê??L&N) */
const FOOTER_LN_ROW_LABEL = FOOTER_LABELS[3];

const PERSONNEL_TABLE_FIELDS: ReadonlyArray<{
  field: keyof PersonnelRowPersist;
  inputType: "text" | "tel";
  mono: boolean;
  colAria: string;
  formatPhone: boolean;
}> = [
  { field: "name", inputType: "text", mono: false, colAria: "\uC774\uB984", formatPhone: false },
  {
    field: "region",
    inputType: "text",
    mono: false,
    colAria: "\uC9C0\uC5ED",
    formatPhone: false,
  },
  {
    field: "phone",
    inputType: "text",
    mono: true,
    colAria: "\uC804\uD654\uBC88\uD638",
    formatPhone: true,
  },
];

const MONEY_FOOTER_MASK = "*******";

/** Í≥ÑÏÇ∞ Í∏àÏï° ?Ä: Í∞??ÜÏùå ??`-`, ?àÏúºÎ©?Ï≤??®ÏúÑ ?ºÌëú */
function formatFooterComputedMoney(value: number | null): string {
  if (value == null) return "-";
  return formatMoneyAmount(value);
}

function formatFooterComputedMoneyDisplay(
  value: number | null,
  masked: boolean
): string {
  if (masked && value != null && Number.isFinite(value)) {
    return MONEY_FOOTER_MASK;
  }
  return formatFooterComputedMoney(value);
}

function sumFiniteNumbers(values: readonly number[]): number {
  let s = 0;
  for (const v of values) {
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

function formatRateInputValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return String(Math.trunc(v));
}

/** Í∏∞Ï?¬∑Ï∞®Ïùµ ?ÖÎ†•: ?´ÏûêÎß??àÏö©, ÎπàÍ∞í?Ä null */
function parseRateInputValue(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function sanitizeRateInputRaw(raw: string): string {
  return raw.replace(/\D/g, "");
}

function computeWorkerEffortTotalsForSummary(
  body: Record<string, string>,
  dayList: readonly { day: number }[],
  slotCount: number
): number[] {
  const totals = new Array<number>(slotCount).fill(0);
  for (let wi = 0; wi < slotCount; wi++) {
    let sum = 0;
    for (const { day } of dayList) {
      sum += parseEffortCellValue(body[bodyCellKey(day, wi)] ?? "");
    }
    totals[wi] = sum;
  }
  return totals;
}

function computeWorkerLnTotalsForSummary(
  spreadPerSlot: readonly (number | null)[],
  workerEffortTotals: number[],
  slotCount: number
): (number | null)[] {
  const out: (number | null)[] = new Array(slotCount).fill(null);
  for (let wi = 0; wi < slotCount; wi++) {
    const spread = spreadPerSlot[wi] ?? null;
    const effort = workerEffortTotals[wi] ?? 0;
    if (spread == null || !Number.isFinite(spread)) {
      out[wi] = null;
      continue;
    }
    out[wi] = Math.round(spread * effort);
  }
  return out;
}

function countNamedWorkerSlots(
  body: Record<string, string>,
  slotCount: number
): number {
  let n = 0;
  for (let wi = 0; wi < slotCount; wi++) {
    if ((body[timesheetWorkerNameCellKey(wi)] ?? "").trim() !== "") n++;
  }
  return n;
}

function computeProjectTimesheetSummary(
  grid: TimesheetGridPersisted,
  dayList: readonly { day: number }[],
  slotCount: number,
  workerRatesByKey: Record<string, WorkerRatePersist>
): { headcount: number; effort: number; profitLn: number | null } {
  const body = grid.body;
  const headcount = countNamedWorkerSlots(body, slotCount);
  const effortArr = computeWorkerEffortTotalsForSummary(
    body,
    dayList,
    slotCount
  );
  const effort = effortArr.reduce((a, v) => a + v, 0);
  const spreadPerSlot = Array.from({ length: slotCount }, (_, wi) =>
    resolveWorkerRatesForSlot(wi, body, workerRatesByKey, grid).spread
  );
  const lnArr = computeWorkerLnTotalsForSummary(
    spreadPerSlot,
    effortArr,
    slotCount
  );
  const parts = lnArr.filter(
    (v): v is number => v != null && Number.isFinite(v)
  );
  const profitLn = parts.length === 0 ? null : sumFiniteNumbers(parts);
  return { headcount, effort, profitLn };
}

/** ???ÑÏ≤¥ ?îÏïΩ??Í≥µÏàò ?Ä: 0???´ÏûêÎ°??úÏãú */
function formatSummaryEffortCell(total: number): string {
  if (!Number.isFinite(total) || Math.abs(total) < 1e-12) return "0";
  const t = formatEffortFooterTotal(total);
  return t === "" ? "0" : t;
}

function ComputedMoneyFooterRow({
  label,
  workerValues,
  grandTotal,
  masked = false,
  labelButton,
}: {
  label: string;
  workerValues: readonly (number | null)[];
  grandTotal: number | null;
  masked?: boolean;
  /** L&N ?? ?ºÎ≤®???†Í? Î≤ÑÌäº?ºÎ°ú ?úÏãú(ÎßàÏä§???¥Ï†ú/Î≥µÍ?) */
  labelButton?: { text: string; onClick: () => void; ariaLabel?: string };
}) {
  return (
    <tr className="bg-amber-50/70">
      <td className="border border-slate-400 bg-amber-100/90 px-0.5 py-0.5 text-center font-bold text-slate-900">
        {labelButton != null ? (
          <button
            type="button"
            onClick={labelButton.onClick}
            className="w-full rounded px-1 py-0.5 text-[inherit] font-bold text-slate-900 underline decoration-slate-500 decoration-dotted underline-offset-2 hover:bg-amber-200/80"
            aria-label={labelButton.ariaLabel ?? labelButton.text}
          >
            {labelButton.text}
          </button>
        ) : (
          label
        )}
      </td>
      {workerValues.map((v, wi) => (
        <td
          key={`${label}-w-${wi}`}
          className="h-7 min-w-0 border border-slate-400 bg-amber-50/80 px-0.5 py-0.5 text-right tabular-nums text-slate-800 md:h-7"
        >
          {formatFooterComputedMoneyDisplay(v, masked)}
        </td>
      ))}
      <td className="h-7 min-w-0 border border-slate-400 bg-amber-100/90 px-0.5 py-0.5 text-right align-middle font-semibold tabular-nums text-slate-900 md:h-7">
        {formatFooterComputedMoneyDisplay(grandTotal, masked)}
      </td>
    </tr>
  );
}

const EMPTY_TIMESHEET_GRID: TimesheetGridPersisted =
  defaultTimesheetGridPersisted();

function slotCountsForGrid(grid: TimesheetGridPersisted | undefined): number[] {
  return normalizeCompanyWorkerSlotCounts(grid?.companyWorkerSlotCounts);
}

function ensureTimesheetGridEntry(
  prev: Record<string, TimesheetGridPersisted>,
  gridKey: string
): TimesheetGridPersisted {
  return prev[gridKey] ?? defaultTimesheetGridPersisted();
}

function sheetKey(year: number, month: number): string {
  return `${year}-${month}`;
}

const PROJECT_CONTEXT_MENU_W = 140;
const PROJECT_CONTEXT_MENU_H = 44;

function clampProjectContextMenuPosition(
  clientX: number,
  clientY: number
): { left: number; top: number } {
  const margin = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = clientX;
  let top = clientY;
  if (left + PROJECT_CONTEXT_MENU_W > vw - margin) {
    left = vw - PROJECT_CONTEXT_MENU_W - margin;
  }
  if (top + PROJECT_CONTEXT_MENU_H > vh - margin) {
    top = vh - PROJECT_CONTEXT_MENU_H - margin;
  }
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  return { left, top };
}

function ExtraAdminRoleFieldset({
  name,
  value,
  onChange,
}: {
  name: string;
  value: AdminExtraAccountRole;
  onChange: (role: AdminExtraAccountRole) => void;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">{"\uAD8C\uD55C"}</legend>
      <div className="flex flex-col gap-1.5">
        {(["AMOUNT_ADMIN", "BASIC_ADMIN"] as const).map((role) => (
          <label
            key={role}
            className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-800 md:text-xs"
          >
            <input
              type="radio"
              name={name}
              checked={value === role}
              onChange={() => onChange(role)}
              className="shrink-0"
            />
            <span className="leading-tight">{EXTRA_ADMIN_ROLE_LABELS[role]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function AdminMainScreen({
  onLogout,
  loggedInUserId,
}: AdminMainScreenProps) {
  const persistInitRef = useRef<AdminPersistV1 | null>(null);
  /** Supabase worker_day_entries ÎπÑÎèôÍ∏?Î≥ëÌï© ?∏Î?(?∏Îßà?¥Ìä∏¬∑?òÏ°¥ Î≥ÄÍ≤???stale ?ëÎãµ Î¨¥Ïãú) */
  const workerDayRemoteSyncGenRef = useRef(0);
  const readPersist = (): AdminPersistV1 => {
    if (persistInitRef.current === null) {
      persistInitRef.current = loadAdminPersist();
    }
    return persistInitRef.current;
  };

  const [years, setYears] = useState(() => readPersist().years);
  /** Í≥µÏàò?úÏóê Î∞òÏòÅ???∞¬∑Ïõî. ??ÎØ∏ÏÑ†?ùÏù¥Î©?null */
  const [timesheetYear, setTimesheetYear] = useState(
    () => readPersist().timesheetYear
  );
  const [timesheetMonth, setTimesheetMonth] = useState(
    () => readPersist().timesheetMonth
  );
  /** ?ºÏπú ?∞ÎèÑ???îÎßå ?úÏãú. null?¥Î©¥ ???®Í? */
  const [openYear, setOpenYear] = useState(() => readPersist().openYear);

  /** Supabase `projects` ?úÏÑ± Î™©Î°ù (?∞¬∑Ïõî Í≥µÌÜµ) */
  const [serverProjects, setServerProjects] = useState<ProjectTab[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => readPersist().selectedProjectId
  );
  /** project: Í∞úÎ≥Ñ Í≥µÏàò??/ summary: ?¥Îãπ ???ÑÏ≤¥ ?îÏïΩ */
  const [sheetView, setSheetView] = useState<SheetView>(
    () => readPersist().sheetView
  );

  /** ?∞¬∑Ïõî¬∑?ÑÎ°ú?ùÌä∏Î™ÖÎ≥Ñ Í≥µÏàò???àÏù¥?ÑÏõÉ(Ïπ∏Ïàò¬∑?ëÏóÖ?êÎ™Ö) + Ï°∞Ìöå Í≥µÏàò ?úÏãú */
  const [timesheetGrids, setTimesheetGrids] = useState<
    Record<string, TimesheetGridPersisted>
  >(() => {
    const loaded = stripWorkerNamesFromTimesheetGrids(
      stripLegacyAirfareFromTimesheetGrids(readPersist().timesheetGrids),
      WORKER_SLOT_COUNT
    );
    const legacyGlobal = normalizeCompanyWorkerSlotCounts(
      readPersist().companyWorkerSlotCounts
    );
    const out: Record<string, TimesheetGridPersisted> = {};
    for (const [k, g] of Object.entries(loaded)) {
      out[k] = {
        ...g,
        companyWorkerSlotCounts: normalizeCompanyWorkerSlotCounts(
          g.companyWorkerSlotCounts ?? legacyGlobal
        ),
      };
    }
    return out;
  });

  const [projectContextMenu, setProjectContextMenu] = useState<{
    projectId: string;
    left: number;
    top: number;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    projectId: string;
    name: string;
  } | null>(null);
  const [workerRatesByKey, setWorkerRatesByKey] = useState<
    Record<string, WorkerRatePersist>
  >(() => readPersist().workerRatesByKey ?? {});
  /** ?®Í? ?ùÏóÖ ?Ä???¥Í∏∞¬∑?Ä?????ùÎ≥Ñ). ?ÖÎ†•Í∞íÏ? workerRateDraft?êÎßå ?îÎã§. */
  const [workerRateDialogTarget, setWorkerRateDialogTarget] = useState<{
    workerIndex: number;
    workerName: string;
    workerId: string;
  } | null>(null);
  const [workerRateDraft, setWorkerRateDraft] = useState({
    baseInput: "",
    spreadInput: "",
  });
  /** Í∏âÏó¨¬∑?§Í∏â??∑L&N ?òÎã® ??ÎßàÏä§???∏ÏÖòÎß? localStorage ?ÜÏùå) */
  const [moneyFooterUnmasked, setMoneyFooterUnmasked] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const workerRateBaseInputRef = useRef<HTMLInputElement>(null);
  const personnelEditInputRef = useRef<HTMLInputElement>(null);
  const personnelEditDraftRef = useRef("");

  const layoutCopyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [layoutCopyToast, setLayoutCopyToast] = useState<string | null>(null);
  const [layoutCopyOkFlash, setLayoutCopyOkFlash] = useState(false);
  const [layoutClipboardReady, setLayoutClipboardReady] = useState(
    () => loadTimesheetLayoutClipboard() != null
  );
  const [layoutPasteConfirmOpen, setLayoutPasteConfirmOpen] = useState(false);
  const [layoutPasteConfirmClip, setLayoutPasteConfirmClip] =
    useState<TimesheetLayoutClipboardV1 | null>(null);

  const [mainView, setMainView] = useState<
    "timesheet" | "personnel" | "accountList"
  >("timesheet");
  const [selectedPersonnelGrade, setSelectedPersonnelGrade] = useState<
    string | null
  >(null);
  const [personnelMenuOpen, setPersonnelMenuOpen] = useState(false);
  const [personnelByGrade, setPersonnelByGrade] = useState<
    Record<string, PersonnelRowPersist[]>
  >(() => readPersist().personnelByGrade ?? {});

  const [extraAdminAccounts, setExtraAdminAccounts] = useState<
    AdminExtraAccountPersist[]
  >(() => readPersist().extraAdminAccounts ?? []);

  const adminRole: AdminRole = useMemo(
    () => resolveAdminRole(loggedInUserId, extraAdminAccounts),
    [loggedInUserId, extraAdminAccounts]
  );

  const canManageAccounts = canManageAdminAccounts(adminRole);
  const showAmountRows = canViewAmountRows(adminRole);
  const showAmountUnlock = canUnlockAmountRows(adminRole);

  const visibleFooterLabels = useMemo((): readonly string[] => {
    if (showAmountRows) return FOOTER_LABELS;
    return FOOTER_LABELS.filter((l) => l === FOOTER_EFFORT_LABEL);
  }, [showAmountRows]);

  const [idHeaderMenuOpen, setIdHeaderMenuOpen] = useState(false);
  const [createAccountModalOpen, setCreateAccountModalOpen] = useState(false);
  const [createDraftId, setCreateDraftId] = useState("");
  const [createDraftPassword, setCreateDraftPassword] = useState("");
  const [createDraftUser, setCreateDraftUser] = useState("");
  const [createDraftRole, setCreateDraftRole] =
    useState<AdminExtraAccountRole>("AMOUNT_ADMIN");

  const [accountListRowMenu, setAccountListRowMenu] = useState<{
    index: number;
    left: number;
    top: number;
  } | null>(null);
  const [editingExtraAccountIndex, setEditingExtraAccountIndex] = useState<
    number | null
  >(null);
  const [editExtraDraft, setEditExtraDraft] = useState<{
    id: string;
    password: string;
    user: string;
    role: AdminExtraAccountRole;
  }>({
    id: "",
    password: "",
    user: "",
    role: "AMOUNT_ADMIN",
  });
  const [deleteExtraConfirmIndex, setDeleteExtraConfirmIndex] = useState<
    number | null
  >(null);

  const [personnelCellMenu, setPersonnelCellMenu] = useState<{
    grade: string;
    rowIndex: number;
    field: keyof PersonnelRowPersist;
    left: number;
    top: number;
  } | null>(null);
  const [personnelEditing, setPersonnelEditing] = useState<{
    grade: string;
    rowIndex: number;
    field: keyof PersonnelRowPersist;
  } | null>(null);
  const [personnelEditDraft, setPersonnelEditDraft] = useState("");
  const [personnelDeleteConfirm, setPersonnelDeleteConfirm] = useState<{
    grade: string;
    rowIndex: number;
  } | null>(null);
  /** Supabase workers ???∏Ï†Å?¨Ìï≠ ?±Í∏âÎ≥?Ï°∞Ìöå ?úÏÑú ?†Ï?) */
  const [workersByGradeFromSupabase, setWorkersByGradeFromSupabase] =
    useState<Record<string, WorkerRemoteRow[]> | null>(null);
  const workersPersonnelFetchGenRef = useRef(0);

  const activeSheetKey =
    timesheetYear != null && timesheetMonth != null
      ? sheetKey(timesheetYear, timesheetMonth)
      : null;

  const visibleExtraAdminRows = useMemo(
    () =>
      extraAdminAccounts
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) =>
            normalizeAdminAccountId(row.id) !==
            normalizeAdminAccountId(MASTER_ADMIN_ID)
        ),
    [extraAdminAccounts]
  );

  const projects = useMemo(
    () => (activeSheetKey != null ? serverProjects : []),
    [activeSheetKey, serverProjects]
  );

  const reloadServerProjects = useCallback(async () => {
    const rows = await fetchActiveProjectsFromSupabase();
    setServerProjects(
      rows.map((r) => ({ id: r.id, name: r.project_name }))
    );
  }, []);

  useEffect(() => {
    if (mainView !== "timesheet") return;
    void reloadServerProjects();
  }, [mainView, reloadServerProjects]);

  useEffect(() => {
    if (selectedProjectId == null) return;
    if (!serverProjects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [serverProjects, selectedProjectId]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const activeTimesheetGridKey = useMemo(() => {
    if (
      timesheetYear == null ||
      timesheetMonth == null ||
      activeProject == null
    ) {
      return null;
    }
    const name = normalizeTimesheetProjectName(activeProject.name);
    if (name === "") return null;
    return timesheetGridStorageKey(timesheetYear, timesheetMonth, name);
  }, [timesheetYear, timesheetMonth, activeProject]);

  const activeTimesheetGrid = useMemo((): TimesheetGridPersisted => {
    if (activeTimesheetGridKey == null) {
      return { ...EMPTY_TIMESHEET_GRID };
    }
    return ensureTimesheetGridEntry(timesheetGrids, activeTimesheetGridKey);
  }, [activeTimesheetGridKey, timesheetGrids]);

  const activeCompanyWorkerSlotCounts = useMemo(
    () => slotCountsForGrid(activeTimesheetGrid),
    [activeTimesheetGrid]
  );

  const companyHeaderGroups = useMemo(
    () =>
      COMPANY_ROW_DEFS.map((d, i) => ({
        name: d.name,
        tone: d.tone,
        slots: activeCompanyWorkerSlotCounts[i] ?? 1,
      })),
    [activeCompanyWorkerSlotCounts]
  );

  const workerSlotMeta = useMemo(
    () =>
      companyHeaderGroups.flatMap((g) =>
        Array.from({ length: g.slots }, (_, i) => ({
          groupName: g.name,
          tone: g.tone,
          isFirstInGroup: i === 0,
          isLastInGroup: i === g.slots - 1,
        }))
      ),
    [companyHeaderGroups]
  );

  const tableTitle = useMemo(() => {
    if (timesheetMonth == null) return "\uACF5\uC218\uD45C";
    const monthLabel = `${timesheetMonth}\uC6D4`;
    if (timesheetYear != null && sheetView === "summary") {
      return `${timesheetYear}\uB144 ${monthLabel} \uC804\uCCB4`;
    }
    if (selectedProjectId == null) return monthLabel;
    const p = projects.find((x) => x.id === selectedProjectId);
    return p ? `${monthLabel} ${p.name}` : monthLabel;
  }, [timesheetMonth, timesheetYear, sheetView, selectedProjectId, projects]);

  const canShowProjectTimesheet =
    sheetView === "project" &&
    timesheetYear != null &&
    timesheetMonth != null &&
    selectedProjectId != null &&
    projects.some((p) => p.id === selectedProjectId);

  const canShowMonthSummary =
    sheetView === "summary" &&
    timesheetYear != null &&
    timesheetMonth != null;

  const pullWorkerDayEntriesRemote = useCallback(
    async (source: "deps" | "interval") => {
      if (
        !canShowProjectTimesheet ||
        activeTimesheetGridKey == null ||
        timesheetYear == null ||
        timesheetMonth == null ||
        selectedProjectId == null
      ) {
        return;
      }
      const project = projects.find((p) => p.id === selectedProjectId);
      if (!project) return;
      const supabase = getSupabaseBrowserClient();
      if (supabase == null) {
        if (source === "deps") {
          console.log(
            "[Supabase] worker_day_entries skip fetch: client not configured (check .env.local)"
          );
        }
        return;
      }
      const genAtStart = workerDayRemoteSyncGenRef.current;
      const gridKey = activeTimesheetGridKey;
      const { start, end, lastDay } = monthDateRangeForRemoteWorkerEntries(
        timesheetYear,
        timesheetMonth
      );
      const projectNameTrimmed = project.name.trim();
      if (!projectNameTrimmed) return;

      try {
        if (source === "deps") {
          console.log("[Supabase] worker_day_entries fetch start", {
            gridKey,
            projectId: selectedProjectId,
            projectName: projectNameTrimmed,
            year: timesheetYear,
            month: timesheetMonth,
            range: { start, end, lastDay },
            supabaseConfigured: true,
          });
        }
        const { data, error } = await supabase
          .from("worker_day_entries")
          .select(
            "id, worker_id, worker_name, company_name, project_id, project_name, work_date, work_hours, memo, deleted_at"
          )
          .gte("work_date", start)
          .lte("work_date", end)
          .is("deleted_at", null);
        if (error) throw error;
        if (workerDayRemoteSyncGenRef.current !== genAtStart) return;
        const rows = (Array.isArray(data) ? data : []) as WorkerDayEntryRemoteRow[];
        if (source === "deps") {
          console.log("[Supabase] worker_day_entries fetch result", {
            rowCount: rows.length,
            sample: rows.slice(0, 5),
            distinctProjectNames: [
              ...new Set(
                rows
                  .map((r) => String(r.project_name ?? "").trim())
                  .filter(Boolean)
              ),
            ],
          });
        }
        setTimesheetGrids((prev) => {
          if (workerDayRemoteSyncGenRef.current !== genAtStart) return prev;
          try {
            const diag: MergeRemoteWorkerDayEntriesDiag = {
              rowCountIn: 0,
              rowCountProjectMatch: 0,
              aggKeys: 0,
              cellsWritten: 0,
              slotsFilledByEmptyColumn: 0,
            };
            const layout = ensureTimesheetGridEntry(prev, gridKey);
            const built = applyRemoteEffortToLayoutGrid(
              layout,
              rows,
              projectNameTrimmed,
              lastDay,
              WORKER_SLOT_COUNT,
              diag
            );
            if (source === "deps") {
              console.log(
                "[Supabase] worker_day_entries select display build",
                diag
              );
            }
            return { ...prev, [gridKey]: built };
          } catch (mergeErr) {
            console.error(
              "[Supabase] worker_day_entries select display build failed",
              mergeErr
            );
            const layout = ensureTimesheetGridEntry(prev, gridKey);
            return {
              ...prev,
              [gridKey]: applyRemoteEffortToLayoutGrid(
                layout,
                [],
                projectNameTrimmed,
                lastDay,
                WORKER_SLOT_COUNT
              ),
            };
          }
        });
        if (workerDayRemoteSyncGenRef.current === genAtStart && source === "deps") {
          console.log("[Supabase] worker_day_entries select ok", {
            at: new Date().toISOString(),
            source,
          });
        }
      } catch (e) {
        if (workerDayRemoteSyncGenRef.current === genAtStart) {
          console.error("[Supabase] worker_day_entries select failed", e);
        }
      }
    },
    [
      canShowProjectTimesheet,
      activeTimesheetGridKey,
      timesheetYear,
      timesheetMonth,
      selectedProjectId,
      projects,
    ]
  );

  useEffect(() => {
    if (
      !canShowProjectTimesheet ||
      activeTimesheetGridKey == null ||
      timesheetYear == null ||
      timesheetMonth == null ||
      selectedProjectId == null
    ) {
      return;
    }
    void pullWorkerDayEntriesRemote("deps");
    const intervalMs = 15_000;
    const id = window.setInterval(() => {
      void pullWorkerDayEntriesRemote("interval");
    }, intervalMs);
    return () => {
      workerDayRemoteSyncGenRef.current += 1;
      window.clearInterval(id);
    };
  }, [pullWorkerDayEntriesRemote]);

  const days = useMemo(() => {
    if (timesheetYear == null || timesheetMonth == null) {
      return [] as { day: number; isSunday: boolean }[];
    }
    const y = timesheetYear;
    const m0 = timesheetMonth - 1;
    const last = new Date(y, m0 + 1, 0).getDate();
    return Array.from({ length: last }, (_, i) => {
      const day = i + 1;
      const isSunday = new Date(y, m0, day).getDay() === 0;
      return { day, isSunday };
    });
  }, [timesheetYear, timesheetMonth]);

  /** ?†ÌÉù ?∞¬∑Ïõî???ÑÎ°ú?ùÌä∏Î≥?Í≥µÏàò?úÏóê??Í≥ÑÏÇ∞(?ÑÏ≤¥ ?îÏïΩ?ú¬∑Ìï©Í≥???. Í∑∏Î¶¨?ú¬∑Ïù¥Î¶Ñ¬∑Í≥µ?ò¬∑L&N Î∞òÏòÅ */
  const projectMonthSummaryRows = useMemo(() => {
    if (
      timesheetYear == null ||
      timesheetMonth == null ||
      activeSheetKey == null
    ) {
      return [] as Array<{
        projectId: string;
        name: string;
        headcount: number;
        effort: number;
        profitLn: number | null;
      }>;
    }
    return projects.map((p) => {
      const gridKey = timesheetGridStorageKey(
        timesheetYear,
        timesheetMonth,
        p.name
      );
      const grid = timesheetGrids[gridKey] ?? { ...EMPTY_TIMESHEET_GRID };
      const s = computeProjectTimesheetSummary(
        grid,
        days,
        WORKER_SLOT_COUNT,
        workerRatesByKey
      );
      return { projectId: p.id, name: p.name, ...s };
    });
  }, [
    timesheetYear,
    timesheetMonth,
    activeSheetKey,
    projects,
    timesheetGrids,
    days,
    workerRatesByKey,
  ]);

  const monthSummaryGrandTotals = useMemo(() => {
    let headcount = 0;
    let effort = 0;
    let profitLn = 0;
    for (const r of projectMonthSummaryRows) {
      headcount += r.headcount;
      effort += r.effort;
      if (r.profitLn != null && Number.isFinite(r.profitLn)) {
        profitLn += r.profitLn;
      }
    }
    return { headcount, effort, profitLn };
  }, [projectMonthSummaryRows]);

  const workerEffortTotals = useMemo(() => {
    const body = activeTimesheetGrid.body;
    const totals = new Array<number>(WORKER_SLOT_COUNT).fill(0);
    for (let wi = 0; wi < WORKER_SLOT_COUNT; wi++) {
      let sum = 0;
      for (const { day } of days) {
        sum += parseEffortCellValue(body[bodyCellKey(day, wi)] ?? "");
      }
      totals[wi] = sum;
    }
    return totals;
  }, [activeTimesheetGrid.body, days]);

  const effortFooterGrandTotal = useMemo(
    () => workerEffortTotals.reduce((acc, v) => acc + v, 0),
    [workerEffortTotals]
  );

  const workerSalaryTotals = useMemo((): (number | null)[] => {
    const body = activeTimesheetGrid.body;
    const out: (number | null)[] = new Array(WORKER_SLOT_COUNT).fill(null);
    for (let wi = 0; wi < WORKER_SLOT_COUNT; wi++) {
      const { base } = resolveWorkerRatesForSlot(
        wi,
        body,
        workerRatesByKey,
        activeTimesheetGrid
      );
      const effort = workerEffortTotals[wi] ?? 0;
      if (base == null || !Number.isFinite(base)) {
        out[wi] = null;
        continue;
      }
      out[wi] = Math.round(base * effort);
    }
    return out;
  }, [activeTimesheetGrid, workerEffortTotals, workerRatesByKey]);

  const workerNetPayTotals = useMemo((): (number | null)[] => {
    const body = activeTimesheetGrid.body;
    const out: (number | null)[] = new Array(WORKER_SLOT_COUNT).fill(null);
    for (let wi = 0; wi < WORKER_SLOT_COUNT; wi++) {
      const { base, spread } = resolveWorkerRatesForSlot(
        wi,
        body,
        workerRatesByKey,
        activeTimesheetGrid
      );
      const effort = workerEffortTotals[wi] ?? 0;
      if (
        base == null ||
        spread == null ||
        !Number.isFinite(base) ||
        !Number.isFinite(spread)
      ) {
        out[wi] = null;
        continue;
      }
      out[wi] = Math.round((base - spread) * effort);
    }
    return out;
  }, [activeTimesheetGrid, workerEffortTotals, workerRatesByKey]);

  const workerLnTotals = useMemo((): (number | null)[] => {
    const body = activeTimesheetGrid.body;
    const out: (number | null)[] = new Array(WORKER_SLOT_COUNT).fill(null);
    for (let wi = 0; wi < WORKER_SLOT_COUNT; wi++) {
      const { spread } = resolveWorkerRatesForSlot(
        wi,
        body,
        workerRatesByKey,
        activeTimesheetGrid
      );
      const effort = workerEffortTotals[wi] ?? 0;
      if (spread == null || !Number.isFinite(spread)) {
        out[wi] = null;
        continue;
      }
      out[wi] = Math.round(spread * effort);
    }
    return out;
  }, [activeTimesheetGrid, workerEffortTotals, workerRatesByKey]);

  const salaryFooterGrandTotal = useMemo((): number | null => {
    const parts = workerSalaryTotals.filter(
      (v): v is number => v != null && Number.isFinite(v)
    );
    if (parts.length === 0) return null;
    return sumFiniteNumbers(parts);
  }, [workerSalaryTotals]);

  const netPayFooterGrandTotal = useMemo((): number | null => {
    const parts = workerNetPayTotals.filter(
      (v): v is number => v != null && Number.isFinite(v)
    );
    if (parts.length === 0) return null;
    return sumFiniteNumbers(parts);
  }, [workerNetPayTotals]);

  const lnFooterGrandTotal = useMemo((): number | null => {
    const parts = workerLnTotals.filter(
      (v): v is number => v != null && Number.isFinite(v)
    );
    if (parts.length === 0) return null;
    return sumFiniteNumbers(parts);
  }, [workerLnTotals]);

  const onYearClick = useCallback((y: number) => {
    setOpenYear((prev) => {
      if (prev === y) return null;
      return y;
    });
  }, []);

  const onMonthClick = useCallback(
    (m: number) => {
      if (openYear === null) return;
      setTimesheetYear(openYear);
      setTimesheetMonth(m);
      setSelectedProjectId(null);
      setOpenYear(null);
    },
    [openYear]
  );

  useEffect(() => {
    if (
      selectedProjectId != null &&
      !projects.some((p) => p.id === selectedProjectId)
    ) {
      setSelectedProjectId(null);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    setProjectContextMenu(null);
    setRenameDialog(null);
    setLayoutPasteConfirmOpen(false);
    setLayoutPasteConfirmClip(null);
  }, [activeSheetKey]);

  useEffect(() => {
    return () => {
      if (layoutCopyToastTimerRef.current != null) {
        clearTimeout(layoutCopyToastTimerRef.current);
        layoutCopyToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (renameDialog == null) return;
    const el = renameInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [renameDialog]);

  useEffect(() => {
    if (projectContextMenu == null) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const menu = document.querySelector("[data-project-context-menu]");
      if (menu?.contains(t)) return;
      setProjectContextMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [projectContextMenu]);

  useEffect(() => {
    if (
      projectContextMenu == null &&
      renameDialog == null &&
      !personnelMenuOpen &&
      personnelCellMenu == null &&
      personnelEditing == null &&
      !idHeaderMenuOpen &&
      !createAccountModalOpen &&
      accountListRowMenu == null &&
      deleteExtraConfirmIndex == null &&
      editingExtraAccountIndex == null &&
      personnelDeleteConfirm == null
    )
      return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectContextMenu(null);
        setRenameDialog(null);
        setPersonnelMenuOpen(false);
        setPersonnelCellMenu(null);
        setPersonnelEditing(null);
        setPersonnelEditDraft("");
        personnelEditDraftRef.current = "";
        setPersonnelDeleteConfirm(null);
        setIdHeaderMenuOpen(false);
        setCreateAccountModalOpen(false);
        setCreateDraftId("");
        setCreateDraftPassword("");
        setCreateDraftUser("");
        setAccountListRowMenu(null);
        setDeleteExtraConfirmIndex(null);
        setEditingExtraAccountIndex(null);
        setCreateDraftRole("AMOUNT_ADMIN");
        setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    projectContextMenu,
    renameDialog,
    personnelMenuOpen,
    personnelCellMenu,
    personnelEditing,
    idHeaderMenuOpen,
    createAccountModalOpen,
    accountListRowMenu,
    deleteExtraConfirmIndex,
    editingExtraAccountIndex,
    personnelDeleteConfirm,
  ]);

  const handleSaveRename = useCallback(
    async (projectId: string, rawName: string) => {
      const name = normalizeProjectName(rawName);
      if (name === "") {
        window.alert(
          "\uD504\uB85C\uC81D\uD2B8\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694."
        );
        return;
      }
      if (activeSheetKey == null) return;
      const target = serverProjects.find((p) => p.id === projectId);
      if (target == null) return;

      const oldName = normalizeProjectName(target.name);
      if (name === oldName) {
        setRenameDialog(null);
        return;
      }

      const duplicate = serverProjects.find(
        (p) => p.id !== projectId && normalizeProjectName(p.name) === name
      );
      if (duplicate != null) {
        window.alert(
          `\uC774\uBBF8 "${name}" \uD504\uB85C\uC81D\uD2B8\uAC00 \uC788\uC2B5\uB2C8\uB2E4.`
        );
        return;
      }

      const confirmed = window.confirm(
        "\uD504\uB85C\uC81D\uD2B8\uBA85\uC744 \uBCC0\uACBD\uD558\uBA74 \uAE30\uC874 \uACF5\uC218 \uAE30\uB85D\uC758 \uD504\uB85C\uC81D\uD2B8\uBA85\uB3C4 \uD568\uAED8 \uBCC0\uACBD\uB429\uB2C8\uB2E4. \uACC4\uC18D\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"
      );
      if (!confirmed) return;

      const result = await renameProjectNameWithWorkerEntriesInSupabase(
        projectId,
        target.name,
        name
      );
      if (!result.ok) {
        if (result.reason === "duplicate") {
          window.alert(
            `\uC774\uBBF8 "${name}" \uD504\uB85C\uC81D\uD2B8\uAC00 \uC788\uC2B5\uB2C8\uB2E4.`
          );
        } else if (result.reason === "entries_update_failed") {
          window.alert(
            "\uACF5\uC218 \uAE30\uB85D\uC758 \uD504\uB85C\uC81D\uD2B8\uBA85 \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. Supabase RLS(\uAD8C\uD55C)\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694."
          );
        } else {
          window.alert(
            "\uD504\uB85C\uC81D\uD2B8\uBA85 \uC218\uC815\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."
          );
        }
        return;
      }

      if (timesheetYear != null && timesheetMonth != null) {
        const oldKey = timesheetGridStorageKey(
          timesheetYear,
          timesheetMonth,
          target.name
        );
        const newKey = timesheetGridStorageKey(
          timesheetYear,
          timesheetMonth,
          result.project.project_name
        );
        if (oldKey !== newKey) {
          setTimesheetGrids((prev) => {
            const entry = prev[oldKey];
            if (entry == null) return prev;
            const { [oldKey]: _removed, ...rest } = prev;
            return { ...rest, [newKey]: entry };
          });
        }
      }
      setRenameDialog(null);
      await reloadServerProjects();
    },
    [
      activeSheetKey,
      timesheetYear,
      timesheetMonth,
      serverProjects,
      reloadServerProjects,
    ]
  );

  const openWorkerRateDialog = useCallback(
    (workerIndex: number) => {
      const name = (
        activeTimesheetGrid.body[timesheetWorkerNameCellKey(workerIndex)] ?? ""
      ).trim();
      if (name === "") return;
      const workerId = (
        activeTimesheetGrid.body[timesheetWorkerIdCellKey(workerIndex)] ?? ""
      ).trim();
      const { base, spread } = resolveWorkerRatesForSlot(
        workerIndex,
        activeTimesheetGrid.body,
        workerRatesByKey,
        activeTimesheetGrid
      );
      setWorkerRateDialogTarget({
        workerIndex,
        workerName: name,
        workerId,
      });
      setWorkerRateDraft({
        baseInput: formatRateInputValue(base),
        spreadInput: formatRateInputValue(spread),
      });
    },
    [activeTimesheetGrid, workerRatesByKey]
  );

  const closeWorkerRateDialog = useCallback(() => {
    setWorkerRateDialogTarget(null);
  }, []);

  const toggleMoneyFooterMask = useCallback(() => {
    setMoneyFooterUnmasked((masked) => !masked);
  }, []);

  const handleSaveWorkerRateDialog = useCallback(() => {
    if (workerRateDialogTarget == null) return;
    const base = parseRateInputValue(workerRateDraft.baseInput);
    const spread = parseRateInputValue(workerRateDraft.spreadInput);
    const key = workerRateStorageKey(
      workerRateDialogTarget.workerId,
      workerRateDialogTarget.workerName
    );
    setWorkerRatesByKey((prev) => ({
      ...prev,
      [key]: { base, spread },
    }));
    setWorkerRateDialogTarget(null);
  }, [workerRateDialogTarget, workerRateDraft]);

  const handleAddProject = useCallback(async () => {
    if (timesheetYear == null || timesheetMonth == null) {
      window.alert(
        "\uBA3C\uC800 \uC5F0\uB3C4\uC640 \uC6D4\uC744 \uC120\uD0DD\uD558\uC138\uC694."
      );
      return;
    }
    const msg =
      "\uD504\uB85C\uC81D\uD2B8\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694.";
    const raw = window.prompt(msg);
    if (raw == null || raw.trim() === "") return;
    const inserted = await insertProjectToSupabase(raw);
    if (inserted == null) {
      window.alert(
        "\uD504\uB85C\uC81D\uD2B8 \uCD94\uAC00\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. Supabase \uC5F0\uB3D9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    await reloadServerProjects();
    setSelectedProjectId(inserted.id);
    setSheetView("project");
  }, [timesheetYear, timesheetMonth, reloadServerProjects]);

  const handleAddYear = useCallback(() => {
    const msg =
      "\uC0C8 \uC5F0\uB3C4\uB97C \uC785\uB825\uD558\uC138\uC694. (\uC608: 2027)";
    const raw = window.prompt(msg);
    if (raw == null || raw.trim() === "") return;
    const y = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(y) || y < 1990 || y > 2100) {
      window.alert(
        "1990\u20132100 \uC0AC\uC774\uC758 \uC5F0\uB3C4\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    if (y <= DEFAULT_INITIAL_YEAR) {
      window.alert(
        `${DEFAULT_INITIAL_YEAR + 1}\uB144 \uBD80\uD130 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`
      );
      return;
    }
    setYears((prev) => [...new Set([...prev, y])].sort((a, b) => a - b));
    setOpenYear(y);
  }, []);

  const copyTimesheetLayoutStructure = useCallback(() => {
    if (activeTimesheetGridKey == null || timesheetMonth == null) return;
    const p = projects.find((x) => x.id === selectedProjectId);
    const sourceDisplayLabel =
      p != null ? `${timesheetMonth}\uC6D4 ${p.name}` : "\uACF5\uC218\uD45C";
    const grid =
      timesheetGrids[activeTimesheetGridKey] ?? { ...EMPTY_TIMESHEET_GRID };
    const workerNames = Array.from({ length: WORKER_SLOT_COUNT }, (_, wi) =>
      grid.body[timesheetWorkerNameCellKey(wi)] ?? ""
    );
    const workerRates = Array.from({ length: WORKER_SLOT_COUNT }, (_, wi) => {
      const { base, spread } = resolveWorkerRatesForSlot(
        wi,
        grid.body,
        workerRatesByKey,
        grid
      );
      return { base, spread };
    });
    const payload: TimesheetLayoutClipboardV1 = {
      v: 1,
      companyNames: COMPANY_ROW_DEFS.map((d) => d.name),
      companyWorkerSlotCounts: [...activeCompanyWorkerSlotCounts],
      workerNames,
      workerRates,
      sourceDisplayLabel,
    };
    if (!saveTimesheetLayoutClipboard(payload)) {
      window.alert(
        "\uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uBE0C\uB77C\uC6B0\uC800 \uC800\uC7A5\uC18C\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    setLayoutClipboardReady(true);
    if (layoutCopyToastTimerRef.current != null) {
      clearTimeout(layoutCopyToastTimerRef.current);
      layoutCopyToastTimerRef.current = null;
    }
    setLayoutCopyToast(
      `\u2018${sourceDisplayLabel}\u2019 \uACF5\uC218\uD45C \uAD6C\uC870\uAC00 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
    );
    setLayoutCopyOkFlash(true);
    layoutCopyToastTimerRef.current = window.setTimeout(() => {
      setLayoutCopyToast(null);
      setLayoutCopyOkFlash(false);
      layoutCopyToastTimerRef.current = null;
    }, 2600);
  }, [
    activeTimesheetGridKey,
    timesheetGrids,
    activeCompanyWorkerSlotCounts,
    timesheetMonth,
    selectedProjectId,
    projects,
    workerRatesByKey,
  ]);

  const openLayoutPasteConfirm = useCallback(() => {
    if (activeTimesheetGridKey == null) return;
    const clip = loadTimesheetLayoutClipboard();
    if (clip == null) {
      setLayoutClipboardReady(false);
      window.alert(
        "\uBCF5\uC0AC\uB41C \uACF5\uC218\uD45C \uAD6C\uC870\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."
      );
      return;
    }
    setLayoutPasteConfirmClip(clip);
    setLayoutPasteConfirmOpen(true);
  }, [activeTimesheetGridKey]);

  const cancelLayoutPasteConfirm = useCallback(() => {
    setLayoutPasteConfirmOpen(false);
    setLayoutPasteConfirmClip(null);
  }, []);

  const confirmLayoutPaste = useCallback(() => {
    const clip = layoutPasteConfirmClip;
    if (clip == null || activeTimesheetGridKey == null) {
      setLayoutPasteConfirmOpen(false);
      setLayoutPasteConfirmClip(null);
      return;
    }
    const gridKey = activeTimesheetGridKey;
    const pastedRates = workerRatesByKeyFromLayoutClipboard(clip);
    setTimesheetGrids((prev) => {
      const c = ensureTimesheetGridEntry(prev, gridKey);
      const nextGrid = applyLayoutClipboardToTimesheetGrid(c, clip);
      return {
        ...prev,
        [gridKey]: {
          ...nextGrid,
          money: { ...nextGrid.money },
          workerBaseRates: { ...(nextGrid.workerBaseRates ?? {}) },
          workerSpreadRates: { ...(nextGrid.workerSpreadRates ?? {}) },
        },
      };
    });
    if (Object.keys(pastedRates).length > 0) {
      setWorkerRatesByKey((prev) => ({ ...prev, ...pastedRates }));
    }
    setLayoutPasteConfirmOpen(false);
    setLayoutPasteConfirmClip(null);
  }, [layoutPasteConfirmClip, activeTimesheetGridKey]);

  const openPersonnelGrade = useCallback((label: string) => {
    setPersonnelByGrade((prev) => {
      const existing = prev[label];
      if (existing && existing.length > 0) return prev;
      return { ...prev, [label]: createEmptyPersonnelRows() };
    });
    setMainView("personnel");
    setSelectedPersonnelGrade(label);
    setPersonnelMenuOpen(false);
    setPersonnelCellMenu(null);
    setPersonnelEditing(null);
    setPersonnelEditDraft("");
    personnelEditDraftRef.current = "";
    setIdHeaderMenuOpen(false);
    setCreateAccountModalOpen(false);
    setCreateDraftId("");
    setCreateDraftPassword("");
    setCreateDraftUser("");
    setAccountListRowMenu(null);
    setEditingExtraAccountIndex(null);
    setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
    setDeleteExtraConfirmIndex(null);
    setPersonnelDeleteConfirm(null);
    setOpenYear(null);
  }, []);

  const goToTimesheetView = useCallback(() => {
    setMainView("timesheet");
    setSelectedPersonnelGrade(null);
    setPersonnelMenuOpen(false);
    setPersonnelCellMenu(null);
    setPersonnelEditing(null);
    setPersonnelEditDraft("");
    personnelEditDraftRef.current = "";
    setIdHeaderMenuOpen(false);
    setCreateAccountModalOpen(false);
    setCreateDraftId("");
    setCreateDraftPassword("");
    setCreateDraftUser("");
    setAccountListRowMenu(null);
    setEditingExtraAccountIndex(null);
    setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
    setDeleteExtraConfirmIndex(null);
    setPersonnelDeleteConfirm(null);
  }, []);

  const closeIdAdminUi = useCallback(() => {
    setIdHeaderMenuOpen(false);
    setCreateAccountModalOpen(false);
    setCreateDraftId("");
    setCreateDraftPassword("");
    setCreateDraftUser("");
    setCreateDraftRole("AMOUNT_ADMIN");
    setAccountListRowMenu(null);
    setEditingExtraAccountIndex(null);
    setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
    setDeleteExtraConfirmIndex(null);
  }, []);

  const submitCreateAdminAccount = useCallback(() => {
    if (!canManageAccounts) return;
    const nid = createDraftId.trim();
    const npw = createDraftPassword.trim();
    const nuser = createDraftUser.trim();
    if (!nid || !npw || !nuser) {
      window.alert(
        "\uBAA8\uB4E0 \uD56D\uBAA9\uC744 \uC785\uB825\uD558\uC138\uC694."
      );
      return;
    }
    if (
      normalizeAdminAccountId(nid) ===
      normalizeAdminAccountId(MASTER_ADMIN_ID)
    ) {
      window.alert(
        "\uB9C8\uC2A4\uD130 \uACC4\uC815\uACFC \uB3D9\uC77C\uD55C ID\uB294 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."
      );
      return;
    }
    if (
      extraAdminAccounts.some(
        (a) =>
          normalizeAdminAccountId(a.id) === normalizeAdminAccountId(nid)
      )
    ) {
      window.alert(
        "\uC774\uBBF8 \uC874\uC7AC\uD558\uB294 ID\uC785\uB2C8\uB2E4."
      );
      return;
    }
    setExtraAdminAccounts((prev) => [
      ...prev,
      { id: nid, password: npw, user: nuser, role: createDraftRole },
    ]);
    setCreateAccountModalOpen(false);
    setCreateDraftId("");
    setCreateDraftPassword("");
    setCreateDraftUser("");
    setCreateDraftRole("AMOUNT_ADMIN");
  }, [
    canManageAccounts,
    createDraftId,
    createDraftPassword,
    createDraftUser,
    createDraftRole,
    extraAdminAccounts,
  ]);

  const cancelEditExtraAccount = useCallback(() => {
    setEditingExtraAccountIndex(null);
    setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
  }, []);

  const saveEditExtraAccount = useCallback(() => {
    if (!canManageAccounts) return;
    if (editingExtraAccountIndex == null) return;
    const ix = editingExtraAccountIndex;
    const nid = editExtraDraft.id.trim();
    const npw = editExtraDraft.password.trim();
    const nuser = editExtraDraft.user.trim();
    if (!nid || !npw || !nuser) {
      window.alert(
        "\uBAA8\uB4E0 \uD56D\uBAA9\uC744 \uC785\uB825\uD558\uC138\uC694."
      );
      return;
    }
    if (
      normalizeAdminAccountId(nid) ===
      normalizeAdminAccountId(MASTER_ADMIN_ID)
    ) {
      window.alert(
        "\uB9C8\uC2A4\uD130 \uACC4\uC815\uACFC \uB3D9\uC77C\uD55C ID\uB294 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."
      );
      return;
    }
    if (
      extraAdminAccounts.some(
        (a, i) =>
          i !== ix &&
          normalizeAdminAccountId(a.id) === normalizeAdminAccountId(nid)
      )
    ) {
      window.alert(
        "\uC774\uBBF8 \uC874\uC7AC\uD558\uB294 ID\uC785\uB2C8\uB2E4."
      );
      return;
    }
    setExtraAdminAccounts((prev) => {
      if (ix < 0 || ix >= prev.length) return prev;
      if (
        normalizeAdminAccountId(prev[ix].id) ===
        normalizeAdminAccountId(MASTER_ADMIN_ID)
      )
        return prev;
      const next = [...prev];
      next[ix] = {
        id: nid,
        password: npw,
        user: nuser,
        role: editExtraDraft.role,
      };
      return next;
    });
    cancelEditExtraAccount();
  }, [
    canManageAccounts,
    editingExtraAccountIndex,
    editExtraDraft,
    extraAdminAccounts,
    cancelEditExtraAccount,
  ]);

  const openAccountListRowMenu = useCallback(
    (e: MouseEvent<HTMLButtonElement>, index: number) => {
      if (!canManageAccounts) return;
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const menuW = 112;
      const vw = window.innerWidth;
      let left = rect.right - menuW;
      const top = rect.bottom + 4;
      if (left < 6) left = 6;
      if (left + menuW > vw - 6) left = Math.max(6, vw - menuW - 6);
      setAccountListRowMenu((prev) =>
        prev?.index === index ? null : { index, left, top }
      );
    },
    [canManageAccounts]
  );

  const startEditExtraAccount = useCallback(
    (index: number) => {
      if (!canManageAccounts) return;
      const row = extraAdminAccounts[index];
      if (
        !row ||
        normalizeAdminAccountId(row.id) ===
          normalizeAdminAccountId(MASTER_ADMIN_ID)
      )
        return;
      setAccountListRowMenu(null);
      setEditingExtraAccountIndex(index);
      setEditExtraDraft({
        id: row.id,
        password: row.password,
        user: row.user,
        role: normalizeExtraAdminRole(row.role),
      });
    },
    [canManageAccounts, extraAdminAccounts]
  );

  const requestDeleteExtraAccount = useCallback(
    (index: number) => {
      if (!canManageAccounts) return;
      setAccountListRowMenu(null);
      const row = extraAdminAccounts[index];
      if (
        !row ||
        normalizeAdminAccountId(row.id) ===
          normalizeAdminAccountId(MASTER_ADMIN_ID)
      )
        return;
      setDeleteExtraConfirmIndex(index);
    },
    [canManageAccounts, extraAdminAccounts]
  );

  const confirmDeleteExtraAccount = useCallback(() => {
    if (!canManageAccounts) return;
    if (deleteExtraConfirmIndex == null) return;
    const delIx = deleteExtraConfirmIndex;
    setExtraAdminAccounts((prev) => {
      if (delIx < 0 || delIx >= prev.length) return prev;
      if (
        normalizeAdminAccountId(prev[delIx].id) ===
        normalizeAdminAccountId(MASTER_ADMIN_ID)
      )
        return prev;
      return prev.filter((_, i) => i !== delIx);
    });
    setDeleteExtraConfirmIndex(null);
    setEditingExtraAccountIndex(null);
    setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
  }, [canManageAccounts, deleteExtraConfirmIndex]);

  const cancelDeleteExtraAccount = useCallback(() => {
    setDeleteExtraConfirmIndex(null);
  }, []);

  const updatePersonnelCell = useCallback(
    (
      grade: string,
      rowIndex: number,
      field: keyof PersonnelRowPersist,
      text: string
    ) => {
      setPersonnelByGrade((prev) => {
        let cur = prev[grade] ?? createEmptyPersonnelRows();
        if (rowIndex < 0) return prev;
        if (rowIndex >= cur.length) {
          cur = [
            ...cur,
            ...createEmptyPersonnelRows(rowIndex + 1 - cur.length),
          ];
        }
        const nextRows = cur.map((r, i) =>
          i === rowIndex ? { ...r, [field]: text } : r
        );
        return { ...prev, [grade]: nextRows };
      });
    },
    []
  );

  const cancelPersonnelEdit = useCallback(() => {
    setPersonnelEditing(null);
    setPersonnelEditDraft("");
    personnelEditDraftRef.current = "";
  }, []);

  const commitPersonnelEdit = useCallback(() => {
    if (!personnelEditing) return;
    const raw =
      personnelEditInputRef.current?.value ?? personnelEditDraftRef.current;
    const v =
      personnelEditing.field === "phone"
        ? formatKoreanPhoneDisplay(raw)
        : raw;
    updatePersonnelCell(
      personnelEditing.grade,
      personnelEditing.rowIndex,
      personnelEditing.field,
      v
    );
    setPersonnelEditing(null);
    setPersonnelEditDraft("");
    personnelEditDraftRef.current = "";
  }, [personnelEditing, updatePersonnelCell]);

  const startPersonnelCellEdit = useCallback(() => {
    if (!personnelCellMenu) return;
    const { grade, rowIndex, field } = personnelCellMenu;
    const rows = personnelByGrade[grade] ?? createEmptyPersonnelRows();
    const curRaw = String(rows[rowIndex]?.[field] ?? "");
    const cur =
      field === "phone" ? formatKoreanPhoneDisplay(curRaw) : curRaw;
    personnelEditDraftRef.current = cur;
    setPersonnelEditDraft(cur);
    setPersonnelEditing({ grade, rowIndex, field });
    setPersonnelCellMenu(null);
  }, [personnelCellMenu, personnelByGrade]);

  const requestPersonnelRowDelete = useCallback(() => {
    if (!personnelCellMenu) return;
    const { grade, rowIndex } = personnelCellMenu;
    setPersonnelCellMenu(null);
    setPersonnelDeleteConfirm({ grade, rowIndex });
  }, [personnelCellMenu]);

  const confirmPersonnelRowDelete = useCallback(() => {
    if (!personnelDeleteConfirm) return;
    const { grade, rowIndex } = personnelDeleteConfirm;
    setPersonnelByGrade((prev) => {
      const cur = prev[grade] ?? createEmptyPersonnelRows();
      if (rowIndex < 0 || rowIndex >= cur.length) return prev;
      const empty: PersonnelRowPersist = { name: "", region: "", phone: "" };
      const nextRows = cur.map((r, i) => (i === rowIndex ? { ...empty } : r));
      return { ...prev, [grade]: nextRows };
    });
    setPersonnelDeleteConfirm(null);
  }, [personnelDeleteConfirm]);

  const cancelPersonnelRowDelete = useCallback(() => {
    setPersonnelDeleteConfirm(null);
  }, []);

  const onPersonnelDataCellClick = useCallback(
    (
      e: MouseEvent<HTMLTableCellElement>,
      grade: string,
      rowIndex: number,
      field: keyof PersonnelRowPersist
    ) => {
      if (personnelEditing) {
        const same =
          personnelEditing.grade === grade &&
          personnelEditing.rowIndex === rowIndex &&
          personnelEditing.field === field;
        if (same) return;
        commitPersonnelEdit();
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const menuW = 96;
      const vw = window.innerWidth;
      let left = rect.left;
      const top = rect.bottom + 4;
      if (left + menuW > vw - 6) left = Math.max(6, vw - menuW - 6);
      if (left < 6) left = 6;
      setPersonnelCellMenu({ grade, rowIndex, field, left, top });
    },
    [personnelEditing, commitPersonnelEdit]
  );

  const updateActiveCompanyWorkerSlotCounts = useCallback(
    (updater: (prev: number[]) => number[]) => {
      if (activeTimesheetGridKey == null) return;
      setTimesheetGrids((prev) => {
        const cur = ensureTimesheetGridEntry(prev, activeTimesheetGridKey);
        const nextCounts = normalizeCompanyWorkerSlotCounts(
          updater(slotCountsForGrid(cur))
        );
        return {
          ...prev,
          [activeTimesheetGridKey]: {
            ...cur,
            companyWorkerSlotCounts: nextCounts,
          },
        };
      });
    },
    [activeTimesheetGridKey]
  );

  /** ?∞Ï∏° ?îÏÇ¥?? ?¥Îãπ ?ÖÏ≤¥ +1, Î∞îÎ°ú ?§Î•∏Ï™??ÖÏ≤¥ -1 */
  const shiftSlotsFromRightNeighbor = useCallback(
    (groupIndex: number) => {
      updateActiveCompanyWorkerSlotCounts((prev) => {
        if (groupIndex >= prev.length - 1) return prev;
        const next = [...prev];
        if (next[groupIndex + 1] <= 1) return prev;
        next[groupIndex]++;
        next[groupIndex + 1]--;
        return next;
      });
    },
    [updateActiveCompanyWorkerSlotCounts]
  );

  /** Ï¢åÏ∏° ?îÏÇ¥?? ?¥Îãπ ?ÖÏ≤¥ -1, Î∞îÎ°ú ?§Î•∏Ï™??ÖÏ≤¥ +1 */
  const shiftSlotsToRightNeighbor = useCallback(
    (groupIndex: number) => {
      updateActiveCompanyWorkerSlotCounts((prev) => {
        if (groupIndex >= prev.length - 1) return prev;
        const next = [...prev];
        if (next[groupIndex] <= 1) return prev;
        next[groupIndex]--;
        next[groupIndex + 1]++;
        return next;
      });
    },
    [updateActiveCompanyWorkerSlotCounts]
  );

  useEffect(() => {
    const snapshot: AdminPersistV1 = {
      v: 1,
      years,
      timesheetYear,
      timesheetMonth,
      openYear,
      projectsBySheet: {},
      selectedProjectId,
      sheetView,
      timesheetGrids: stripWorkerNamesFromTimesheetGrids(
        stripLegacyAirfareFromTimesheetGrids(timesheetGrids),
        WORKER_SLOT_COUNT
      ),
      summaryTotalsBySheet: {},
      companyWorkerSlotCounts: [...DEFAULT_COMPANY_WORKER_SLOT_COUNTS],
      personnelByGrade,
      extraAdminAccounts,
      workerRatesByKey,
    };
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        /* ?Ä??Í≥µÍ∞Ñ Î∂ÄÏ°???*/
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [
    years,
    timesheetYear,
    timesheetMonth,
    openYear,
    selectedProjectId,
    sheetView,
    timesheetGrids,
    personnelByGrade,
    extraAdminAccounts,
    workerRatesByKey,
  ]);

  useEffect(() => {
    if (workerRateDialogTarget == null) return;
    const t = window.setTimeout(() => {
      workerRateBaseInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [workerRateDialogTarget]);

  useEffect(() => {
    if (!personnelMenuOpen) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const slot = document.querySelector("[data-personnel-header-slot]");
      if (slot?.contains(t)) return;
      setPersonnelMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [personnelMenuOpen]);

  useEffect(() => {
    if (!showAmountRows) setMoneyFooterUnmasked(false);
  }, [showAmountRows]);

  useEffect(() => {
    if (!canManageAccounts) return;
    if (!idHeaderMenuOpen) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const slot = document.querySelector("[data-id-header-slot]");
      if (slot?.contains(t)) return;
      setIdHeaderMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [canManageAccounts, idHeaderMenuOpen]);

  useEffect(() => {
    if (canManageAccounts) return;
    setMainView((v) => (v === "accountList" ? "timesheet" : v));
    closeIdAdminUi();
  }, [canManageAccounts, closeIdAdminUi]);

  useEffect(() => {
    setPersonnelCellMenu(null);
    setPersonnelEditing(null);
    setPersonnelEditDraft("");
    personnelEditDraftRef.current = "";
    setIdHeaderMenuOpen(false);
    setCreateAccountModalOpen(false);
    setCreateDraftId("");
    setCreateDraftPassword("");
    setCreateDraftUser("");
    setAccountListRowMenu(null);
    setEditingExtraAccountIndex(null);
    setCreateDraftRole("AMOUNT_ADMIN");
    setEditExtraDraft({ id: "", password: "", user: "", role: "AMOUNT_ADMIN" });
    setDeleteExtraConfirmIndex(null);
    setPersonnelDeleteConfirm(null);
  }, [mainView, selectedPersonnelGrade]);

  useEffect(() => {
    if (personnelCellMenu == null) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-personnel-cell-popup]")) return;
      setPersonnelCellMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [personnelCellMenu]);

  useEffect(() => {
    if (!canManageAccounts) return;
    if (accountListRowMenu == null) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-account-list-row-menu]")) return;
      setAccountListRowMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [canManageAccounts, accountListRowMenu]);

  useEffect(() => {
    if (!personnelEditing) return;
    const id = window.requestAnimationFrame(() => {
      const el = personnelEditInputRef.current;
      el?.focus();
      el?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [personnelEditing]);

  useEffect(() => {
    if (openYear === null) return;
    const onMouseDownCapture = (e: globalThis.MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-admin-year-slot]")) return;
      setOpenYear(null);
    };
    document.addEventListener("mousedown", onMouseDownCapture, true);
    return () =>
      document.removeEventListener("mousedown", onMouseDownCapture, true);
  }, [openYear]);

  useEffect(() => {
    if (mainView !== "personnel" || selectedPersonnelGrade == null) return;
    const g = selectedPersonnelGrade;
    setPersonnelByGrade((prev) => {
      const cur = prev[g] ?? createEmptyPersonnelRows();
      if (cur.length >= PERSONNEL_DEFAULT_ROW_COUNT) return prev;
      return {
        ...prev,
        [g]: [
          ...cur,
          ...createEmptyPersonnelRows(PERSONNEL_DEFAULT_ROW_COUNT - cur.length),
        ],
      };
    });
  }, [mainView, selectedPersonnelGrade]);

  useEffect(() => {
    if (mainView !== "personnel") return;
    const gen = ++workersPersonnelFetchGenRef.current;
    void fetchWorkersGroupedByPersonnelGrade().then(({ byGrade, error }) => {
      if (workersPersonnelFetchGenRef.current !== gen) return;
      if (error != null && error !== "not_configured") {
        console.error(
          "[Supabase] workers personnel: using local data only",
          error
        );
      }
      setWorkersByGradeFromSupabase(byGrade);
    });
    return () => {
      workersPersonnelFetchGenRef.current += 1;
    };
  }, [mainView]);

  const personnelDisplayForGrade = useMemo(() => {
    if (selectedPersonnelGrade == null) {
      return mergePersonnelGradeForDisplay(createEmptyPersonnelRows(), []);
    }
    const local =
      personnelByGrade[selectedPersonnelGrade] ?? createEmptyPersonnelRows();
    const remote =
      workersByGradeFromSupabase?.[selectedPersonnelGrade] ?? [];
    return mergePersonnelGradeForDisplay(local, remote);
  }, [
    selectedPersonnelGrade,
    personnelByGrade,
    workersByGradeFromSupabase,
  ]);

  const mainHint = useMemo(() => {
    if (timesheetYear == null || timesheetMonth == null) {
      return {
        title:
          "\uC5F0\uB3C4 \uBC84\uD2BC\uC744 \uB20C\uB7EC \uC6D4 \uBA54\uB274\uB97C \uC5F4\uACE0, \uC6D4\uC744 \uC120\uD0DD\uD558\uC138\uC694.",
        detail:
          "\uC5F0\uB3C4\uC640 \uC6D4\uC744 \uBAA8\uB450 \uC120\uD0DD\uD55C \uD6C4\uC5D0\uB9CC \uACF5\uC218\uD45C\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
      };
    }
    if (sheetView === "project" && selectedProjectId == null) {
      return {
        title:
          "\uD504\uB85C\uC81D\uD2B8 \uD0ED\uC744 \uC120\uD0DD\uD558\uAC70\uB098 \uCD94\uAC00\uD574 \uC8FC\uC138\uC694.",
        detail:
          "\uC804\uCCB4\uB97C \uB20C\uB974\uBA74 \uD574\uB2F9 \uC6D4\uC758 \uD504\uB85C\uC81D\uD2B8\uBCC4 \uC694\uC57D\uD45C\uB97C \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
      };
    }
    return null;
  }, [timesheetYear, timesheetMonth, selectedProjectId, sheetView]);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-200 text-slate-900">
      <header className="shrink-0 border-b border-slate-300 bg-white shadow-sm">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="w-[5.5rem] shrink-0 md:w-28" aria-hidden />
          <h1 className="min-w-0 flex-1 text-center font-serif tracking-tight">
            <span className="inline-flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5">
              <span
                className="bg-gradient-to-b from-[#fff6b0] via-[#f5d547] to-[#c9a227] bg-clip-text text-2xl font-semibold text-transparent md:text-3xl lg:text-4xl"
                style={{
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                }}
              >
                L&N
              </span>
              <span className="text-xl font-semibold text-slate-800 md:text-2xl lg:text-3xl">
                {"\uACF5\uC218\uCCB4\uD06C"}
              </span>
            </span>
          </h1>
          <div className="flex shrink-0 items-center justify-end gap-1.5 md:gap-2">
            {canManageAccounts ? (
              <div className="relative" data-id-header-slot="">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={idHeaderMenuOpen}
                  aria-label="ID \uBA54\uB274"
                  onClick={() => {
                    setPersonnelMenuOpen(false);
                    setIdHeaderMenuOpen((o) => !o);
                  }}
                  className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 active:bg-slate-100 md:px-2.5 md:text-xs"
                >
                  ID
                </button>
              {idHeaderMenuOpen ? (
                <div
                  className="absolute right-0 top-full z-[135] mt-1 min-w-[6.5rem] rounded-md border border-slate-300 bg-white py-1 shadow-lg"
                  role="listbox"
                  aria-label="ID \uBA54\uB274"
                >
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      setCreateDraftId("");
                      setCreateDraftPassword("");
                      setCreateDraftUser("");
                      setCreateDraftRole("AMOUNT_ADMIN");
                      setCreateAccountModalOpen(true);
                      setIdHeaderMenuOpen(false);
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] font-medium text-slate-800 hover:bg-slate-100 md:text-xs"
                  >
                    {"\uC0DD\uC131"}
                  </button>
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      setMainView("accountList");
                      setIdHeaderMenuOpen(false);
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] font-medium text-slate-800 hover:bg-slate-100 md:text-xs"
                  >
                    {"\uBAA9\uB85D"}
                  </button>
                </div>
              ) : null}
              </div>
            ) : null}
            <div className="relative" data-personnel-header-slot="">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={personnelMenuOpen}
                aria-label={"\uC778\uC801\uC0AC\uD56D \uBA54\uB274"}
                onClick={() => {
                  setIdHeaderMenuOpen(false);
                  setPersonnelMenuOpen((o) => !o);
                }}
                className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 active:bg-slate-100 md:px-2.5 md:text-xs"
              >
                {"\uC778\uC801\uC0AC\uD56D"}
              </button>
              {personnelMenuOpen ? (
                <div
                  className="absolute right-0 top-full z-[130] mt-1 min-w-[7.25rem] rounded-md border border-slate-300 bg-white py-1 shadow-lg"
                  role="listbox"
                  aria-label={"\uC778\uC801\uC0AC\uD56D \uB4F1\uAE09"}
                >
                  {PERSONNEL_GRADE_LABELS.map((gradeLabel) => (
                    <button
                      key={gradeLabel}
                      type="button"
                      role="option"
                      onClick={() => openPersonnelGrade(gradeLabel)}
                      className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] font-medium text-slate-800 hover:bg-slate-100 md:text-xs"
                    >
                      {gradeLabel}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 active:bg-slate-100 md:px-3 md:text-sm"
            >
              {"\uB85C\uADF8\uC544\uC6C3"}
            </button>
          </div>
        </div>
      </header>

      {mainView === "timesheet" ? (
        <>
          {/* ???? Ï¢åÏ∏° ?ïÎ†¨, ?úÎ°≠?§Ïö¥?Ä ?§ÌÅ¨Î°?Î∞?overflow ÎØ∏ÌÅ¥Î¶? */}
          <div className="shrink-0 w-full min-w-0 overflow-x-visible overflow-y-visible border-b border-slate-200 bg-white py-2.5 pl-1 pr-1 md:pl-2 md:pr-2">
        <div className="flex w-max max-w-none flex-nowrap items-center gap-2">
          <span className="shrink-0 rounded border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-800 md:text-sm">
            {"\uC5F0/\uC6D4"}
          </span>
          {years.map((y) => {
            const sheetHere =
              timesheetYear === y && timesheetMonth != null;
            const menuOpen = openYear === y;
            return (
              <div
                key={y}
                className="relative shrink-0"
                data-admin-year-slot=""
              >
                <button
                  type="button"
                  onClick={() => onYearClick(y)}
                  className={`rounded border px-2.5 py-1.5 text-xs font-semibold tabular-nums transition md:text-sm ${
                    sheetHere
                      ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                      : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  } ${
                    menuOpen
                      ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-white"
                      : ""
                  }`}
                >
                  <span className="tabular-nums">{y}</span>
                  <span
                    className="ml-0.5 inline text-[10px] opacity-70"
                    aria-hidden
                  >
                    {menuOpen ? "\u25BC" : "\u25B6"}
                  </span>
                </button>
                {menuOpen ? (
                  <div
                    className="absolute left-0 top-full z-[100] mt-1 min-w-[5.5rem] rounded-md border border-slate-300 bg-white py-1 shadow-lg"
                    role="listbox"
                    aria-label={`${y}\uB144 \uC6D4 \uC120\uD0DD`}
                  >
                    {MONTHS.map((m) => {
                      const sel =
                        timesheetYear === openYear &&
                        timesheetMonth === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="option"
                          aria-selected={sel}
                          onClick={() => onMonthClick(m)}
                          className={`flex w-full items-center px-2.5 py-1 text-left text-[11px] font-medium tabular-nums hover:bg-slate-100 md:text-xs ${
                            sel
                              ? "bg-teal-50 font-semibold text-teal-900"
                              : "text-slate-800"
                          }`}
                        >
                          {m}
                          {"\uC6D4"}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            onClick={handleAddYear}
            className="shrink-0 rounded border border-dashed border-slate-400 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 md:text-sm"
          >
            {"\uCD94\uAC00"}
          </button>
        </div>
      </div>

      {/* ?ÑÎ°ú?ùÌä∏: Ï¢åÏ∏° ?§ÌÅ¨Î°?+ ?∞Ï∏° Í≥†Ï†ï ?ÑÏ≤¥ */}
      <div className="flex w-full min-w-0 items-stretch border-b border-slate-200 bg-white">
        <div className="min-w-0 flex-1 overflow-x-auto py-2 pl-1 md:py-2.5 md:pl-2">
          <div className="flex w-max flex-nowrap items-center gap-2">
            <span className="shrink-0 rounded border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-800 md:text-sm">
              {"\uD504\uB85C\uC81D\uD2B8"}
            </span>
            {activeSheetKey == null ? (
              <span className="shrink-0 whitespace-nowrap text-xs text-slate-500 md:text-sm">
                {
                  "\uBA3C\uC800 \uC5F0\uB3C4\uC5D0\uC11C \uC6D4\uC744 \uC120\uD0DD\uD558\uBA74 \uD574\uB2F9 \uC6D4\uC758 \uD504\uB85C\uC81D\uD2B8\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4."
                }
              </span>
            ) : (
              projects.map((p) => {
                const active =
                  sheetView === "project" && selectedProjectId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-project-tab=""
                    onClick={() => {
                      setSheetView("project");
                      setSelectedProjectId(p.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const { left, top } = clampProjectContextMenuPosition(
                        e.clientX,
                        e.clientY
                      );
                      setProjectContextMenu({
                        projectId: p.id,
                        left,
                        top,
                      });
                    }}
                    className={`shrink-0 truncate rounded border px-2.5 py-1.5 text-xs font-semibold transition md:text-sm ${
                      active
                        ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                        : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                    title={p.name}
                  >
                    {p.name}
                  </button>
                );
              })
            )}
            <button
              type="button"
              onClick={handleAddProject}
              disabled={activeSheetKey == null}
              className="shrink-0 rounded border border-dashed border-slate-400 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 md:text-sm"
            >
              {"\uCD94\uAC00"}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center border-l border-slate-200 bg-white py-2 pl-2 pr-1 md:pr-2">
          <button
            type="button"
            disabled={activeSheetKey == null}
            onClick={() => {
              setSheetView("summary");
              setSelectedProjectId(null);
            }}
            className={`shrink-0 rounded border px-2.5 py-1.5 text-xs font-semibold transition md:text-sm ${
              sheetView === "summary"
                ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {"\uC804\uCCB4"}
          </button>
        </div>
      </div>
        </>
      ) : null}

      <main
        className={
          mainView === "personnel" && selectedPersonnelGrade != null
            ? "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-1 py-1 md:px-2"
            : "min-h-0 w-full min-w-0 flex-1 overflow-auto px-1 py-2 md:px-2 md:py-2"
        }
      >
        <div
          className={
            mainView === "personnel" && selectedPersonnelGrade != null
              ? "flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden"
              : "w-full max-w-none pb-4"
          }
        >
          {mainView === "personnel" && selectedPersonnelGrade ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-1 px-0.5 md:px-1">
                <h2 className="min-w-0 flex-1 text-center text-base font-bold text-slate-800 md:text-lg">
                  {selectedPersonnelGrade}
                  {" \uC778\uC801\uC0AC\uD56D"}
                </h2>
                <button
                  type="button"
                  onClick={goToTimesheetView}
                  className="shrink-0 rounded-md border border-teal-600 bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 md:text-sm"
                >
                  {"\uACF5\uC218\uD45C"}
                </button>
              </div>
              {(() => {
                const displayRows = personnelDisplayForGrade.rows;
                const displayMeta = personnelDisplayForGrade.meta;
                const gradeKey = selectedPersonnelGrade;
                const rowsPerPanel = PERSONNEL_LEFT_COLUMN_ROW_COUNT;
                const emptyRow: PersonnelRowPersist = {
                  name: "",
                  region: "",
                  phone: "",
                };
                const rowAt = (gi: number): PersonnelRowPersist =>
                  displayRows[gi] ?? emptyRow;

                const renderFieldCell = (
                  globalRi: number,
                  f: (typeof PERSONNEL_TABLE_FIELDS)[number]
                ) => {
                  const { field, inputType, mono, colAria, formatPhone } = f;
                  const row = rowAt(globalRi);
                  const meta = displayMeta[globalRi];
                  const localIndex =
                    meta?.source === "local" ? meta.localIndex : null;
                  const isRemote = meta?.source === "remote";
                  const isEditing =
                    personnelEditing != null &&
                    personnelEditing.grade === gradeKey &&
                    localIndex != null &&
                    personnelEditing.rowIndex === localIndex &&
                    personnelEditing.field === field;
                  const raw = String(row[field] ?? "");
                  const showBlank = raw.trim() === "";
                  const displayValue = formatPhone
                    ? formatKoreanPhoneDisplay(raw)
                    : raw;
                  return (
                    <td
                      key={`${globalRi}-${String(field)}`}
                      data-personnel-table-cell
                      className={`relative border border-slate-500 align-middle ${
                        isEditing
                          ? "bg-amber-50/90"
                          : isRemote
                            ? "cursor-default"
                            : "cursor-pointer"
                      }`}
                      onClick={(e) => {
                        if (isEditing || isRemote || localIndex == null) return;
                        onPersonnelDataCellClick(
                          e,
                          gradeKey,
                          localIndex,
                          field
                        );
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      {isEditing ? (
                        <div
                          className="flex items-stretch gap-0.5 px-0.5 py-0.5"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <input
                            ref={personnelEditInputRef}
                            type={inputType}
                            inputMode={
                              formatPhone
                                ? ("numeric" as const)
                                : undefined
                            }
                            autoComplete="off"
                            aria-label={`${gradeKey} ${globalRi + 1} ${colAria}`}
                            value={personnelEditDraft}
                            onChange={(
                              e: ChangeEvent<HTMLInputElement>
                            ) => {
                              if (formatPhone) {
                                const d = digitsOnly(e.target.value);
                                const clip = /^01[016789]/.test(d)
                                  ? d.slice(0, 11)
                                  : d.slice(0, 15);
                                const display =
                                  formatKoreanPhoneDisplay(clip);
                                personnelEditDraftRef.current = display;
                                setPersonnelEditDraft(display);
                              } else {
                                personnelEditDraftRef.current =
                                  e.target.value;
                                setPersonnelEditDraft(e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitPersonnelEdit();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelPersonnelEdit();
                              }
                            }}
                            onBlur={() => commitPersonnelEdit()}
                            className={`box-border min-h-[1.75rem] min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-left text-[12px] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-400/70 md:text-[13px] ${
                              mono ? "font-mono tabular-nums" : ""
                            }`}
                          />
                          <button
                            type="button"
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => commitPersonnelEdit()}
                            className="shrink-0 self-stretch rounded border border-teal-600 bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-white shadow-sm hover:bg-teal-700 md:text-[11px]"
                          >
                            {"\uC800\uC7A5"}
                          </button>
                        </div>
                      ) : (
                        <div className="min-h-[1.75rem] truncate px-1 py-0.5 text-left text-[12px] leading-tight md:text-[13px]">
                          {showBlank ? "\u00A0" : displayValue}
                        </div>
                      )}
                    </td>
                  );
                };

                const panelTable = (
                  baseOffset: number,
                  rowCount: number
                ) => (
                  <table className="w-full min-w-[12rem] table-fixed border-collapse border border-slate-500 text-[12px] leading-tight md:text-[13px]">
                    <colgroup>
                      <col style={{ width: "34%" }} />
                      <col style={{ width: "28%" }} />
                      <col style={{ width: "38%" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-200">
                        {PERSONNEL_TABLE_FIELDS.map((col) => (
                          <th
                            key={col.field}
                            className="border border-slate-500 px-1 py-0.5 text-center text-[12px] font-bold text-slate-900 md:px-1.5 md:py-0.5 md:text-[13px]"
                          >
                            {col.colAria}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: rowCount }, (_, localRi) => {
                        const globalRi = baseOffset + localRi;
                        return (
                          <tr
                            key={globalRi}
                            className="bg-white even:bg-slate-50/80"
                          >
                            {PERSONNEL_TABLE_FIELDS.map((f) =>
                              renderFieldCell(globalRi, f)
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );

                return (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
                    <div className="flex min-h-0 flex-1 flex-row items-stretch">
                      <div className="min-h-0 min-w-0 flex-1 overflow-hidden px-0.5 py-0.5 sm:px-1">
                        {panelTable(0, rowsPerPanel)}
                      </div>
                      <div
                        className="hidden min-h-0 shrink-0 select-none flex-col items-center justify-center self-stretch border-x border-slate-200 bg-slate-50 px-1.5 text-center text-[11px] font-bold leading-none text-slate-400 sm:flex"
                        aria-hidden
                      >
                        ||
                      </div>
                      <div className="min-h-0 min-w-0 flex-1 overflow-hidden overflow-x-auto px-0.5 py-0.5 sm:px-1">
                        {panelTable(rowsPerPanel, rowsPerPanel)}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : mainView === "accountList" && canManageAccounts ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-0.5 md:px-1">
                <h2 className="min-w-0 flex-1 text-center text-sm font-bold text-slate-800 md:text-base">
                  ID {"\uBAA9\uB85D"}
                </h2>
                <button
                  type="button"
                  onClick={goToTimesheetView}
                  className="shrink-0 rounded-md border border-teal-600 bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 md:text-sm"
                >
                  {"\uACF5\uC218\uD45C"}
                </button>
              </div>
              <div className="overflow-x-auto rounded border border-slate-300 bg-white shadow-sm">
                <table className="w-full min-w-[44rem] table-fixed border-collapse border border-slate-400 text-[11px] md:text-sm">
                  <thead>
                    <tr className="bg-slate-200">
                      <th className="w-[18%] border border-slate-400 px-2 py-1.5 text-center font-bold text-slate-900">
                        ID
                      </th>
                      <th className="w-[18%] border border-slate-400 px-2 py-1.5 text-center font-bold text-slate-900">
                        PASSWORD
                      </th>
                      <th className="w-[20%] border border-slate-400 px-2 py-1.5 text-center font-bold text-slate-900">
                        USER
                      </th>
                      <th className="w-[22%] border border-slate-400 px-2 py-1.5 text-center font-bold text-slate-900">
                        {"\uAD8C\uD55C"}
                      </th>
                      <th className="w-[12%] border border-slate-400 px-2 py-1.5 text-center font-bold text-slate-900">
                        {"\uC218\uC815/\uC0AD\uC81C"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleExtraAdminRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="border border-slate-400 px-3 py-6 text-center text-slate-600"
                        >
                          {
                            "\uB4F1\uB85D\uB41C \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."
                          }
                        </td>
                      </tr>
                    ) : (
                      visibleExtraAdminRows.map(({ row, index }) => {
                        const isEditing = editingExtraAccountIndex === index;
                        const busyElsewhere =
                          editingExtraAccountIndex != null &&
                          editingExtraAccountIndex !== index;
                        return (
                          <tr
                            key={`extra-admin-row-${index}`}
                            className="bg-white even:bg-slate-50/80"
                          >
                            {isEditing ? (
                              <>
                                <td className="border border-slate-400 px-1.5 py-1 align-middle">
                                  <input
                                    type="text"
                                    autoComplete="off"
                                    value={editExtraDraft.id}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                      setEditExtraDraft((d) => ({
                                        ...d,
                                        id: e.target.value,
                                      }))
                                    }
                                    className="box-border w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px] tabular-nums outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-400/70 md:text-sm"
                                  />
                                </td>
                                <td className="border border-slate-400 px-1.5 py-1 align-middle">
                                  <input
                                    type="text"
                                    autoComplete="off"
                                    value={editExtraDraft.password}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                      setEditExtraDraft((d) => ({
                                        ...d,
                                        password: e.target.value,
                                      }))
                                    }
                                    className="box-border w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px] tabular-nums outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-400/70 md:text-sm"
                                  />
                                </td>
                                <td className="border border-slate-400 px-1.5 py-1 align-middle">
                                  <input
                                    type="text"
                                    autoComplete="off"
                                    value={editExtraDraft.user}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                      setEditExtraDraft((d) => ({
                                        ...d,
                                        user: e.target.value,
                                      }))
                                    }
                                    className="box-border w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-400/70 md:text-sm"
                                  />
                                </td>
                                <td className="border border-slate-400 px-1.5 py-1 align-middle">
                                  <ExtraAdminRoleFieldset
                                    name={`edit-extra-admin-role-${index}`}
                                    value={editExtraDraft.role}
                                    onChange={(role) =>
                                      setEditExtraDraft((d) => ({ ...d, role }))
                                    }
                                  />
                                </td>
                                <td className="border border-slate-400 px-1 py-1 align-middle text-center">
                                  <div className="flex flex-wrap items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => saveEditExtraAccount()}
                                      className="rounded border border-teal-600 bg-teal-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm hover:bg-teal-700 md:text-xs"
                                    >
                                      {"\uC800\uC7A5"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => cancelEditExtraAccount()}
                                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-800 hover:bg-slate-50 md:text-xs"
                                    >
                                      {"\uCDE8\uC18C"}
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="border border-slate-400 px-2 py-1.5 font-mono tabular-nums">
                                  {row.id}
                                </td>
                                <td className="border border-slate-400 px-2 py-1.5 font-mono tabular-nums">
                                  {row.password}
                                </td>
                                <td className="border border-slate-400 px-2 py-1.5 text-left">
                                  {row.user.trim() === ""
                                    ? "\u00A0"
                                    : row.user}
                                </td>
                                <td className="border border-slate-400 px-2 py-1.5 text-center text-[10px] text-slate-800 md:text-xs">
                                  {
                                    EXTRA_ADMIN_ROLE_LABELS[
                                      normalizeExtraAdminRole(row.role)
                                    ]
                                  }
                                </td>
                                <td className="border border-slate-400 px-1 py-1.5 text-center align-middle">
                                  <button
                                    type="button"
                                    disabled={busyElsewhere}
                                    onClick={(e) =>
                                      openAccountListRowMenu(e, index)
                                    }
                                    className="rounded border border-slate-400 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-800 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 md:text-xs"
                                  >
                                    {"[\uC218\uC815/\uC0AD\uC81C]"}
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-0.5 md:gap-x-3">
                <h2 className="min-w-0 flex-1 text-center text-sm font-bold text-slate-800 md:text-base">
                  {tableTitle}
                </h2>
                {canShowProjectTimesheet ? (
                  <div className="flex w-full shrink-0 items-center justify-center gap-1 sm:w-auto sm:justify-end md:max-w-[48%]">
                    <button
                      type="button"
                      onClick={copyTimesheetLayoutStructure}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold shadow-sm md:text-xs ${
                        layoutCopyOkFlash
                          ? "border-teal-600 bg-teal-50 text-teal-900 hover:bg-teal-100"
                          : "border-slate-400 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      {layoutCopyOkFlash ? "\u2713 " : ""}
                      {"\uBCF5\uC0AC"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        !layoutClipboardReady || activeTimesheetGridKey == null
                      }
                      onClick={openLayoutPasteConfirm}
                      className="rounded-md border border-slate-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 md:text-xs"
                    >
                      {"\uBD99\uC5EC\uB123\uAE30"}
                    </button>
                  </div>
                ) : null}
              </div>

          {canShowProjectTimesheet ? (
            <div className="w-full min-w-0 overflow-x-auto">
              <table
                className="w-full min-w-[720px] table-fixed border-collapse border border-slate-400 bg-white text-[10px] leading-tight md:text-[11px]"
              >
                <colgroup>
                  <col style={{ width: `${COL_DAY_PCT}%` }} />
                  {Array.from({ length: WORKER_SLOT_COUNT }, (_, i) => (
                    <col key={i} style={{ width: `${COL_WORKER_PCT}%` }} />
                  ))}
                  <col style={{ width: `${COL_SUM_PCT}%` }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-100">
                    <th
                      rowSpan={2}
                      className="border border-slate-400 bg-slate-200 px-0.5 py-1 text-center font-bold text-slate-800"
                    >
                      {"\uC77C"}
                    </th>
                    {companyHeaderGroups.map((g, gi) => {
                      const n = companyHeaderGroups.length;
                      const canShiftRight =
                        gi < n - 1 &&
                        activeCompanyWorkerSlotCounts[gi + 1] > 1;
                      const canShiftLeft =
                        gi < n - 1 &&
                        activeCompanyWorkerSlotCounts[gi] > 1;
                      return (
                        <th
                          key={g.name}
                          colSpan={g.slots}
                          className={`border border-slate-400 p-0 text-center text-[11px] md:text-xs ${COMPANY_GROUP_TONES[g.tone].header} ${
                            gi > 0 ? "border-l-2 border-l-slate-500" : ""
                          }`}
                        >
                          <div className="flex min-h-[1.75rem] w-full items-stretch">
                            <button
                              type="button"
                              disabled={!canShiftLeft}
                              onClick={(e) => {
                                e.stopPropagation();
                                shiftSlotsToRightNeighbor(gi);
                              }}
                              className="shrink-0 basis-6 bg-black/[0.05] py-1 text-[11px] font-semibold leading-none text-slate-700 hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-25 md:basis-7 md:text-xs"
                              aria-label={`${g.name} \uC5F4 \uC88C\uCE21 \uACBD\uACC4`}
                            >
                              {"\u2190"}
                            </button>
                            <span className="flex min-w-0 flex-1 items-center justify-center px-0.5 py-1 font-bold">
                              {g.name}
                            </span>
                            <button
                              type="button"
                              disabled={!canShiftRight}
                              onClick={(e) => {
                                e.stopPropagation();
                                shiftSlotsFromRightNeighbor(gi);
                              }}
                              className="shrink-0 basis-6 bg-black/[0.05] py-1 text-[11px] font-semibold leading-none text-slate-700 hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-25 md:basis-7 md:text-xs"
                              aria-label={`${g.name} \uC5F4 \uC6B0\uCE21 \uACBD\uACC4`}
                            >
                              {"\u2192"}
                            </button>
                          </div>
                        </th>
                      );
                    })}
                    <th
                      rowSpan={2}
                      className="border border-slate-400 bg-slate-200 px-0.5 py-1 text-center font-bold text-slate-800"
                    >
                      {"\uD569\uACC4"}
                    </th>
                  </tr>
                  <tr>
                    {workerSlotMeta.map((m, wi) => (
                      <th
                        key={`worker-h-${wi}`}
                        className={`h-7 min-w-0 border border-slate-400 p-0 text-center font-normal md:h-7 ${COMPANY_GROUP_TONES[m.tone].worker} ${
                          m.isFirstInGroup && wi > 0
                            ? "border-l-2 border-l-slate-500"
                            : ""
                        }`}
                      >
                        {(() => {
                          const name = (
                            activeTimesheetGrid.body[
                              timesheetWorkerNameCellKey(wi)
                            ] ?? ""
                          ).trim();
                          if (name === "") {
                            return (
                              <span
                                className="box-border flex min-h-[1.75rem] w-full max-w-full items-center justify-center px-1 py-1 text-center text-[10px] font-semibold leading-snug text-slate-900 md:text-[11px] break-words"
                                aria-hidden
                              >
                                {"\u00A0"}
                              </span>
                            );
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => openWorkerRateDialog(wi)}
                              className="box-border flex min-h-[1.75rem] w-full max-w-full cursor-pointer items-center justify-center px-1 py-1 text-center text-[10px] font-semibold leading-snug text-slate-900 underline decoration-slate-400 decoration-dotted underline-offset-2 hover:bg-teal-50 hover:text-teal-900 md:text-[11px] break-words"
                              aria-label={`${name} \uAE30\uC900\u00B7\uCC28\uC775 \uB2E8\uAC00 \uC124\uC815`}
                              title={"\uAE30\uC900\u00B7\uCC28\uC775 \uB2E8\uAC00 \uC124\uC815"}
                            >
                              {name}
                            </button>
                          );
                        })()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map(({ day, isSunday }) => (
                    <tr
                      key={day}
                      className={isSunday ? "bg-orange-50/90" : "bg-white"}
                    >
                      <td
                        className={`border border-slate-400 px-0.5 py-0.5 text-center font-semibold tabular-nums ${
                          isSunday ? "bg-orange-50/95" : "bg-white"
                        }`}
                      >
                        {day}
                      </td>
                      {Array.from({ length: WORKER_SLOT_COUNT }, (_, wi) => (
                        <td
                          key={`${day}-w-${wi}`}
                          className={`relative h-7 min-w-0 border border-slate-400 p-0 align-middle md:h-7 ${
                            isSunday ? "bg-orange-50/90" : "bg-white"
                          }`}
                        >
                          <div
                            role="cell"
                            aria-readonly="true"
                            aria-label={`${day}\uC77C ${wi + 1}`}
                            className="absolute inset-0 box-border flex h-full w-full min-h-0 min-w-0 cursor-default items-center justify-center px-0.5 py-0 text-center tabular-nums text-[inherit] select-none"
                          >
                            {(() => {
                              const t = (
                                activeTimesheetGrid.body[
                                  bodyCellKey(day, wi)
                                ] ?? ""
                              ).trim();
                              return t === "" ? "\u00A0" : t;
                            })()}
                          </div>
                        </td>
                      ))}
                      <td
                        className={`h-7 min-w-0 border border-slate-400 px-0.5 py-0 text-center align-middle font-medium tabular-nums text-slate-500 md:h-7 ${
                          isSunday ? "bg-orange-50/90" : "bg-white"
                        }`}
                      >
                        {"\u00A0"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {visibleFooterLabels.map((label) => {
                    if (label === FOOTER_SALARY_LABEL) {
                      return (
                        <ComputedMoneyFooterRow
                          key={label}
                          label={label}
                          workerValues={workerSalaryTotals}
                          grandTotal={salaryFooterGrandTotal}
                          masked={!moneyFooterUnmasked}
                        />
                      );
                    }
                    if (label === FOOTER_NET_PAY_LABEL) {
                      return (
                        <ComputedMoneyFooterRow
                          key={label}
                          label={label}
                          workerValues={workerNetPayTotals}
                          grandTotal={netPayFooterGrandTotal}
                          masked={!moneyFooterUnmasked}
                        />
                      );
                    }
                    if (label === FOOTER_LN_ROW_LABEL) {
                      return (
                        <ComputedMoneyFooterRow
                          key={label}
                          label={label}
                          workerValues={workerLnTotals}
                          grandTotal={lnFooterGrandTotal}
                          masked={!moneyFooterUnmasked}
                          labelButton={
                            showAmountUnlock
                              ? {
                                  text: moneyFooterUnmasked
                                    ? "\uC7A0\uAE08"
                                    : FOOTER_LN_ROW_LABEL,
                                  onClick: toggleMoneyFooterMask,
                                  ariaLabel: moneyFooterUnmasked
                                    ? "\uAE08\uC561 \uC228\uAE30"
                                    : "\uAE08\uC561 \uBCF4\uAE30",
                                }
                              : undefined
                          }
                        />
                      );
                    }
                    return (
                      <tr key={label} className="bg-amber-50/70">
                        <td className="border border-slate-400 bg-amber-100/90 px-0.5 py-0.5 text-center font-bold text-slate-900">
                          {label}
                        </td>
                        {Array.from(
                          { length: WORKER_SLOT_COUNT },
                          (_, wi) => (
                            <td
                              key={`${label}-w-${wi}`}
                              className="h-7 min-w-0 border border-slate-400 bg-amber-50/80 px-0.5 py-0.5 text-center tabular-nums text-slate-700 md:h-7"
                            >
                              {label === FOOTER_EFFORT_LABEL
                                ? formatEffortFooterTotal(
                                    workerEffortTotals[wi]
                                  ) || "\u00A0"
                                : "\u00A0"}
                            </td>
                          )
                        )}
                        <td className="h-7 min-w-0 border border-slate-400 bg-amber-100/90 px-0.5 py-0.5 text-center align-middle font-semibold tabular-nums text-slate-800 md:h-7">
                          {label === FOOTER_EFFORT_LABEL
                            ? formatEffortFooterTotal(effortFooterGrandTotal) ||
                              "\u00A0"
                            : "\u00A0"}
                        </td>
                      </tr>
                    );
                  })}
                </tfoot>
              </table>
            </div>
          ) : canShowMonthSummary ? (
            <div className="mx-auto w-full min-w-[21rem] max-w-[min(50vw,42rem)] rounded-md border border-slate-300 bg-white shadow-md">
              <table
                key={`summary-${timesheetYear}-${timesheetMonth}`}
                className="w-full table-fixed border-collapse text-[11px] leading-snug text-slate-800 md:text-[12px]"
              >
                <colgroup>
                  <col
                    style={{ width: showAmountRows ? "44%" : "55%" }}
                  />
                  <col
                    style={{ width: showAmountRows ? "15%" : "22.5%" }}
                  />
                  <col
                    style={{ width: showAmountRows ? "15%" : "22.5%" }}
                  />
                  {showAmountRows ? (
                    <col style={{ width: "26%" }} />
                  ) : null}
                </colgroup>
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-2.5 py-2 text-left text-[11px] font-bold text-slate-800 md:text-xs">
                      {"\uD504\uB85C\uC81D\uD2B8\uBA85"}
                    </th>
                    <th className="border border-slate-300 px-2 py-2 text-center text-[11px] font-bold text-slate-800 md:text-xs">
                      {"\uC778\uC6D0"}
                    </th>
                    <th className="border border-slate-300 px-2 py-2 text-center text-[11px] font-bold text-slate-800 md:text-xs">
                      {"\uACF5\uC218"}
                    </th>
                    {showAmountRows ? (
                      <th className="border border-slate-300 px-2.5 py-2 text-right text-[11px] font-bold text-slate-800 md:text-xs">
                        L&N
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {projects.length === 0 ? (
                    <tr>
                      <td
                        colSpan={showAmountRows ? 4 : 3}
                        className="border border-slate-300 bg-white px-3 py-5 text-center text-xs text-slate-600 md:text-sm"
                      >
                        {
                          "\uB4F1\uB85D\uB41C \uD504\uB85C\uC81D\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uCD94\uAC00\uB85C \uD504\uB85C\uC81D\uD2B8\uB97C \uB4F1\uB85D\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
                        }
                      </td>
                    </tr>
                  ) : (
                    projectMonthSummaryRows.map((row) => (
                      <tr key={row.projectId} className="bg-white">
                        <td
                          className="min-w-0 truncate border border-slate-300 px-2.5 py-1.5 text-left font-medium text-slate-900"
                          title={row.name}
                        >
                          {row.name}
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-center tabular-nums text-slate-700">
                          {row.headcount === 0
                            ? `0\uBA85`
                            : `${row.headcount}\uBA85`}
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-center tabular-nums text-slate-700">
                          {formatSummaryEffortCell(row.effort)}
                        </td>
                        {showAmountRows ? (
                          <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums text-slate-700">
                            {row.profitLn == null
                              ? "-"
                              : formatMoneyAmount(row.profitLn)}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
                {projects.length > 0 ? (
                  <tfoot>
                    <tr className="bg-slate-200/90 font-bold text-slate-900">
                      <td className="border border-t-2 border-slate-300 border-t-slate-400 px-2.5 py-1.5 text-left">
                        {"\u00A0"}
                      </td>
                      <td className="border border-t-2 border-slate-300 border-t-slate-400 px-2 py-1.5 text-center tabular-nums">
                        {monthSummaryGrandTotals.headcount === 0
                          ? `0\uBA85`
                          : `${monthSummaryGrandTotals.headcount}\uBA85`}
                      </td>
                      <td className="border border-t-2 border-slate-300 border-t-slate-400 px-2 py-1.5 text-center tabular-nums">
                        {formatSummaryEffortCell(monthSummaryGrandTotals.effort)}
                      </td>
                      {showAmountRows ? (
                        <td className="border border-t-2 border-slate-300 border-t-slate-400 px-2.5 py-1.5 text-right tabular-nums">
                          {formatMoneyAmount(monthSummaryGrandTotals.profitLn)}
                        </td>
                      ) : null}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          ) : (
            <div
              role="status"
              className="mx-auto flex min-h-[12rem] max-w-lg flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/90 px-4 py-8 text-center text-slate-600 shadow-sm"
            >
              {mainHint ? (
                <>
                  <p className="text-sm font-semibold text-slate-800 md:text-base">
                    {mainHint.title}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500 md:text-sm">
                    {mainHint.detail}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  {"\uACF5\uC218\uD45C\uB97C \uC900\uBE44 \uC911\uC785\uB2C8\uB2E4."}
                </p>
              )}
            </div>
          )}
            </>
          )}
        </div>
      </main>
      {projectContextMenu != null
        ? createPortal(
            <div
              data-project-context-menu
              role="menu"
              aria-label={
                "\uD504\uB85C\uC81D\uD2B8 \uCEE8\uD14D\uC2A4\uD2B8 \uBA54\uB274"
              }
              className="fixed z-[400] min-w-[7.5rem] rounded-md border border-slate-300 bg-white py-0.5 shadow-lg"
              style={{
                left: projectContextMenu.left,
                top: projectContextMenu.top,
                width: PROJECT_CONTEXT_MENU_W,
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 md:text-sm"
                onClick={() => {
                  const pid = projectContextMenu.projectId;
                  const proj = projects.find((x) => x.id === pid);
                  setProjectContextMenu(null);
                  if (proj) {
                    setRenameDialog({ projectId: proj.id, name: proj.name });
                  }
                }}
              >
                {"\uC218\uC815"}
              </button>
            </div>,
            document.body
          )
        : null}
      {workerRateDialogTarget != null
        ? createPortal(
            <div
              className="fixed inset-0 z-[415] flex items-center justify-center bg-black/35 p-4"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) closeWorkerRateDialog();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="worker-rate-dialog-title"
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <h3
                  id="worker-rate-dialog-title"
                  className="text-sm font-bold text-slate-900"
                >
                  {"\uAE30\uC900\u00B7\uCC28\uC775 \uB2E8\uAC00"}
                </h3>
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {workerRateDialogTarget.workerName}
                </p>
                <label className="mt-3 block text-xs font-medium text-slate-700">
                  {"\uAE30\uC900"}
                  <input
                    ref={workerRateBaseInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={workerRateDraft.baseInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const v = sanitizeRateInputRaw(e.target.value);
                      setWorkerRateDraft((prev) => ({ ...prev, baseInput: v }));
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    autoComplete="off"
                    aria-label={"\uAE30\uC900 \uB2E8\uAC00"}
                  />
                </label>
                <label className="mt-3 block text-xs font-medium text-slate-700">
                  {"\uCC28\uC775"}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={workerRateDraft.spreadInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const v = sanitizeRateInputRaw(e.target.value);
                      setWorkerRateDraft((prev) => ({
                        ...prev,
                        spreadInput: v,
                      }));
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    autoComplete="off"
                    aria-label={"\uCC28\uC775 \uB2E8\uAC00"}
                  />
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeWorkerRateDialog}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 md:text-sm"
                  >
                    {"\uCDE8\uC18C"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveWorkerRateDialog}
                    className="rounded-md border border-teal-600 bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 md:text-sm"
                  >
                    {"\uC800\uC7A5"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {renameDialog != null
        ? createPortal(
            <div
              className="fixed inset-0 z-[410] flex items-center justify-center bg-black/35 p-4"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setRenameDialog(null);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-rename-title"
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <h3
                  id="project-rename-title"
                  className="text-sm font-bold text-slate-900"
                >
                  {"\uD504\uB85C\uC81D\uD2B8\uBA85 \uC218\uC815"}
                </h3>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameDialog.name}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const v = e.target.value;
                    setRenameDialog((prev) =>
                      prev ? { ...prev, name: v } : null
                    );
                  }}
                  className="mt-3 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  autoComplete="off"
                  aria-label={
                    "\uD504\uB85C\uC81D\uD2B8\uBA85 \uC218\uC815 \uC785\uB825"
                  }
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRenameDialog(null)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 md:text-sm"
                  >
                    {"\uCDE8\uC18C"}
                  </button>
                  <button
                    type="button"
                    disabled={renameDialog.name.trim() === ""}
                    onClick={() =>
                      handleSaveRename(
                        renameDialog.projectId,
                        renameDialog.name
                      )
                    }
                    className="rounded-md border border-teal-600 bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40 md:text-sm"
                  >
                    {"\uC800\uC7A5"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {personnelCellMenu != null
        ? createPortal(
            <div
              data-personnel-cell-popup
              role="menu"
              aria-label={"\uC778\uC801 \uC140 \uBA54\uB274"}
              className="fixed z-[210] min-w-[5.5rem] overflow-hidden rounded-md border border-slate-300 bg-white py-0.5 shadow-lg"
              style={{
                left: personnelCellMenu.left,
                top: personnelCellMenu.top,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 md:text-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => startPersonnelCellEdit()}
              >
                {"\uC218\uC815"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 md:text-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => requestPersonnelRowDelete()}
              >
                {"\uC0AD\uC81C"}
              </button>
            </div>,
            document.body
          )
        : null}
      {personnelDeleteConfirm != null
        ? createPortal(
            <div
              className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 p-4"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) cancelPersonnelRowDelete();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="personnel-row-delete-title"
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p
                  id="personnel-row-delete-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  {
                    "\uD574\uB2F9 \uD589\uC758 \uC815\uBCF4\uB97C \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"
                  }
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => cancelPersonnelRowDelete()}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 md:text-sm"
                  >
                    {"\uC544\uB2C8\uC624"}
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmPersonnelRowDelete()}
                    className="rounded-md border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 md:text-sm"
                  >
                    {"\uC608"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {canManageAccounts && createAccountModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[425] flex items-center justify-center bg-black/35 p-4"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  setCreateAccountModalOpen(false);
                  setCreateDraftId("");
                  setCreateDraftPassword("");
                  setCreateDraftUser("");
                  setCreateDraftRole("AMOUNT_ADMIN");
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-admin-id-title"
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <h3
                  id="create-admin-id-title"
                  className="text-sm font-bold text-slate-900"
                >
                  ID {"\uC0DD\uC131"}
                </h3>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs font-medium text-slate-700">
                    ID:
                    <input
                      type="text"
                      autoComplete="off"
                      value={createDraftId}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setCreateDraftId(e.target.value)
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-700">
                    PASSWORD:
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={createDraftPassword}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setCreateDraftPassword(e.target.value)
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-700">
                    USER:
                    <input
                      type="text"
                      autoComplete="off"
                      value={createDraftUser}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setCreateDraftUser(e.target.value)
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    />
                  </label>
                  <div>
                    <p className="text-xs font-medium text-slate-700">
                      {"\uAD8C\uD55C"}
                    </p>
                    <div className="mt-2">
                      <ExtraAdminRoleFieldset
                        name="create-extra-admin-role"
                        value={createDraftRole}
                        onChange={setCreateDraftRole}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateAccountModalOpen(false);
                      setCreateDraftId("");
                      setCreateDraftPassword("");
                      setCreateDraftUser("");
                      setCreateDraftRole("AMOUNT_ADMIN");
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 md:text-sm"
                  >
                    {"\uCDE8\uC18C"}
                  </button>
                  <button
                    type="button"
                    onClick={() => submitCreateAdminAccount()}
                    className="rounded-md border border-teal-600 bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 md:text-sm"
                  >
                    {"\uC0DD\uC131"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {canManageAccounts && accountListRowMenu != null
        ? createPortal(
            <div
              data-account-list-row-menu
              role="menu"
              aria-label={"\uACC4\uC815 \uD589 \uBA54\uB274"}
              className="fixed z-[428] min-w-[6.5rem] overflow-hidden rounded-md border border-slate-300 bg-white py-0.5 shadow-lg"
              style={{
                left: accountListRowMenu.left,
                top: accountListRowMenu.top,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 md:text-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const ix = accountListRowMenu.index;
                  setAccountListRowMenu(null);
                  startEditExtraAccount(ix);
                }}
              >
                {"\uC218\uC815"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 md:text-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const ix = accountListRowMenu.index;
                  setAccountListRowMenu(null);
                  requestDeleteExtraAccount(ix);
                }}
              >
                {"\uC0AD\uC81C"}
              </button>
            </div>,
            document.body
          )
        : null}
      {canManageAccounts && deleteExtraConfirmIndex != null
        ? createPortal(
            <div
              className="fixed inset-0 z-[430] flex items-center justify-center bg-black/35 p-4"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) cancelDeleteExtraAccount();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-extra-admin-title"
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p
                  id="delete-extra-admin-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  {"\uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => cancelDeleteExtraAccount()}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 md:text-sm"
                  >
                    {"\uC544\uB2C8\uC624"}
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmDeleteExtraAccount()}
                    className="rounded-md border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 md:text-sm"
                  >
                    {"\uC608"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {layoutPasteConfirmOpen && layoutPasteConfirmClip != null
        ? createPortal(
            <div
              className="fixed inset-0 z-[432] flex items-center justify-center bg-black/35 p-4"
              role="presentation"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) cancelLayoutPasteConfirm();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="layout-paste-confirm-title"
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p
                  id="layout-paste-confirm-title"
                  className="text-center text-sm font-semibold leading-snug text-slate-900 md:text-[15px]"
                >
                  {
                    "\uBCF5\uC0AC\uD55C \uACF5\uC218\uD45C \uAD6C\uC870\uB97C \uD604\uC7AC \uD504\uB85C\uC81D\uD2B8\uC5D0 \uBD99\uC5EC\uB123\uC73C\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"
                  }
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => cancelLayoutPasteConfirm()}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 md:text-sm"
                  >
                    {"\uC544\uB2C8\uC624"}
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmLayoutPaste()}
                    className="rounded-md border border-teal-600 bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 md:text-sm"
                  >
                    {"\uC608"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {layoutCopyToast != null
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed bottom-5 left-1/2 z-[441] max-w-[min(92vw,22rem)] -translate-x-1/2 rounded-lg border border-slate-700/80 bg-slate-900 px-4 py-2.5 text-center text-xs font-medium leading-snug text-white shadow-lg md:text-sm"
            >
              {layoutCopyToast}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
