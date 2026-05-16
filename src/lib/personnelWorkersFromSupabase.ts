import {
  PERSONNEL_DEFAULT_ROW_COUNT,
  PERSONNEL_GRADE_LABELS,
  createEmptyPersonnelRows,
  type PersonnelRowPersist,
} from "../adminPersist";
import { getSupabaseBrowserClient } from "./supabaseClient";

/** Supabase `workers` 행(인적사항 표시용) */
export type WorkerRemoteRow = {
  worker_id: string;
  worker_name: string;
  region: string | null;
  phone: string | null;
  company_name: string | null;
  skill_level: string | null;
  created_at?: string | null;
};

export type PersonnelRowDisplayMeta =
  | { source: "local"; localIndex: number }
  | { source: "remote"; workerId: string };

const PERSONNEL_GRADE_SET = new Set<string>(PERSONNEL_GRADE_LABELS);

/** 이름 + 전화번호 숫자 뒤 4자리 (worker-hours-app과 동일) */
export function buildWorkerId(name: string, phone: string): string {
  const trimmed = name.trim();
  const digits = phone.replace(/\D/g, "");
  const last4 =
    digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, "0");
  return `${trimmed}${last4}`;
}

/** localStorage 인적사항 행에서 worker_id 추정 */
export function personnelRowWorkerId(row: PersonnelRowPersist): string | null {
  const name = row.name.trim();
  if (!name) return null;
  const digits = row.phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return buildWorkerId(name, row.phone);
}

function padLocalRows(
  localRows: PersonnelRowPersist[],
  rowCount: number
): PersonnelRowPersist[] {
  if (localRows.length >= rowCount) return localRows.slice(0, rowCount);
  return [
    ...localRows,
    ...createEmptyPersonnelRows(rowCount - localRows.length),
  ];
}

function remoteWorkerToPersonnelRow(w: WorkerRemoteRow): PersonnelRowPersist {
  return {
    name: (w.worker_name ?? "").trim(),
    region: (w.region ?? "").trim(),
    phone: w.phone ?? "",
  };
}

/**
 * Supabase workers(상단·조회순) + localStorage 행을 합쳐 표시용 80행을 만든다.
 * localStorage에 이미 있는 worker_id와 같은 원격 작업자는 표시하지 않는다.
 */
export function mergePersonnelGradeForDisplay(
  localRows: PersonnelRowPersist[],
  remoteWorkers: readonly WorkerRemoteRow[],
  rowCount: number = PERSONNEL_DEFAULT_ROW_COUNT
): { rows: PersonnelRowPersist[]; meta: PersonnelRowDisplayMeta[] } {
  const local = padLocalRows(localRows, rowCount);

  const localWorkerIds = new Set<string>();
  for (const r of local) {
    const id = personnelRowWorkerId(r);
    if (id) localWorkerIds.add(id);
  }

  const remoteFiltered = remoteWorkers.filter((w) => {
    const id = (w.worker_id ?? "").trim();
    return id !== "" && !localWorkerIds.has(id);
  });

  const rows: PersonnelRowPersist[] = [];
  const meta: PersonnelRowDisplayMeta[] = [];

  for (const w of remoteFiltered) {
    if (rows.length >= rowCount) break;
    rows.push(remoteWorkerToPersonnelRow(w));
    meta.push({ source: "remote", workerId: w.worker_id.trim() });
  }

  for (let localIndex = 0; localIndex < local.length; localIndex++) {
    if (rows.length >= rowCount) break;
    rows.push(local[localIndex]!);
    meta.push({ source: "local", localIndex });
  }

  while (rows.length < rowCount) {
    const localIndex = rows.length;
    rows.push({ name: "", region: "", phone: "" });
    meta.push({ source: "local", localIndex });
  }

  return { rows, meta };
}

/** `worker_id`로 전체 등급 버킷에서 `workers` 행을 찾는다(인적사항 소속 표시용). */
export function findWorkerRemoteById(
  byGrade: Record<string, WorkerRemoteRow[]> | null,
  workerId: string
): WorkerRemoteRow | null {
  const id = workerId.trim();
  if (!id || byGrade == null) return null;
  for (const rows of Object.values(byGrade)) {
    const hit = rows.find((w) => (w.worker_id ?? "").trim() === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * 인적사항 표의 소속: Supabase `workers.company_name` 최신값만 사용.
 * (공수표·worker_day_entries의 과거 업체명과 무관)
 */
export function personnelRowCompanyDisplay(
  row: PersonnelRowPersist,
  meta: PersonnelRowDisplayMeta | undefined,
  byGrade: Record<string, WorkerRemoteRow[]> | null
): string {
  if (meta == null || byGrade == null) return "";
  if (meta.source === "remote") {
    const w = findWorkerRemoteById(byGrade, meta.workerId);
    return (w?.company_name ?? "").trim();
  }
  const wid = personnelRowWorkerId(row);
  if (!wid) return "";
  const w = findWorkerRemoteById(byGrade, wid);
  return (w?.company_name ?? "").trim();
}

export type FetchWorkersForPersonnelResult = {
  byGrade: Record<string, WorkerRemoteRow[]>;
  error: string | null;
};

/** `workers` 전체 조회 후 숙련도(등급)별로 그룹. 조회 순서는 created_at 오름차순. */
export async function fetchWorkersGroupedByPersonnelGrade(): Promise<FetchWorkersForPersonnelResult> {
  const emptyByGrade = (): Record<string, WorkerRemoteRow[]> => {
    const out: Record<string, WorkerRemoteRow[]> = {};
    for (const label of PERSONNEL_GRADE_LABELS) {
      out[label] = [];
    }
    return out;
  };

  try {
    const supabase = getSupabaseBrowserClient();
    if (supabase == null) {
      console.error(
        "[Supabase] workers personnel skip: client not configured (check .env.local)"
      );
      return { byGrade: emptyByGrade(), error: "not_configured" };
    }

    const { data, error } = await supabase
      .from("workers")
      .select(
        "worker_id, worker_name, region, phone, company_name, skill_level, created_at"
      )
      .order("created_at", { ascending: true });

    if (error != null) {
      console.error("[Supabase] workers personnel select failed", error);
      return { byGrade: emptyByGrade(), error: error.message };
    }

    const byGrade = emptyByGrade();
    const list = Array.isArray(data) ? data : [];

    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const workerId = typeof o.worker_id === "string" ? o.worker_id.trim() : "";
      const workerName =
        typeof o.worker_name === "string" ? o.worker_name.trim() : "";
      if (!workerId || !workerName) continue;

      const skill = typeof o.skill_level === "string" ? o.skill_level.trim() : "";
      if (!PERSONNEL_GRADE_SET.has(skill)) continue;

      const row: WorkerRemoteRow = {
        worker_id: workerId,
        worker_name: workerName,
        region: typeof o.region === "string" ? o.region : null,
        phone: typeof o.phone === "string" ? o.phone : null,
        company_name:
          typeof o.company_name === "string" ? o.company_name : null,
        skill_level: skill,
        created_at:
          typeof o.created_at === "string" ? o.created_at : null,
      };
      byGrade[skill]!.push(row);
    }

    console.log("[Supabase] workers personnel fetch ok", {
      total: list.length,
      byGrade: Object.fromEntries(
        PERSONNEL_GRADE_LABELS.map((g) => [g, byGrade[g]!.length])
      ),
    });
    return { byGrade, error: null };
  } catch (e) {
    console.error("[Supabase] workers personnel fetch failed", e);
    return {
      byGrade: emptyByGrade(),
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}
