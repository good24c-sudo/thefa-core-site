# THE FA Core Google 간편 로그인 준비 결과

관측일: 2026-11-20, 한국시간. 프로젝트: P02_더파개발실.

## 결론

기존 Supabase `custom:google` 연결을 재사용하는 Google 가입·로그인 후보를 구현했습니다. Google 가입에는 별도 THE FA 확인메일이나 비밀번호 입력을 요구하지 않습니다. 전체 코드 시험은 262/262 PASS입니다. 실제 브라우저에서는 기존 Google client로 계정 선택 화면까지 도달했습니다.

상태는 **ISOLATED_CANDIDATE_PREPARED_NOT_DEPLOYED**입니다. 실제 Google 계정 선택 → 고객 작업공간까지의 운영 검증은 아직 수행하지 않았습니다. 이 문서는 운영 완료, Core writer 승계, 게시 승인 또는 terminal receipt를 대신하지 않습니다.

## 대표님 요청과 적용 범위

> 구글 로그인 이전에 실패 해서 일단 뺀건데 이번에 제대로 구글 로그인 연동 할 수 있어? 기존 고객은 내 이메일 밖에 없어 구지 보존 안해도되 기존 로그인 연동 제대로 더파코어 전용으로 사용 할 수 있음 사용 하도록 하자 그리고 이메일 인증 별도로 하지 말고 기존에 다른 애들도 구글로그인 간편하게 할 수 있도록 준비해봐

이번 구현은 Google 계정 선택만으로 가입·로그인을 이어가는 경로입니다. 기존 이메일 계정의 삭제나 대규모 이전은 필요하지 않았습니다. 같은 Supabase UUID라면 기존 고객 식별값·작업공간·무료 사용량을 유지합니다. 다른 UUID는 별도 고객으로 구분합니다.

## 진행 상태와 방 상태

| 구분 | 상태 |
|---|---|
| 현행 배포 원본 확인 | Vercel 배포 소스 165개와 4070 R7 원본 일치 확인 |
| 실제 수정 대상 원본 대조 | Git 기준 원본과 R7 수정 대상 9/9 SHA-256 일치 |
| 격리 코드 구현 | 완료 |
| 전체 코드 시험 | 262/262 PASS, 실패·skip 0 |
| 개발 PC 후보 시험 | 핵심 시험 21/21 PASS, 실패·skip 0 |
| 독립 읽기 검토 | critical/high 결함 미발견, 모의 DB 통합 시험 PASS |
| 브라우저 Google 연결 | 계정 선택 화면 도달, 기본 identity scope만 확인 |
| 최신 화면 보존 후보 | 4070 별도 폴더에 생성, 원본 재검증 완료 |
| Supabase/Vercel 운영 설정 변경 | 미수행 |
| 운영 배포·실계정 E2E | 미수행 |
| 현재 채팅의 역할 | P02 조사·격리 구현·QA, 공식 writer 승계 없음 |

공식 고객 workstream의 조회된 writer는 P04:00_v25:CODEX:THEFA:CUSTOMER_LAUNCH_R38 / fence 1입니다. 이를 변경하거나 그 신분으로 작업했다고 주장하지 않았습니다. 기존 LOCAL_PASS 세션이나 과거 소비된 게시 승인을 이번 후보에 재사용하지 않았습니다.

## 된 것

### 1. 기존 Google 연결 재사용

Supabase의 기본 `google` 항목은 꺼져 있지만 별도로 등록된 **`custom:google` OIDC provider는 켜져 있습니다**. 기존 issuer는 `https://accounts.google.com`, upstream callback은 아래 주소입니다.

```text
https://cgrppxfdurpzzfvkmfte.supabase.co/auth/v1/callback
```

실제 브라우저 요청에서 기존 client와 위 callback, `openid email profile` scope를 확인했습니다. Google 계정 선택 화면까지 열렸습니다. client secret은 읽거나 복사하지 않았으며, 이 단계는 secret의 유효성이나 최종 로그인 성공을 증명하지 않습니다.

### 2. 더파코어 고객 세션까지 연결하는 코드

흐름은 `POST /auth/start` → Supabase `/auth/v1/authorize?provider=custom:google` → Google → Supabase → **`GET /auth/google/callback`** → 기존 고객 작업공간입니다.

