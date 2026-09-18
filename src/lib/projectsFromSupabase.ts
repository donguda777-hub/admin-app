import { getSupabaseBrowserClient } from "./supabaseClient";

export type ProjectSource = "admin" | "worker";

/** Supabase `projects` 행 */
export type ProjectRemoteRow = {
  id: string;
  project_name: string;
  is_active: boolean;
  source?: ProjectSource | null;
  created_by?: string | null;
};

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function parseProjectSource(v: unknown): ProjectSource | null {
  if (v === "admin" || v === "worker") return v;
  return null;
}

function parseProjectRow(row: unknown): ProjectRemoteRow | null {
  if (row == null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = r.id;
  const projectName = r.project_name;
  const isActive = r.is_active;
  if (typeof id !== "string" || id.trim() === "") return null;
  if (
    typeof projectName !== "string" ||
    normalizeProjectName(projectName) === ""
  ) {
    return null;
  }
  if (typeof isActive !== "boolean") return null;
  const createdBy = r.created_by;
  return {
    id: id.trim(),
    project_name: normalizeProjectName(projectName),
    is_active: isActive,
    source: parseProjectSource(r.source),
    created_by:
      createdBy === null || createdBy === undefined
        ? null
        : typeof createdBy === "string"
          ? createdBy.trim()
          : null,
  };
}

/** 활성 프로젝트 목록 (admin·worker 출처 모두 포함) */
export async function fetchActiveProjectsFromSupabase(): Promise<
  ProjectRemoteRow[]
> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.log("[Supabase] projects skip fetch: client not configured");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, project_name, is_active, source, created_by")
      .eq("is_active", true)
      .order("project_name", { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: ProjectRemoteRow[] = [];
    for (const row of rows) {
      const parsed = parseProjectRow(row);
      if (parsed != null && parsed.is_active) out.push(parsed);
    }
    console.log("[Supabase] projects fetch ok", { count: out.length });
    return out;
  } catch (e) {
    console.error("[Supabase] projects fetch failed", e);
    return [];
  }
}

/** 프로젝트명으로 1건 조회 (is_active 무관) */
export async function findProjectByNameFromSupabase(
  rawName: string
): Promise<ProjectRemoteRow | null> {
  const project_name = normalizeProjectName(rawName);
  if (!project_name) return null;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, project_name, is_active, source, created_by")
      .eq("project_name", project_name)
      .limit(1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return null;
    return parseProjectRow(rows[0]);
  } catch (e) {
    console.error("[Supabase] projects find by name failed", e);
    return null;
  }
}

/**
 * 이름 목록에 해당하는 projects 행을 조회해 요청 이름 순서를 유지한다.
 * is_active 무관(월 목록에만 있고 비활성인 경우도 탭에 표시).
 */
export async function resolveProjectsByNamesFromSupabase(
  names: string[]
): Promise<ProjectRemoteRow[]> {
  const ordered = names
    .map((n) => normalizeProjectName(n))
    .filter((n) => n !== "");
  if (ordered.length === 0) return [];
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return [];
  try {
    const unique = [...new Set(ordered)];
    const { data, error } = await supabase
      .from("projects")
      .select("id, project_name, is_active, source, created_by")
      .in("project_name", unique);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const byName = new Map<string, ProjectRemoteRow>();
    for (const row of rows) {
      const parsed = parseProjectRow(row);
      if (parsed == null) continue;
      byName.set(parsed.project_name, parsed);
    }
    const out: ProjectRemoteRow[] = [];
    const seen = new Set<string>();
    for (const name of ordered) {
      if (seen.has(name)) continue;
      seen.add(name);
      const hit = byName.get(name);
      if (hit != null) out.push(hit);
    }
    return out;
  } catch (e) {
    console.error("[Supabase] projects resolve by names failed", e);
    return [];
  }
}

/** 관리자앱에서 프로젝트 추가 */
export async function insertProjectToSupabase(
  rawName: string
): Promise<ProjectRemoteRow | null> {
  const project_name = normalizeProjectName(rawName);
  if (!project_name) return null;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.error("[Supabase] projects insert skip: client not configured");
    return null;
  }
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        project_name,
        is_active: true,
        source: "admin",
        created_by: null,
        updated_at: now,
      })
      .select("id, project_name, is_active, source, created_by")
      .single();
    if (error) throw error;
    const parsed = parseProjectRow(data);
    if (parsed == null) {
      console.error("[Supabase] projects insert: invalid response", data);
      return null;
    }
    console.log("[Supabase] projects insert ok (admin)", parsed);
    return parsed;
  } catch (e) {
    console.error("[Supabase] projects insert failed", e);
    return null;
  }
}

