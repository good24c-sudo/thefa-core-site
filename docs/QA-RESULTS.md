# THE FA Core V3 / Console Lab V2 — local QA

검증일: 2026-10-03. 기준 저장소: `good24c-sudo/thefa-core-site`, base main: `be02b485f3dba4830feba1cc37445fee4731c955`. 이 문서는 branch/local 검증을 기록합니다. 배포 완료나 중앙 Core의 writer 등록을 의미하지 않습니다. 정확한 result HEAD와 소스 tree 연결은 별도 `exact-head-qa.json` / `terminal-receipt.json`에 보존합니다.

## 실제 확인한 결과

| 검증 | 결과 | 범위 |
| --- | --- | --- |
| 정적 검사 | PASS | HTML 7개, JS syntax 8개, 로컬 링크·파일·CSS asset·중복 ID |
| Engine | 11/11 PASS | 파일 무결성, 중복 접수, 승인·거절, 실패·재개, 재시작 복구, adapter 계약, HTTP 경계, 변조 거절, 동시 writer 차단 |
| Task flow | PASS / LOCAL | 실제 Markdown 파일·QA·영수증·다운로드의 SHA-256 일치 |
| Approval | PASS / LOCAL simulation | 승인 전 실행 차단, 승인 범위 SANDBOX_SIMULATION_ONLY, 실제 배포 없음 |
| Resume | PASS / LOCAL | 실패 후 같은 Task·WorkUnit·계획·checkpoint 재사용 |
| Failover | PASS / MOCK | 가상 Provider A 장애 → 가상 Provider B 결과 |
| Local AI | PASS / LOCAL | 기존 Ollama `qwen2.5-coder:3b` 읽기 전용 요약, 응답·파일 무결성 확인 |
| Website / Console | PASS | 각각 320 / 360 / 375 / 390 / 430 / 1280 / 1440 / 1920px에서 페이지 가로 넘침·로드 완료 이미지 오류·44px 미만 표시 조작부 없음 |
| 실제 홈페이지 조작 | PASS | 7단계·6활용 사례 탭, 키보드 Home/ArrowRight, 고급 정보, 모바일 메뉴 |
| 실제 Console 조작 | PASS | 목표 접수→검증→영수증 열기, 승인 대기→UI 거절, 실패→UI 재개→검증, 서버 재시작→PAUSED→UI 재개→파일·영수증 검증 |
| Console 전체 메뉴 | PASS | 320px에서 홈·프로젝트·자원·승인·결과물·Memory·Connections·Usage 확인 |

실제 화면 조작 동안 두 표면의 browser console error 기록은 비어 있었습니다. 기존 `signup.html`의 h1 2개는 이번 변경 이전부터 존재하며 정적 검사의 PREEXISTING 항목으로 남겼습니다. 전체 접근성 인증, 실제 터치 단말 테스트, Lighthouse 점수나 Production 성능 측정은 수행하지 않았습니다. 키보드 조작·44px 조작부·표시 상태·CSS reduced-motion 처리를 확인한 범위만 보고합니다.

## 제품·재사용 판단

홈페이지는 THE FA Core 하나를 AI Work OS로 설명합니다. 브랜드·wordmark·로컬 폰트·디자인 token·공용 header/footer와 기존 Demo/Console/Contact/account 경로를 재사용하고, 내부 엔진·능력별 자원·실행 단계·Memory·검토·승인·결과를 새 흐름으로 보여줍니다. 공개 페이지의 자원/Workspace는 설명용 예시입니다.

거절된 Plus ZIP은 별도 reference에 13개 파일로 풀어 읽었습니다. atomic-save 방식과 실행 기록 분리 개념만 참고하고, Dashboard 중심 IA·첫 화면·로그인·디자인을 계승하지 않았습니다. 원본 ZIP SHA-256: `15871181c8287b2f102de9d81b04861b7c7876db9d0b15a4edda70603d262880`.

Console V2는 목표·결과 중심의 새 UI와 Node 표준 라이브러리 engine입니다. 실제 실행/검사/영수증은 로컬 개발 실험 범위이며, 어떤 일반 업무 요청도 모두 수행한다고 표시하지 않습니다. 로컬 요약은 의미 정확도 미검증입니다. Research·failover는 MOCK이며 외부 AI/API·Coding Agent·GitHub·중앙 Core/Router/Scheduler/Telegram은 DISCONNECTED 또는 PLANNED입니다.

## 개발 환경과 비용 근거

독립 구현 3개를 Codex 하위 에이전트에 분담하고 루트 Codex가 통합·검토·화면 QA·Git 마무리를 수행했습니다. 기존 ChatGPT 프로젝트방에 실행을 접수하거나 writer를 이전하지 않았습니다. 반복 정적 검사·11개 tests·5개 live canary는 로컬 deterministic scripts로 처리했으며, 이는 Local AI 위임과 구분합니다. Local AI가 실제 처리한 것은 기존 모델을 사용한 canary 요약 1건입니다.

새 framework, npm dependency, 폰트 download, 모델 download, 외부 유료 API 호출이 없습니다. 원본 파일 크기 기준 homepage HTML 27,217 bytes, homepage JS 10,831 bytes, 누적 sections CSS 104,847 bytes이며 기존 로컬 font 1,193,036 bytes를 재사용합니다. 파일 크기는 로딩 시간·압축 전송량·계정 quota 절감량이 아닙니다. RTK는 허용된 읽기 출력에만, Serena는 정확한 저장소에서 사용했고 기존 Token Optimizer quiet Stop hook을 유지했습니다. 실제 계정 quota 절감률은 미측정입니다.

## 보호와 증거

실행 표면: Console `http://127.0.0.1:4173`, Website `http://127.0.0.1:4174`. 서버는 loopback에만 바인딩합니다. Console 실행 파일 7개는 별도 product directory의 실제 파일과 SHA-256이 일치했습니다.

main merge / Production deployment / CNAME·DNS / Secret·OAuth / production DB·API / 권한·결제 변경이 없습니다. 공개 사이트 HTML의 최종 SHA-256은 시작 시와 동일한 `bb7c16520f00d36170486b34f9ba7f1b68d9dbf7c95cabb68936f5dd914de383`입니다. 기존 다른 작업 branch와 원본 ZIP을 보존했습니다.

전체 logs·JSON receipts·화면 증거는 별도 `THEFA_Core_V3_Evidence_20261003` 폴더에 있습니다. 반응형 근거는 최종 `website-responsive-qa.json`, `console-responsive-qa.json`, `console-views-320.json`이며, 중간 mixed-tab viewport 자료 `responsive-qa.json`은 최종 근거에서 제외했습니다.

남은 별도 범위는 대표님의 Production 반영 승인과 실제 중앙 실행/외부 자원 연동입니다. 현재 branch/local 요청 범위와 분리합니다.