- Google 요청마다 S256 PKCE를 만들고 verifier를 10분짜리 암호화 HttpOnly 쿠키에 보관합니다.
- callback에서 code를 서버에서 교환하고, 다시 Supabase `/user`로 신원을 확인합니다.
- 확인된 이메일·비익명 사용자·UUID·`custom:google` identity의 사용자 연결을 검사합니다.
- 사용자 편집 가능한 profile metadata를 인증 근거로 사용하지 않습니다.
- 기존 고객 세션 쿠키를 발급하고 작업공간으로 이동합니다.
- Google 경로에서는 `/signup`, `/resend`, `/recover` 같은 메일 발송 경로를 호출하지 않습니다.
- 비밀번호 재설정에 사용하는 `/login?code=`와 Google callback을 분리했습니다.
- 오래된 Preview용 THE FA ID 분기가 새 고객 인증을 가로채지 않도록 수정했습니다.
- 취소·만료·잘못된 code는 토큰이나 공급사 오류 원문 없이 로그인 화면으로 돌아갑니다.

Google 기본 로그인 권한만 요청합니다. Drive·GitHub 등 추가 서비스 권한은 이번 간편 로그인에 포함되지 않습니다.

### 3. 고객 화면

로그인과 회원가입 화면에서 Google 버튼을 우선 표시하고, Google 계정으로 가입과 로그인을 한 번에 진행한다는 안내를 표시합니다. 별도 비밀번호나 확인메일이 필요 없다는 설명은 **Google 방식에 적용**됩니다. 기존 이메일 로그인은 보조 방식으로 남아 있으며 이메일 직접 가입의 확인 절차는 변경하지 않았습니다.

### 4. 최신 운영 화면 보존

기준 배포는 `dpl_EspEhBB2qc1a4MmJrM9F4AiswbrM`입니다. 원본 위치는 다음과 같습니다.

```text
D:\THE_FA_DEV\isolated\P02_CUSTOMER_WORKSPACE_MODES_R7_20261119\site
```

이 배포의 165개 소스만 허용 목록으로 복제했습니다. 인증 변경분을 적용하면서 로그인 JS 외의 고객 UI 파일 68개를 그대로 보존했습니다. R7 `vercel.json`의 기존 화면 경로와 보안 헤더도 유지하고 callback rewrite 한 개만 추가했습니다. 이전 34개 파일용 assembler로 운영 화면을 다시 조립하지 않았습니다.

격리 후보 위치:

```text
D:\THE_FA_DEV\isolated\P02_CORE_GOOGLE_LOGIN_20261120_CANDIDATE\site
```

후보 준비 영수증은 같은 상위 폴더의 `CANDIDATE_PREPARATION_RECEIPT.json`입니다. 이는 파일 준비 증거이며 게시 승인 영수증은 아닙니다.

## 남은 것과 문제

### 운영 활성화에 필요한 정확한 설정

| 위치 | 필요한 값 | 현재 상태 |
|---|---|---|
| Supabase Redirect URLs | `https://thefacore.com/auth/google/callback` 추가 | 기존 목록에는 Core `/login`만 있음; 추가 미수행 |
| Vercel 고객 인증 설정 | `CUSTOMER_GOOGLE_AUTH_PROVIDER=custom:google` | 후보는 이 값이 있어야 Google을 표시; 운영 설정 미수행 |
| 코드 배포 | 최신 R7 기반 후보의 인증 변경분 | 정식 게시 binding 미확인 |
| Google 일반 고객 검증 | 대표 계정 외 일반 Google 계정의 가입·로그인 | 미수행 |

기존 Supabase Site URL은 다른 THE FA 서비스가 사용하는 주소이므로 Core 도메인으로 통째로 변경할 필요가 없습니다. exact Core callback을 허용 목록에 추가하는 방식입니다. Google client secret을 THE FA 서버로 복사하거나 전체 프로젝트의 이메일 확인을 꺼야 하는 구조도 아닙니다.

### 실제 배포를 아직 수행하지 않은 이유

현재 PC에는 정상 게시 승인을 소비하는 실행판이 설치돼 있습니다. 그러나 **이번 Google 후보에 연결된 새로운 Work Unit·현재 writer binding·최종 게시 승인은 확인되지 않았습니다**. 기존 고객 Scheduler 등록의 parent는 Fresh GitHub보다 오래됐고, 예전 세션은 이번 작업으로 재사용할 수 없습니다.

이는 대표님의 Google 로그인 지시를 다시 받아야 한다는 뜻이 아닙니다. 사용자 지침 5·7·13항에 따라 현재 공식 실행 경로가 이번 후보를 정상 접수해야 합니다. 임의 승인 JSON 작성, 기존 fence 탈취, 예전 grant 복제, 직접 우회 게시를 하지 않았습니다. 게시 도구가 작업을 실행했다가 실패한 상태도 아닙니다. 현재 단계는 새 후보의 정식 게시 연결 **EVIDENCE_GAP**입니다.

