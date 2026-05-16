-- 기준(base_rate)·차익(profit_rate)을 프로젝트·작업자별로 worker_day_entries 행에 보관한다.
-- 공수가 기록된 행에만 존재하며, 동일 project_id+worker_id+월 범위의 모든 행에 동일 값으로 갱신한다.

alter table public.worker_day_entries
  add column if not exists base_rate bigint;

alter table public.worker_day_entries
  add column if not exists profit_rate bigint;

comment on column public.worker_day_entries.base_rate is '기준 단가(원, 정수)';
comment on column public.worker_day_entries.profit_rate is '차익 단가(원, 정수)';
