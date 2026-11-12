# THE FA Core — FA 스테이징 SSO 검증기

- Edge 함수명: `thefa-core-customer-sso-stage`
- 배포 프로젝트: FA_STAGING `furfjhymxqsbhvuyeqpx` 전용
- Supabase 보호: **verify_jwt=true**, 절대로 끄지 않음
- Core OAuth client: `6b70d657-b1fa-4174-a3f2-29d475f4e3c0`
- 본 기능: User OAuth JWT를 검증해 해당 OAuth client의 실제 계정임을 확인
- Auth 서버는 `/auth/v1/user`로 사용자 존재·JWT를 독립 재검증
- 비밀·service_role 외부 이전 **없음**. 데이터베이스 읽기·쓰기 **없음**
- 관리자/직원 권한, 고객 계정 연결, 무료 10회, AI 답변 권한을 발급하지 않음

## 스테이징 연동
Core 서버가 OAuth code를 교환한 후 서버전용으로 access_token을
Edge `/functions/v1/thefa-core-customer-sso-stage`의 Authorization Bearer에
전달합니다. 이 함수에서 `authenticated:true`를 반환해야만 OIDC 세션을
확정하고, 별도 권한·계정 연결 과정으로 진행합니다.

권한은 Core 기존 계정 저장 서비스의 검증된 별도 작업에서 이어서 확인합니다.
실제 브라우저의 Google/이메일 사용자가 로그인한 E2E 증거 없이
운영 완료라고 선언하지 않습니다.
