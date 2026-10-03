# THE FA Core Functional Console Lab V2

대표님 요청을 목표 → 계획 → 자원 선택 → 로컬 실행 → 검증 → 파일 → 영수증으로 이어 보는 개발용 실험실입니다. 공개 홈페이지와 Production backend에서 분리되어 있습니다. 처음 화면은 목표와 결과 중심이며 고급 실행 내역은 필요할 때 펼칩니다.

## 실행

Node.js 22 이상이 이미 있으면 추가 설치·API key 없이 실행합니다.

```powershell
cd "C:\Users\최대희\Desktop\THEFA_Core_Homepage_V3_Codex_Work\lab"
node server.mjs
```

주소: `http://127.0.0.1:4173`. 포트 충돌이면 서버를 추가로 띄우거나 기존 서버를 종료하지 않고 실패합니다. 서버는 127.0.0.1에만 바인딩하며 Host/Origin을 확인합니다. `.env`를 읽지 않습니다. 환경은 development / local / local / auto로 고정됩니다.

## 실제 동작과 한계

- **LOCAL:** 요청·계획·작업 단위·상태·체크포인트를 `runtime-state/state.json`에 원자적으로 저장합니다. 상태 변경은 직렬화하며 같은 Task의 Worker는 하나입니다. writer lock으로 같은 저장소의 두 서버를 막습니다.
- **LOCAL:** 안전한 실행은 Node 표준 시험값과 샌드박스 경계를 검사한 보고서를 `test-output/`에 실제 생성합니다. 일반 요청의 실제 업무를 실행한다고 주장하지 않습니다.
- **LOCAL:** QA는 파일 존재·Task 식별자·LOCAL/MOCK 표시·SHA-256을 확인합니다. 최종 파일과 영수증 해시가 일치한 뒤 VERIFIED로 기록합니다. 파일 조회 시에도 해시 변조를 거절합니다.
- **LOCAL:** 재시작 시 진행 중 Task는 PAUSED가 됩니다. 재개 버튼으로 저장 지점에서 이어갑니다. 이미 생성된 Task 파일은 복구하여 Provider 호출과 파일 생성을 반복하지 않습니다.
- **MOCK:** 연구 예시와 Provider A → B 전환은 가상 어댑터로만 실행합니다. 실제 조사·검색·외부 AI 성공을 표시하지 않습니다.
- **승인:** `Production에 배포` 같은 요청은 WAITING_APPROVAL에서 멈춥니다. 승인 범위는 **SANDBOX_SIMULATION_ONLY**이며 승인 후에도 로컬 가상 보고서만 생성합니다. 실제 배포 경로는 구현하지 않았습니다.
- **기존 Local AI:** `127.0.0.1:11434/api/tags`를 1.5초 이내 확인합니다. 기존 모델이 있을 때만 최대 30초, 256 output token의 읽기 전용 요약을 `/api/generate`로 수행합니다. 작은 기존 `qwen2.5-coder:3b`, 이어서 `qwen3:4b`를 우선합니다. 다운로드·모델 변경은 없습니다. QA는 응답과 파일 무결성만 확인하며 의미 정확도는 사용자 검토가 필요합니다. 미가용이면 SKIPPED_LOCAL_AI_NOT_AVAILABLE입니다.
- **DISCONNECTED / PLANNED:** 외부 AI·Agent·Tool은 레지스트리와 Adapter skeleton만 있습니다. API key를 읽거나 연결됐다고 추측하지 않습니다.

이 실험실의 자원 선택은 **LOCAL_DEVELOPMENT_POLICY**입니다. THE FA Enterprise Router V2, Core CURRENT, 중앙 Scheduler/Work Unit API, Telegram에 접수·연결·위임한 것으로 표시하지 않습니다. 실제 연동은 별도 권한과 영수증이 필요한 다음 작업입니다.

Production DB/API mutation, 사용자 데이터, 유료 API, shell 실행, 임의 파일 경로, 인증·회원가입, 결제, DNS 변경 기능은 없습니다. 실험 파일에는 입력 텍스트가 남으므로 비밀·실제 사용자 데이터를 넣지 마세요. 실제 결과와 영수증은 Git에서 제외됩니다.

## API

- `GET /api/state`: tasks/resources/approvals/artifacts/receipts/memory/usage/environment/pipeline
- `GET /api/events`: Server-Sent Events의 `state` 이벤트
- `GET /api/health`: loopback local 준비 상태
- `POST /api/tasks`: `{title,scenario,idempotencyKey,inputText?}` → `{task,reused}`
- scenario: safe / failure / failover / approval / research / summary
- `POST /api/tasks/:id/resume`: `{}` → 같은 Task와 WorkUnit 재개
- `POST /api/tasks/:id/approval`: `{decision:"approve"|"reject"}`
- `GET /api/artifacts/:id`: 실제 Markdown 파일, 변조 시 409
- `GET /api/receipts/:id`: `{receipt}`

POST는 JSON 16 KiB 이내이며 title 200자, 요약 입력 4,000자 이내입니다. idempotencyKey는 8–128자입니다. 같은 key+입력은 기존 Task를 반환하며 같은 key의 다른 입력은 409입니다. 현재 계정 quota 절감량을 추정하지 않습니다.

## 검증

```powershell
node --test tests/engine.test.mjs
```

테스트는 임시 로컬 저장소에서 실제 파일·해시·중복 접수·승인·거절·실패/재개·재시작 복구·MOCK 전환·Local AI 미가용/어댑터 계약·Host/Origin·비밀 경로·body 제한·변조·단일 writer를 검증합니다. 테스트용 Ollama 응답은 어댑터 계약 시험이며 실제 Local AI 실행 증거와 구분합니다.

## V1 참고 자료 사용

사용자가 거절한 ZIP의 홈 IA·Dashboard·가짜 로그인·Task 첫 화면을 계승하지 않았습니다. 원본 ZIP은 수정하지 않았습니다. 별도 reference의 서버에서 임시 파일 + rename 저장 방식만 참고했습니다. V1은 쓰기 직렬화·실행 worker·검증 영수증을 제공하지 않아 새 구현을 작성했습니다.
