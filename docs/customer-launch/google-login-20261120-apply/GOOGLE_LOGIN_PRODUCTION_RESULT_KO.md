# THE FA Core Google 로그인 운영 적용 결과

관측: 2026년 11월 20일 15:21 KST · P02_더파개발실

## 1. 결론

**운영 사이트에 Google 로그인을 적용했고, 실제 계정으로 로그인 → 작업공간 진입 → 로그아웃 → 재로그인까지 확인했습니다.** 두 번 모두 같은 고객 계정으로 연결됐으며 별도 THE FA 이메일 인증이나 비밀번호 입력을 요구하지 않았습니다.

- 서비스: https://thefacore.com
- 로그인: https://thefacore.com/login
- 현재 브라우저에는 로그인된 작업공간을 열어 두었습니다.
- 관측 상태: `PRODUCTION_APPLIED_REAL_LOGIN_LOGOUT_RELOGIN_VERIFIED`

## 2. 진행률

근거 없는 백분율 대신 요청 단계별 결과를 기록합니다.

| 단계 | 결과 |
|---|---|
| 최신 R7 화면을 유지한 인증 후보 준비 | 완료, 이전 격리 QA 통과 |
| Supabase Core 전용 복귀 주소 추가 | 저장·새로고침 후 확인 |
| 운영 Google provider 설정 | 적용 완료 |
| 운영 배포 | 1회, READY 및 실제 도메인 연결 확인 |
| Google 실계정 로그인 | 성공 |
| 고객 작업공간 연결 | 화면 및 코드 경로로 확인 |
| 로그아웃 후 세션 종료 | authenticated:false 확인 |
| 동일 Google 계정 재로그인 | 성공, 같은 고객 식별값 확인 |
| 무료 사용량 유지 | 10/10 → 10/10 확인 |
| 대표 계정 외 신규 Google 고객 | 미검증 |

## 3. 방 상태

현재 채팅은 P02에서 이번에 명시적으로 승인된 Google 운영 적용과 실제 로그인 검증을 수행했습니다. 공용 Core의 CURRENT·writer·fence를 변경하거나 다른 작업의 실행권을 승계하지 않았습니다. Git main 직접 수정·병합·push도 수행하지 않았습니다.

이번 기록은 실제 배포·브라우저 관측 증거입니다. 별도 NativeHost 작업의 terminal receipt나 writer 승계 증거로 사용하지 않습니다.

## 4. 된 것

### 운영 설정

기존 활성 `custom:google` 인증 연결을 재사용했습니다. Supabase 허용 복귀 주소에 `https://thefacore.com/auth/google/callback`을 정확히 추가해 기존 6개에서 7개로 저장된 것을 확인했습니다. 공유 Supabase Site URL은 유지했습니다.

Vercel production에 비밀값이 아닌 `CUSTOMER_GOOGLE_AUTH_PROVIDER=custom:google`을 추가했습니다. Google secret을 새로 만들거나 다른 서버에 복사하지 않았습니다. 프로젝트 전체 이메일 인증 설정을 끄지 않았으며, Google 경로가 별도 이메일 인증 없이 동작하도록 연결했습니다.

### 배포

| 항목 | 확인값 |
|---|---|
| 운영 배포 | `dpl_HmHyj1t82zoaPWWz29KktwdqXFck` |
| 배포 상태 | READY, production |
| 배포 주소 | https://thefa-core-customer-6rzfp9hri-thefa.vercel.app |
| 실제 고객 도메인 | https://thefacore.com |
| 인증 후보 코드 HEAD | `3d194fbf4f6a1a36a5abfb9462381a0ec4e3a873` |
| 소스 구성 | 이전 R7 운영 소스 + 인증 변경 9개 파일 |
| 소스 대조 | 165/165 SHA-1 일치, 차이 0 |
| 새 build | 정확히 1회 |
| 원복 가능한 직전 배포 | `dpl_EspEhBB2qc1a4MmJrM9F4AiswbrM` |

156개 변경 없는 파일은 기존 Vercel 소스를 재사용하고 9개 인증 변경 파일을 적용했습니다. 이 결과를 단일 Git 트리 전체의 배포라고 표현하지 않습니다. 현재 화면과 기존 서비스 경로를 유지하는 R7 합성 후보입니다.

### 실제 고객 흐름

Google 버튼 → 현재 로그인된 대표 Google 계정 선택 → thefacore.com 복귀 → 고객 작업공간 진입을 직접 수행했습니다. 계정 이름, ‘작업공간 연결됨’, ‘무료 AI 답변 10 / 10회 남음’과 로그아웃 버튼을 확인했습니다.

실제 세션 응답의 안전한 필드만 대조했습니다.

| 관측 | 첫 로그인 | 로그아웃 | 재로그인 |
|---|---|---|---|
| authenticated | true | false | true |
| method | google | 해당 없음 | google |
| accountLinked | true | 해당 없음 | true |
| 같은 고객 계정 | 기준 | 해당 없음 | true |
| 무료 잔여 횟수 | 10 | 해당 없음 | 10 |

고객 UUID·토큰·쿠키 값은 이 기록에 저장하지 않았습니다. `accountLinked:true`는 검증된 더파코어 고객 신원 연결을 뜻하며, Google Drive나 GitHub 권한 연결을 뜻하지 않습니다.

## 5. 남은 것