export type RenameProjectWithEntriesResult =
  | { ok: true; project: ProjectRemoteRow; entriesUpdated: number }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "invalid_input"
        | "duplicate"
        | "projects_update_failed"
        | "entries_update_failed";
    };

function isUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505";
}

/**
 * 프로젝트명 수정 + 동일 project_name 공수 기록의 project_name 일괄 변경.
 * projects 갱신 후 worker_day_entries 실패 시 projects 이름을 롤백한다.
 */
export async function renameProjectNameWithWorkerEntriesInSupabase(
  projectId: string,
  oldRawName: string,
  rawNewName: string
): Promise<RenameProjectWithEntriesResult> {
  const id = projectId.trim();
  const oldName = normalizeProjectName(oldRawName);
  const newName = normalizeProjectName(rawNewName);
  if (!id || !oldName || !newName) {
    return { ok: false, reason: "invalid_input" };
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.error("[Supabase] project rename skip: client not configured");
    return { ok: false, reason: "not_configured" };
  }

  try {
    const { data: dupeRows, error: dupeErr } = await supabase
      .from("projects")
      .select("id")
      .eq("project_name", newName)
      .neq("id", id)
      .limit(1);
    if (dupeErr) throw dupeErr;
    if (Array.isArray(dupeRows) && dupeRows.length > 0) {
      return { ok: false, reason: "duplicate" };
    }

    if (oldName === newName) {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_name, is_active, source, created_by")
        .eq("id", id)
        .single();
      if (error) throw error;
      const parsed = parseProjectRow(data);
      if (parsed == null) {
        return { ok: false, reason: "projects_update_failed" };
      }
      return { ok: true, project: parsed, entriesUpdated: 0 };
    }

    const now = new Date().toISOString();
    const { data: projectData, error: projectErr } = await supabase
      .from("projects")
      .update({ project_name: newName, updated_at: now })
      .eq("id", id)
      .select("id, project_name, is_active, source, created_by")
      .single();
    if (projectErr) {
      if (isUniqueViolation(projectErr)) {
        return { ok: false, reason: "duplicate" };
      }
      throw projectErr;
    }
    const project = parseProjectRow(projectData);
    if (project == null) {
      return { ok: false, reason: "projects_update_failed" };
    }

    const { data: entryRows, error: entryErr } = await supabase
      .from("worker_day_entries")
      .update({ project_name: newName, updated_at: now })
      .eq("project_name", oldName)
      .select("id");
    if (entryErr) {
      console.error(
        "[Supabase] worker_day_entries project_name rename failed; rolling back projects",
        entryErr
      );
      const { error: rollbackErr } = await supabase
        .from("projects")
        .update({ project_name: oldName, updated_at: now })
        .eq("id", id);
      if (rollbackErr != null) {
        console.error("[Supabase] projects rename rollback failed", rollbackErr);
      }
      return { ok: false, reason: "entries_update_failed" };
    }

    const entriesUpdated = Array.isArray(entryRows) ? entryRows.length : 0;
    console.log("[Supabase] project rename ok", {
      id,
      oldName,
      newName,
      entriesUpdated,
    });
    return { ok: true, project, entriesUpdated };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, reason: "duplicate" };
    }
    console.error("[Supabase] project rename failed", e);
    return { ok: false, reason: "projects_update_failed" };
  }
}

/** 프로젝트 비활성화 (삭제 대신 is_active = false) */
export async function deactivateProjectInSupabase(
  id: string
): Promise<boolean> {
  if (!id.trim()) return false;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.error(
      "[Supabase] projects deactivate skip: client not configured"
    );
    return false;
  }
  try {
    const { error } = await supabase
      .from("projects")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
    console.log("[Supabase] projects deactivate ok", { id });
    return true;
  } catch (e) {
    console.error("[Supabase] projects deactivate failed", e);
    return false;
  }
}
