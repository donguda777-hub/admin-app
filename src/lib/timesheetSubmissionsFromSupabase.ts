import { getSupabaseBrowserClient } from "./supabaseClient";

const TIMESHEET_BUCKET = "timesheet-submissions";

export type TimesheetSubmissionRecord = {
  id: string;
  workerName: string;
  workerPhone: string;
  totalGongsu: number;
  imagePath: string;
  createdAt: string;
};

function asId(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

function asText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function asGongsu(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.trim().replace(/,/g, "."))
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** submit_month가 선택한 연월과 같은 제출만 조회한다. 실패 시 null. */
export async function fetchTimesheetSubmissionsForMonth(
  monthKey: string
): Promise<TimesheetSubmissionRecord[] | null> {
  const key = monthKey.trim();
  if (!/^\d{4}-\d{2}$/.test(key)) return [];
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  try {
    const pageSize = 1000;
    const out: TimesheetSubmissionRecord[] = [];
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("timesheet_submissions")
        .select(
          "id, worker_name, worker_phone, submit_month, total_gongsu, image_path, created_at"
        )
        .eq("submit_month", key)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        if (row == null || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const id = asId(r.id);
        const total = asGongsu(r.total_gongsu);
        if (id == null || total == null) continue;
        out.push({
          id,
          workerName: asText(r.worker_name),
          workerPhone: asText(r.worker_phone),
          totalGongsu: total,
          imagePath: asText(r.image_path),
          createdAt: asText(r.created_at),
        });
      }
      if (rows.length < pageSize) break;
    }
    return out;
  } catch (e) {
    console.error("[Supabase] timesheet_submissions fetch failed", e);
    return null;
  }
}

/** private bucket 이미지를 조회용 URL로 연다. 원본은 변경하지 않는다. */
export async function openTimesheetSubmissionImage(
  imagePath: string
): Promise<{ url: string; revoke: boolean } | null> {
  const path = imagePath.trim();
  if (!path) return null;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  try {
    const { data, error } = await supabase.storage
      .from(TIMESHEET_BUCKET)
      .createSignedUrl(path, 60 * 30);
    if (error == null && data?.signedUrl) {
      return { url: data.signedUrl, revoke: false };
    }
  } catch (e) {
    console.error("[Supabase] timesheet signed url failed", e);
  }
  try {
    const { data, error } = await supabase.storage
      .from(TIMESHEET_BUCKET)
      .download(path);
    if (error != null || data == null) return null;
    return { url: URL.createObjectURL(data), revoke: true };
  } catch (e) {
    console.error("[Supabase] timesheet image download failed", e);
    return null;
  }
}
