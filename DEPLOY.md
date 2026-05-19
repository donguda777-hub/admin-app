# admin-app 운영 배포 (Vercel)

`worker-hours-app` 은 별도 저장소/배포입니다. 이 문서는 **admin-app** 만 대상으로 합니다.

## 사전 준비 (Supabase)

1. Supabase SQL Editor 또는 CLI로 마이그레이션 적용:
   - `supabase/migrations/20260519000000_admins_table.sql`
   - (동일 내용) 저장소 루트의 `../supabase/admins-table.sql`
2. `public.admins` 테이블에 마스터 계정(`donguda`)이 있는지 확인
3. 추가 관리자는 마스터 로그인 후 **ID 목록**에서 등록 (Supabase에 저장됨)

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `VITE_SUPABASE_URL` | 예 | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 예 | Supabase **anon public** 키 (service_role 사용 금지) |

로컬: `.env.example` → `.env.local` 복사 후 값 입력.

Vercel: **Production** (필요 시 Preview도 동일) 에 위 두 변수 등록.

> Vite는 `npm run build` 시 env를 정적으로 포함합니다. Vercel에서 변수를 바꾼 뒤에는 **Redeploy** 가 필요합니다.

## Vercel 배포 절차

1. [vercel.com](https://vercel.com) → **Add New Project**
2. GitHub `admin-app` 저장소 연결 (루트 = 저장소 루트)
3. Framework Preset: **Vite** (또는 `vercel.json` 자동 인식)
4. Build Command: `npm run build` (기본값)
5. Output Directory: `dist` (기본값)
6. **Environment Variables** 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가
7. Deploy

`vercel.json` 이 SPA 새로고침용 rewrite 를 포함합니다.

## 로컬 빌드 확인

```bash
cd admin-app
cp .env.example .env.local
# .env.local 에 실제 키 입력
npm ci
npm run build
npm run preview
```

## 배포 후 로그인 검증 체크리스트

다른 PC·시크릿 창·모바일 브라우저에서 **배포 URL** 로 접속해 확인합니다.

- [ ] 로그인 화면에 Supabase 설정 오류 문구가 **없음**
- [ ] 마스터(`donguda`) ID·비밀번호로 로그인 성공
- [ ] 로그인 후 공수표 화면 정상 표시 (기능 변경 없음 확인)
- [ ] 시크릿 창에서 동일 계정 재로그인 성공
- [ ] 다른 PC(또는 다른 브라우저 프로필)에서 동일 계정 로그인 성공
- [ ] Supabase에 등록된 **추가 관리자** 계정으로도 로그인 성공
- [ ] 잘못된 비밀번호 시 «아이디 또는 비밀번호가 올바르지 않습니다» 표시
- [ ] 로그아웃 후 재로그인 가능
- [ ] (선택) ID 목록에서 계정 추가 후, 시크릿 창에서 새 계정 로그인 가능

### 실패 시 점검

| 증상 | 확인 |
|------|------|
| «서버 설정(Supabase 환경변수)이 없습니다» | Vercel env 두 개 등록 후 **Redeploy** |
| 항상 비밀번호 오류 | `admins` 마이그레이션 적용 여부, `login_id` 소문자(`donguda`) |
| 마스터만 되고 추가 계정 안 됨 | Supabase `admins` 행 존재·RLS 정책 |
| 공수표만 안 됨 | `projects` / `worker_day_entries` RLS (로그인과 별도) |

## 주의

- `localStorage` 는 **로그인 세션 ID** (`adminAppLoggedInUserId`) 만 사용합니다.
- 계정 비밀번호는 **Supabase `admins`** 에만 저장합니다.
- `localStorage.clear()` 는 앱에서 사용하지 않습니다.