## 검증

- 전체 시험: `npm test`, Node v24.22.3, 262개 PASS, 0 FAIL, 0 SKIP.
- Google 신규 시험 22개를 포함합니다. Google auth 12, UI 4, workspace 2, config 2, dispatch 2입니다.
- 신규 Google callback으로 실제 application/runtime 경로를 통과시키고 모의 DB에서 작업공간·대화·사용량을 확인했습니다.
- 다른 UUID의 대화 조회·변경을 차단했습니다.
- 위조·만료·중복 쿠키, code 재사용, 잘못된 provider, 다른 origin, 중복 query, 신원 불일치, 과도한 scope, 공급사 오류를 검증했습니다.
- 기존 이메일 로그인·비밀번호 재설정 시험도 통과했습니다.
- 실제 4070 후보에서 Node v24.22.1로 핵심 21개 시험이 통과했습니다. 처음에는 새 폴더의 npm 의존성이 없어 import에 실패했으며, 고정 lockfile의 의존성을 후보 폴더에 설치한 후 통과했습니다. 첫 실패 출력도 PC에 보존했습니다.
- 브라우저 확인은 Google 계정 선택 화면까지입니다. 실제 사용자 토큰 교환·운영 DB·새 고객 온보딩 완료 시험과 구분합니다.

실계정 QA에서는 Google 계정 선택 후 callback·작업공간·로그아웃·재로그인, 일반 외부 계정 가입, 동의 화면의 표시명과 공개 대상, 실제 세션 쿠키 길이를 확인해야 합니다. 현재 세션은 기존 정책과 같은 최대 1시간이며 자동 갱신 기능은 이번 변경에 포함하지 않았습니다. Google 화면에는 현재 Supabase 도메인이 표시되어 더파코어 브랜드 표시 정리는 별도 확인 대상입니다.

## 보호와 원복

- 운영 코드·DB·고객 계정·OAuth secret·Billing·Core writer/fence는 변경하지 않았습니다.
- 원본 R7 파일 165개를 후보 생성 후 다시 읽어 변경 없음을 확인했습니다.
- 비밀값이나 고객 데이터를 후보에 복사하지 않았습니다.
- 활성화 이후 Google 경로를 보류해야 한다면 새 provider 환경변수를 제거하고 해당 런타임을 재배포하면 기존 이메일 방식이 유지됩니다. 정상 이전 배포를 원복 대상으로 보존해야 합니다.
- 실제 배포 직전에는 배포 원본·Fresh GitHub HEAD·CURRENT·writer/fence·허용 경로·QA 결과 지문을 다시 대조해야 합니다.

## 다음 단계와 대표님 할 일

다음 단계는 준비된 후보를 정상 실행 경로에 접수하고, exact callback과 non-secret provider 설정을 적용한 뒤, 실제 도메인에서 Google 사용자 시험을 마치는 것입니다. 후보 생성 스크립트는 배포나 설정 변경을 수행하지 않으며 이미 생성된 후보가 있으면 재실행을 거부합니다.

대표님께 코드나 client secret을 다시 보내 달라고 요청할 필요는 없습니다. 실제 계정 선택·동의가 필요한 마지막 시험에서만 해당 브라우저 화면을 안내하면 됩니다. 아직 운영에 적용되지 않았으므로 일반 고객에게 Google 가입을 안내하는 단계는 아닙니다.

## 근거 파일과 공식 문서

- `QA_SUMMARY.json`, `QA_TEST_OUTPUT.txt`: 코드 시험 범위와 실제 브라우저 확인 범위.
- `R7_DEPLOYMENT_SOURCE_FILES.json`: 기준 배포의 정확한 소스 파일 목록.
- `AUTH_DELTA_PACKAGE.json`: 원본/후보 지문 및 적용할 변경 파일.
- `prepare_r7_candidate.py`: 원본 검증 후 별도 후보만 만드는 스크립트.
- [Supabase custom OAuth/OIDC provider](https://supabase.com/docs/guides/auth/custom-oauth-providers)
- [Supabase PKCE 흐름](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

대표 결정 반영: 기존 설정 재사용, Google 간편 가입·로그인 우선, Google 방식의 별도 이메일 인증 없음, 불필요한 계정 이전 작업 없음.
