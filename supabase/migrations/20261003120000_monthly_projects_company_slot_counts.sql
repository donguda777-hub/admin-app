-- 월+프로젝트별 공수표 업체 칸 수.
-- 순서: L&N, 민영, 개인. 기존 행은 기본값 {16,8,6}.
-- 이월/재등록 insert는 이 컬럼을 넣지 않으므로 기본값이 적용된다.

alter table public.monthly_projects
  add column if not exists company_slot_counts integer[] not null default '{16,8,6}';

alter table public.monthly_projects
  drop constraint if exists monthly_projects_company_slot_counts_check;

alter table public.monthly_projects
  add constraint monthly_projects_company_slot_counts_check
  check (
    array_ndims(company_slot_counts) = 1
    and cardinality(company_slot_counts) = 3
    and company_slot_counts[1] is not null
    and company_slot_counts[2] is not null
    and company_slot_counts[3] is not null
    and company_slot_counts[1] >= 1
    and company_slot_counts[2] >= 1
    and company_slot_counts[3] >= 1
    and company_slot_counts[1] + company_slot_counts[2] + company_slot_counts[3] = 30
  );
