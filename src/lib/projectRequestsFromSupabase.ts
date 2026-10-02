import { getSupabaseBrowserClient } from "./supabaseClient";

export type PendingProjectRequest = {
  id: string;
  workerName: string;
  company: string;
  projectName: string;
  requestMonth: string;
  createdAt: string;
};

function asRequestId(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

function asText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** status가 pending인 요청만. 실패 시 null. */
export async function fetchPendingProjectRequests(): Promise<
  PendingProjectRequest[] | null
> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  try {
    const { data, error } = await supabase
      .from("project_requests")
      .select(
        "id, worker_name, company, project_name, request_month, created_at"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: PendingProjectRequest[] = [];
    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = asRequestId(r.id);
      const projectName = asText(r.project_name);
      const requestMonth = asText(r.request_month);
      if (id == null || !projectName || !requestMonth) continue;
      out.push({
        id,
        workerName: asText(r.worker_name),
        company: asText(r.company),
        projectName,
        requestMonth,
        createdAt: asText(r.created_at),
      });
    }
    return out;
  } catch (e) {
    console.error("[Supabase] project_requests pending fetch failed", e);
    return null;
  }
}

/** pending 행만 approved 또는 rejected로 닫는다. 행은 삭제하지 않는다. */
export async function markProjectRequestProcessed(
  id: string,
  status: "approved" | "rejected"
): Promise<boolean> {
  const requestId = id.trim();
  if (!requestId) return false;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;
  try {
    const { data, error } = await supabase
      .from("project_requests")
      .update({
        status,
        processed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id");
    if (error) throw error;
    return Array.isArray(data) && data.length === 1;
  } catch (e) {
    console.error("[Supabase] project_requests status update failed", e);
    return false;
  }
}

export function formatProjectRequestTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