1. 대표 계정 외 일반 Google 계정으로 최초 가입과 작업공간 생성·진입을 확인해야 합니다. 현재 코드에는 같은 Google 버튼을 통한 가입·로그인 흐름이 적용됐지만, 모든 외부 고객의 성공까지 이번 결과로 보장하지 않습니다.
2. Google 계정 선택 화면은 아직 Supabase 프로젝트 도메인을 표시합니다. 더파코어 이름·로고·표시 도메인 및 외부 Audience 공개 상태는 별도 정리·확인 대상입니다.
3. 로그인 유지 정책은 기존과 같이 최대 1시간 또는 공급사가 반환한 더 짧은 유효기간입니다. 자동 갱신은 이번 범위에 추가하지 않았습니다.
4. AI 답변 생성·대화 저장·Google Drive/GitHub/Supabase/Vercel 고객 연결은 이번 로그인 시험에서 실행하지 않았습니다.

## 6. 문제와 해석

이번 실제 로그인 및 재로그인에서는 차단 오류가 관측되지 않았습니다.

진단 목적으로 별도 탭에서 작업공간 API 주소를 직접 문서로 열었을 때는 `CUSTOMER_REQUEST_ORIGIN_INVALID` 응답을 받았습니다. 해당 요청의 어떤 헤더 조건이 거절됐는지는 직접 관측하지 않았습니다. 정상 작업공간 화면은 같은 출처 요청으로 성공했고, 소스상 HTTP 성공 응답과 올바른 계약값을 받은 뒤에만 ‘작업공간 연결됨’을 표시합니다. 이 진단 탐색 결과를 정상 UI 요청의 실패로 합치지 않았으며 보안 가드를 완화하지 않았습니다.

최종 15분 범위의 error/fatal 로그 집계에는 callback 2건이 표시됐습니다. 같은 조건에서 `CUSTOMER_DISPATCH_ROUTE_SHAPE`만 조회한 결과도 2건입니다. 기존 dispatch 코드가 query가 있는 정상 callback에서도 경로·query 키 종류만 console.error로 기록하는 진단입니다. 실제 로그인 성공과 함께 해석하며, ‘오류 로그 0건’이라고 보고하지 않습니다. 집계 도구의 상위 그룹 제한 때문에 전체 로그에 대한 무오류 보증도 하지 않습니다.

## 7. 검증

- 이전 격리 코드 QA: 262/262 PASS, 실패·skip 0. 공급사 호출은 모의 시험입니다.
- 4070 실제 배포 후보 QA: 21/21 PASS, 실패·skip 0.
- 이번 배포 파일: 165/165 지문 일치.
- 공개 페이지 HTTP 200: /, /login, /signup, /paid-demo, /studio, /world-original-v2, /broker-preview/.
- 실제 브라우저 세션: Google 로그인 2회 성공, 중간 로그아웃 false, 동일 고객 계정 재연결 확인.
- 작업공간 연결: 실제 UI 관측과 배포 소스 경로로 확인했습니다. 브라우저 Network 원문을 저장했다고 주장하지 않습니다.
- 무료 횟수 10회 유지. AI 요청이나 과금 작업을 보내지 않았습니다.

## 8. 보호와 원복

직전 정상 배포를 보존했습니다. 원복이 필요하면 위 이전 배포 ID를 대상으로 Vercel rollback을 실행하고 도메인 연결을 재확인할 수 있습니다. 이번에는 원복을 실행하지 않았습니다.

Google secret, 기존 계정 삭제, 전역 이메일 확인 해제, Billing·DNS·공용 Core writer/fence 변경은 수행하지 않았습니다. 다른 workstream의 원 작업·checkpoint·receipt는 재실행하거나 교체하지 않았습니다.

## 9. 다음

고객 공개 확대의 다음 확인점은 독립 Google 계정 1개를 통한 최초 가입과 Google 동의 화면의 더파코어 브랜드 정리입니다. 장기 로그인 유지 개선은 현재 최대 1시간 정책을 기준으로 별도 개발 범위를 정하면 됩니다.

## 10. 대표님 할 일

이번 적용과 대표 계정 로그인에는 추가 설정이나 재승인이 필요하지 않습니다. 현재 열린 작업공간을 사용하실 수 있습니다. 신규 고객 시험 단계에서 대표 계정과 다른 Google 계정이 있으면 그 계정의 최초 가입까지 확인할 수 있습니다.

## 11. 대표 결정과 이전 기록 정리

이번 원문 지시: “그럼 로그인 적용 시키고 로그인 까지 진행 해보도록 하자”

기존 요청인 기존 Google 연결 재사용, 더파코어로 복귀, 별도 이메일 인증 없는 Google 간편 로그인을 반영했습니다.

이전 준비 보고서는 당시의 ‘미배포’ 상태를 보존한 이력입니다. 이번 지시를 근거로 현행 서비스별 배포 경로와 설치된 `THE_FA_VERCEL_DEPLOY_ADMISSION_V1`의 `ALLOW_ONCE` 결과를 확인했고, 승인된 단일 production build를 수행했습니다. 이전 보고서의 새 NativeHost Work Unit 필요 판단을 이번 서비스별 게시 경로의 필수조건으로 반복 적용하지 않았습니다. 공용 Core의 권한이나 승인 증거를 임의 생성한 것은 아닙니다.

이 문서와 `PRODUCTION_RESULT.json`은 관측 결과입니다. 전체 대화가 회사 기억에 자동 저장됐거나 모든 채팅에 전달됐다고 주장하지 않습니다.
