# THE FA Core — 기존 단골리턴 Supabase Auth 공통 계정 OIDC V1

범위: P04/00_v25 THE_FA_CORE_CUSTOMER_LAUNCH_V1 / good24c-sudo/thefa-core-site / infra/customer-launch/** 및 docs/customer-launch/**.
Base HEAD: 1dfcb4c45c2dacd3aaa586cda964b15649b7d465. 기존 BetterAuth, 사용량 데이터, 원 개발 Job 변경 없음.

## 구현
- 서버 전용 엔드포인트: /api/oidc/start, /api/oidc/callback, /api/oidc/session, /api/oidc/status, /api/oidc/logout.
- 기존 FA 스테이징 Supabase Auth OAuth 2.1/OIDC 사용. PKCE S256, state+nonce, ES256 JWKS/issuer/audience/exp/azp, AES256-GCM host-only cookie 30분, CSRF/호스트 검사.
- 사용자가 통합 인증을 받아도 Core 고객 등록 및 AI 사용량 권한은 아직 발급되지 않음. session/accountLinked=false, canUseAi=false는 의도된 보안 조치이며 로그인 완성이 아님.

## 안전한 Stage 연결
1. 이 브랜치의 정확 HEAD를 Vercel 고객 프로젝트 프리뷰로 배포하고 /api/oidc/callback 실제 호스트를 확인.
2. 현재 FA_스테이징 OAuth Server Site URL과 Authorization Path를 공식 화면에서 확인. 기존 CEO/직원/RD 동의 설정은 임의 변경 금지.
3. 정확한 Core Preview callback에만 신규 PUBLIC+PKCE OAuth client를 등록. 기존 AI/Pilot 클라이언트는 재사용 금지.
4. 동일 프리뷰 브랜치에만 THEFA_CORE_OIDC_ISSUER, THEFA_CORE_OIDC_CLIENT_ID, THEFA_CORE_OIDC_ORIGIN, THEFA_CORE_OIDC_COOKIE_SECRET_BASE64URL을 안전한 비밀 관리 경로로 설치. 비밀값 출력/복사 금지.
5. Origin 및 signed callback runtime readback, 실제 Google+email 로그인, state/nonce/replay 거절, 로그아웃, 재로그인 검증.
6. 그 뒤 검증된 issuer/sub를 기존 Core 고객 가입·세션·무료사용량에 원자적 등록. 이메일 주소만으로 기존 계정 자동병합·CEO 권한 승격 금지.

## 사용자 테스트 데이터
대표님은 테스트 고객 삭제 후 새 가입을 승인했습니다. 하지만 FA_스테이징 auth.users 8명과 운영 3명은 모두 persons와 연결, CEO WebAuthn/RD 직원 및 서비스 관리 권한에 연쇄 영향을 주는 UUID가 있습니다. 안전한 대상별 백업/복원 검증 전에는 auth.users 일괄 삭제 금지.

QA: Node customer tests 142/142 PASS, 신규 OIDC 8/8 포함. 이것은 격리 QA이지 실사용 Google SSO, 가입, Core AI/저장, Production 배포 완료가 아닙니다.
## 2026-11-10 추가 실검증
- 스테이징 Supabase OAuth 클라이언트 `6b70d657-b1fa-4174-a3f2-29d475f4e3c0` 생성 및 동일 콜백 readback PASS.
- Core 프리뷰의 `/api/oidc/status`는 `configured:true`로 HTTP 200, `/api/oidc/start`는 올바른 등록 client/PKCE/state/nonce/콜백으로 303 반환 PASS.
- 기존 FA OAuth 카나리는 `authorization_id`를 가진 신규 Core 인증 요청을 받아 로그인 화면 HTTP 200 반환 PASS. 기존 37개 클라이언트를 보호하기 위해 카나리 전역 alias/Site URL은 변경하지 않음.
- Core login/signup 두 화면에 `THE FA 통합 계정으로 계속` 추가; OIDC status 200일 때만 활성, 성공 후 기존 고객 연결 미완료를 정확히 안내.
- Core 전체 테스트 148/148 PASS, HTML+JS+CSS source/published SHA256 manifest 동기화 확인.
- 실제 사용자 Google/이메일 승인·ID 토큰 전달의 완전한 실계정 E2E와 Core 계정 등록·무료사용량 연결은 아직 남음. 완료 또는 운영 출시로 오인 금지.

## 2026-11-11 · Core OAuth 콜백의 독립 사용자 검증 연결

- P04 기존 안전브랜치에서 staging-only Edge `thefa-core-customer-sso-stage`(FA_STAGING, version 1) ACTIVE. Supabase `verify_jwt=true` 원천 차단과 Auth `/auth/v1/user` 실시간 검증.
- Edge는 정확한 Core OAuth client_id, issuer, subject, session_id, authenticated role/exp를 확인합니다. 잘못된 토큰·다른 AI OAuth 클라이언트·다른 사용자·익명계정 거부. Edge에서 DB 조회·쓰기·service_role·비밀값 복사는 없습니다.
- Core 프리뷰 OAuth callback은 `THEFA_CORE_STAGE_EDGE_AUTH_READY=true`가 설치되었을 때만 받은 `access_token`을 이 Edge에 서버 간 전달해 재검증 후 기존 서명된 Core session을 발급합니다. 브라우저에 access_token 저장·출력 금지.
- `THEFA_CORE_STAGE_BRIDGE_ENABLED`의 기존 고객 원장 등록·무료10·AI 기능은 **활성화하지 않았습니다**. 운영 DB·OAuth 전역 설정·CEO WebAuthn·main·원 Job을 보호합니다.
- Core 앱 실제 통합 로그인 브라우저 승인(E2E) 및 고객 저장/AI 활성화는 별도 증거가 필요합니다. 개발 코드/프리뷰 준비를 제품 출시 완료와 혼동하지 않습니다.
