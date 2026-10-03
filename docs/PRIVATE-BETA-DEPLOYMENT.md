# THE FA Core invite-only Private Beta

대표님은 2026-10-03에 `thefa@thefa.kr`, `ceo@thefa.kr` 두 이메일의 로그인 후 Console 접근과 홈페이지 공개 배포를 명시 요청하셨습니다. 이전 branch/local 전용 승인은 이번 요청 범위에서 홈페이지 배포와 별도 초대 Console 공개로 확대되었습니다. 공용 DNS/CNAME, 기존 Supabase Auth/SMTP/OAuth 설정, 기존 회사 업무/중앙 Router/Scheduler는 변경하지 않습니다.

공개 홈페이지는 현재 GitHub Pages `main /`을 유지합니다. Console은 별도 Vercel `thefa-core-console` 서비스에서 메일 인증코드·HttpOnly 세션으로 보호합니다. 두 이메일의 소유 확인 없이 주소 입력만으로 로그인시키지 않습니다. 간편가입은 준비 중이며, 초대받은 참가자만 메일 인증 후 접근합니다.

인증과 결과 저장에는 독립 `core_console_*_v2` 객체만 사용합니다. 기존 업무 테이블·인증 사용자·메일 설정은 변경하지 않습니다. 해당 객체는 일반 브라우저 역할의 모든 접근을 거절하며, 서버용 자격 증명은 환경변수로만 전달합니다. 인증코드는 10분·최대 5회·1회 사용, 발송은 이메일당 60초 제한입니다. 세션은 8시간, 로그아웃으로 서버에서 폐기합니다. 코드와 쿠키 원문을 로그나 Git에 저장하지 않습니다.

새 저장소 객체: state, artifacts, email_challenges, sessions 및 관련 전용 함수. 같은 Workspace의 수정 권한은 DB lease와 version CAS로 하나만 허용합니다. GET은 읽기 전용이고, 만료된 writer만 복구합니다. Cloud Sandbox가 시험 보고서를 실제 생성·보존·검증합니다. PC·Ollama·중앙 Work Unit·외부 유료 AI 연결은 제공하지 않으며, Research와 Failover는 MOCK입니다. 이 단계는 공개 초대 Beta이며 실제 회사 업무 자동화 완성본을 의미하지 않습니다.

개발 권한은 이번 직접 대표 지시의 분리된 source/새 객체 범위입니다. 해당 홈페이지에 대한 중앙 Core writer/fence 등록이 확인되지 않았으므로 중앙 권한을 취득했다고 주장하지 않습니다. 기존 다른 프로젝트 및 writer의 객체는 보호합니다.

완료 근거는 source HEAD, clean worktree, 코드/DB 검증, 배포 ID·실제 URL 응답, 비로그인/비허용 이메일 차단, 안전한 실제 Sandbox 결과·해시, 필요시 대표님의 실제 이메일 로그인 readback을 구분합니다. 실제 이메일 수신·로그인 완료는 시험용 인증코드로 대체해 주장하지 않습니다.

메일 발송에는 검증된 thefa.kr 도메인만 허용하는 sending_access 전용 키를 사용합니다. 기존 두 Supabase 발송 키는 변경하지 않았습니다. 새 키는 대화/소스/평문 파일에 기록하지 않고 Vercel Secret 환경에만 전달합니다.
