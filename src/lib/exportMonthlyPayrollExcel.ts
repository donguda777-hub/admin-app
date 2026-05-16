import * as XLSX from "xlsx";

import {
  computeMonthlyPayrollPostTax,
  type MonthlyPayrollRow,
} from "./monthlyPayrollAggregate";

const PAYROLL_EXCEL_HEADERS = [
  "NO.",
  "\uC18C\uC18D",
  "\uC774\uB984",
  "\uC804\uD654\uBC88\uD638",
  "\uC138\uC804\uAE09\uC5EC",
  "\uC138\uD6C4\uAE09\uC5EC",
  "\uCD1D\uACF5\uC218",
] as const;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** 공수표·월급여 화면과 동일한 전화번호 표시 */
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

/** 화면 총공수 표시와 동일한 규칙 */
function effortCellForExcel(total: number): string | number {
  if (!Number.isFinite(total) || Math.abs(total) < 1e-12) return "0";
  const r = Math.round(total * 10000) / 10000;
  if (Math.abs(r) < 1e-12) return "0";
  if (Number.isInteger(r)) return r;
  return Number(r.toFixed(4).replace(/\.?0+$/, "") || "0");
}

export function monthlyPayrollExcelFileName(
  year: number,
  month1Based: number
): string {
  return `${year}\uB144_${month1Based}\uC6D4_\uC6D4\uAE09\uC5EC.xlsx`;
}

/**
 * 현재 월급여 rows를 xlsx로 브라우저 다운로드한다.
 */
export function downloadMonthlyPayrollExcel(
  rows: readonly MonthlyPayrollRow[],
  year: number,
  month1Based: number
): void {
  const sheetRows: (string | number)[][] = [Array.from(PAYROLL_EXCEL_HEADERS)];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const preTax = row.totalNetPay;
    const postTax = computeMonthlyPayrollPostTax(preTax);
    const phoneDigits = digitsOnly(row.phone);
    const phoneDisplay = phoneDigits
      ? formatKoreanPhoneDisplay(phoneDigits)
      : "";

    sheetRows.push([
      i + 1,
      row.company,
      row.displayName,
      phoneDisplay,
      preTax != null && Number.isFinite(preTax) ? preTax : "",
      postTax != null && Number.isFinite(postTax) ? postTax : "",
      effortCellForExcel(row.totalEffort),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "\uC6D4\uAE09\uC5EC");
  XLSX.writeFile(wb, monthlyPayrollExcelFileName(year, month1Based));
}
