import { getSupabaseBrowserClient } from "./supabaseClient";
import {
  fetchActiveProjectsFromSupabase,
  normalizeProjectName,
} from "./projectsFromSupabase";

/** Supabase `monthly_projects.month` — `YYYY-MM` (zero-padded) */
export function formatMonthKey(year: number, month1Based: number): string {
  const y = Math.trunc(year);
  const m = Math.trunc(month1Based);
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function previousMonthKey(monthKey: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (m == null) return null;
  let year = Number.parseInt(m[1], 10);
  let month = Number.parseInt(m[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return formatMonthKey(year, month);
}

function isUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505";
}

/** 해당 월 목록이 이미 초기화되었는지 (`monthly_project_months` 행 존재) */
export async function isMonthlyProjectsMonthInitialized(
  monthKey: string
): Promise<boolean> {
  const key = monthKey.trim();
  if (!key) return false;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;
  try {
    const { data, error } = await supabase
      .from("monthly_project_months")
      .select("month")
      .eq("month", key)
      .maybeSingle();
    if (error) throw error;
    return data != null && typeof (data as { month?: unknown }).month === "string";
  } catch (e) {
    console.error("[Supabase] monthly_project_months check failed", e);
    return false;
  }
}

async function fetchMonthlyProjectNames(monthKey: string): Promise<string[]> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return [];
  try {
    const { data, error } = await supabase
      .from("monthly_projects")
      .select("project_name")
      .eq("month", monthKey)
      .order("project_name", { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      const raw = (row as { project_name?: unknown }).project_name;
      if (typeof raw !== "string") continue;
      const name = normalizeProjectName(raw);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  } catch (e) {
    console.error("[Supabase] monthly_projects fetch failed", e);
    return [];
  }
}

/**
 * 월 초기화 claim. 성공하면 true(이 호출이 최초 초기화),
 * 이미 초기화된 경우 false. 실패 시 null.
 */
async function claimMonthlyProjectsMonthInit(
  monthKey: string
): Promise<boolean | null> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  try {
    const { error } = await supabase.from("monthly_project_months").insert({
      month: monthKey,
    });
    if (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
    return true;
  } catch (e) {
    console.error("[Supabase] monthly_project_months insert failed", e);
    return null;
  }
}

async function insertMonthlyProjectNames(
  monthKey: string,
  names: string[]
): Promise<boolean> {
  if (names.length === 0) return true;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;
  const rows = names.map((project_name) => ({
    month: monthKey,
    project_name,
  }));
  try {
    const { error } = await supabase.from("monthly_projects").insert(rows);
    if (error) {
      if (isUniqueViolation(error)) {
        // 일부 중복이어도 목록은 이미 있거나 병행 삽입 — 무시하고 조회에 맡김
        console.warn(
          "[Supabase] monthly_projects insert unique conflict (ignored)",
          error
        );
        return true;
      }
      throw error;
    }
    return true;
  } catch (e) {
    console.error("[Supabase] monthly_projects bulk insert failed", e);
    return false;
  }
}

/**
 * 선택 월의 monthly_projects를 보장한다.
 * - 미초기화: 직전 월이 초기화되어 있으면 그 목록을 복사(0개여도 복사).
 * - 직전 월도 미초기화: 활성 projects 카탈로그로 최초 시드(마이그레이션용).
 * - 이미 초기화됨: 절대 재복사하지 않음(빈 목록도 유지).
 */
export async function ensureMonthlyProjectsForMonth(
  year: number,
  month1Based: number
): Promise<string[]> {
  const monthKey = formatMonthKey(year, month1Based);
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.log("[Supabase] monthly_projects skip: client not configured");
    return [];
  }

  const already = await isMonthlyProjectsMonthInitialized(monthKey);
  if (already) {
    return fetchMonthlyProjectNames(monthKey);
  }

  const claimed = await claimMonthlyProjectsMonthInit(monthKey);
  if (claimed === null) {
    return [];
  }
  if (claimed === false) {
    // 다른 요청이 먼저 초기화함
    return fetchMonthlyProjectNames(monthKey);
  }

  // 이 호출이 최초 초기화를 소유함 — 전월 복사 또는 카탈로그 시드
  // (이미 monthly_projects 행이 있으면 레거시 데이터로 보고 유지)
  const existingNames = await fetchMonthlyProjectNames(monthKey);
  if (existingNames.length > 0) {
    console.log(
      "[Supabase] monthly_projects keep existing rows on first init",
      { monthKey, count: existingNames.length }
    );
    return existingNames;
  }

  const prevKey = previousMonthKey(monthKey);
  let seedNames: string[] = [];
  if (prevKey != null && (await isMonthlyProjectsMonthInitialized(prevKey))) {
    seedNames = await fetchMonthlyProjectNames(prevKey);
    console.log("[Supabase] monthly_projects inherit from previous month", {
      monthKey,
      prevKey,
      count: seedNames.length,
    });
  } else {
    const catalog = await fetchActiveProjectsFromSupabase();
    seedNames = catalog.map((p) => p.project_name);
    console.log("[Supabase] monthly_projects seed from projects catalog", {
      monthKey,
      count: seedNames.length,
    });
  }

  await insertMonthlyProjectNames(monthKey, seedNames);
  return fetchMonthlyProjectNames(monthKey);
}

/** 해당 월 목록에 project_name 추가(중복 시 no-op 성공) */
export async function addProjectNameToMonthlyProjects(
  monthKey: string,
  rawName: string
): Promise<boolean> {
  const key = monthKey.trim();
  const project_name = normalizeProjectName(rawName);
  if (!key || !project_name) return false;

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;

  // 월이 아직 없으면 호출 측에서 ensure 후 호출하는 것이 원칙이나 방어적으로 확인
  const initialized = await isMonthlyProjectsMonthInitialized(key);
  if (!initialized) {
    console.error(
      "[Supabase] add monthly project skipped: month not initialized",
      key
    );
    return false;
  }

  try {
    const { data: existing, error: selErr } = await supabase
      .from("monthly_projects")
      .select("id")
      .eq("month", key)
      .eq("project_name", project_name)
      .limit(1);
    if (selErr) throw selErr;
    if (Array.isArray(existing) && existing.length > 0) {
      return true;
    }

    const { error } = await supabase.from("monthly_projects").insert({
      month: key,
      project_name,
    });
    if (error) {
      if (isUniqueViolation(error)) return true;
      throw error;
    }
    console.log("[Supabase] monthly_projects add ok", { key, project_name });
    return true;
  } catch (e) {
    console.error("[Supabase] monthly_projects add failed", e);
    return false;
  }
}

/**
 * 해당 월 선택 목록에서만 제거.
 * projects / worker_day_entries 는 절대 변경하지 않음.
 */
export async function removeProjectNameFromMonthlyProjects(
  monthKey: string,
  rawName: string
): Promise<boolean> {
  const key = monthKey.trim();
  const project_name = normalizeProjectName(rawName);
  if (!key || !project_name) return false;

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;

  try {
    const { error } = await supabase
      .from("monthly_projects")
      .delete()
      .eq("month", key)
      .eq("project_name", project_name);
    if (error) throw error;
    console.log("[Supabase] monthly_projects remove ok", { key, project_name });
    return true;
  } catch (e) {
    console.error("[Supabase] monthly_projects remove failed", e);
    return false;
  }
}

/** 프로젝트명 변경 시 모든 월의 monthly_projects.project_name 동기화 */
export async function renameProjectNameInMonthlyProjects(
  oldRawName: string,
  rawNewName: string
): Promise<{ ok: boolean; updated: number }> {
  const oldName = normalizeProjectName(oldRawName);
  const newName = normalizeProjectName(rawNewName);
  if (!oldName || !newName) return { ok: false, updated: 0 };
  if (oldName === newName) return { ok: true, updated: 0 };

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return { ok: false, updated: 0 };

  try {
    const { data, error } = await supabase
      .from("monthly_projects")
      .update({ project_name: newName })
      .eq("project_name", oldName)
      .select("id");
    if (error) {
      if (isUniqueViolation(error)) {
        console.error(
          "[Supabase] monthly_projects rename unique conflict",
          error
        );
        return { ok: false, updated: 0 };
      }
      throw error;
    }
    const updated = Array.isArray(data) ? data.length : 0;
    console.log("[Supabase] monthly_projects rename ok", {
      oldName,
      newName,
      updated,
    });
    return { ok: true, updated };
  } catch (e) {
    console.error("[Supabase] monthly_projects rename failed", e);
    return { ok: false, updated: 0 };
  }
}
