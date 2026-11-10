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