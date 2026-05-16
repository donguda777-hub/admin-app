/**
 * 공수표 업체 그룹 열 순서·표시명.
 * worker-hours-app 저장값(companyName)과 일치하도록 매핑한다.
 */
export const TIMESHEET_COMPANY_GROUP_NAMES = [
  "L&N",
  "L-LINE",
  "\uBBFC\uC601",
  "\uAC1C\uC778",
] as const;

export type TimesheetCompanyGroupName =
  (typeof TIMESHEET_COMPANY_GROUP_NAMES)[number];

function normalizeCompanyInput(raw: string): string {
  return raw.trim().normalize("NFKC").replace(/\s+/g, " ");
}

/**
 * workers / worker_day_entries 의 company_name → 공수표 그룹 인덱스(0..3).
 * 알 수 없는 문자열·빈 값은 null (기존 슬롯 배치로 fallback).
 */
export function mapStoredCompanyToTimesheetGroupIndex(
  raw: string | null | undefined
): number | null {
  if (raw == null) return null;
  const t = normalizeCompanyInput(String(raw));
  if (!t) return null;
  for (let i = 0; i < TIMESHEET_COMPANY_GROUP_NAMES.length; i++) {
    if (t === TIMESHEET_COMPANY_GROUP_NAMES[i]) return i;
  }
  if (t === "\uAC1C\uC778\uC0AC\uC5C5\uC790") return 3;
  return null;
}

/** 업체별 작업자 열 구간 [start, end) */
export function companyWorkerSlotRanges(
  counts: readonly number[]
): ReadonlyArray<{ start: number; end: number }> {
  let start = 0;
  return counts.map((n) => {
    const end = start + Math.max(0, Math.trunc(n));
    const r = { start, end };
    start = end;
    return r;
  });
}
