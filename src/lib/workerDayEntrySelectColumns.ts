/** 공수표·월간 조회 등 `worker_day_entries` select 목록 (한 곳에서만 정의) */
export const WORKER_DAY_ENTRY_SELECT_COLUMNS =
  "id, worker_id, worker_name, company_name, project_id, project_name, work_date, work_hours, memo, deleted_at, base_rate, profit_rate" as const;
