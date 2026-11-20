# 더파코어 회원·가격·멀티 AI 운영 연결

상태: 후보 구현 및 격리 QA 완료. 운영 배포·실계정 확인은 별도 결과 기록을 따른다.

## 대표 지시와 적용 범위

- 문의·개인정보·삭제 요청 접수: thefa@thefa.kr
- 기존 app.thefacore.com 관리자 인증과 화면을 재사용하고 /admin에 회원·사용량·원가를 연결한다.
- STANDARD 월 19,000원/500크레딧, PRO 월 49,000원/1,800크레딧, VAT 포함. 기업은 별도 문의.
- 2026-11-17 가격 PRD는 당시 추천안이며 이번 대표의 가격 적용 지시로 안내에 반영했다. 과거 최종 승인으로 소급하지 않는다.
- 고객에게 공급사 이름을 숨기는 11월 18일 정책을 유지한다. 고객 업무 모드는 더파 기본, 빠른 실무, 글쓰기·분석, 종합 대화다.

## 실제 구현

DeepSeek Flash, GPT-6 Luna, Claude Haiku 5.5, Gemini 3.1 Flash-Lite를 기존 서버 API 키 및 고정 native adapter로 연결한다. 무료10회는 모든 모델의 합계이며 기존 계정 식별키·무료량 epoch·일 원가 예산 10,000원을 유지한다. 선택한 모델의 자동 변경·자동 재요청은 없다.

공급사 usage를 정규화하고 버전 있는 단가로 추정 원가를 저장한다. 공급사 결과를 받은 뒤 원가 증거를 먼저 저장하고 답변과 최종 원가를 같은 tenant CAS에서 확정한다. 결과불명은 hold와 증거를 보존한다. JSONB 키 순서 차이와 KST 자정 경계를 검증했다. 실제 청구 금액은 공급사 청구서 대사 전까지 null이다.

회원 집계는 공유 auth.users 전체를 사용하지 않는다. 검증된 Core 세션이 고객 작업공간에 남긴 membership marker를 중복 제거한다. 과거 전체 가입자 수는 미확인으로 둔다. 개인정보·질문 본문·토큰·API 키는 관리자 aggregate 응답에 포함하지 않는다.

기존 콘솔 세션·allowlist·Host/Origin 검사를 통과한 GET에서만 /api/customer-operations를 제공한다. 대시보드 JS/CSS도 보호되며 public 정적 폴더에 두지 않는다. 집계 실패는 503으로 표시하고 0으로 바꾸지 않는다. 기존 작업·Core ingress 기능은 유지한다.

가격이 '확인 중'으로 보였던 원인은 고객 페이지가 존재하지 않는 /api/customer/plans를 호출한 것이다. /api/plans 공개 가격 API를 실제 서버에 추가하고 화면을 연결했다. 결제 연결 전에는 유료 권한·매출·월 크레딧을 만들지 않는다.

## 원가 계산기

요금제, 회원 수, 크레딧 사용률, 모델, 입력·출력 토큰, 캐시 적중률, 환율, PG 수수료, 인프라·지원·기타 직접비를 조정한다. 매출 VAT를 제외하고 PG 수수료와 수수료 VAT 및 직접비를 차감한다. PG 3.4%와 수수료 VAT10%, 환율1600원/USD는 계산 가정이다. 공헌이익 목표40%이며 실제 순이익을 의미하지 않는다. 모델 캐시 쓰기 단가를 포함한 보수적 입력 비용을 사용한다.

## 재사용 근거와 변경 경계

고객 기준 배포 dpl_HmHyj1t82zoaPWWz29KktwdqXFck, 콘솔 기준 배포 dpl_A8DHqgNnTEfjFq1fS1YTvEfKd1ZW. 고객은 R7+Google 로그인 정확 소스의 runtime127개를 모두 보존하고 변경 후135개를 해시 검증했다. 콘솔은 실제 배포 파일 UID SHA1로 원본을 복원하고 변경 후34개 runtime 파일을 SHA256 검증했다. 기존 폰트·World·Studio·Broker·로그인 화면을 보존한다.

Core global revision62, 명시한 고객 workstream Issue8, Fresh GitHub 부모1dfcb4c45c2dacd3aaa586cda964b15649b7d465, 콘솔 소스브랜치 cbf3605390739cbd650c577f5d4c9c46b0eb94a8. 전사 결정 e63961c3-674d-4875-b41f-9255af9c5b92의 기존 승인·서비스별 경로 재사용 범위다. 이 작업은 P02의 격리 후보이며 P04 writer/fence나 main을 변경하지 않는다.

## 남은 서비스 단계

- PortOne 실제 결제·webhook·구독 권한 부여는 이번 범위에서 연결하지 않았다.
- 현재 원가 원장은 tenant당256건 제한이다. 월500/1800크레딧의 유료 개통 전 보관·분할 및 정산 연결이 필요하다.
- 로그인된 실제 사용자 UI에서 네 모델의 최신 성공·회원 집계·원가 반영은 운영 결과로 별도 확인한다.
- Google 계정 선택기의 브랜드 표시 최종 검증·공개 개인정보정책은 이전 미완료 상태와 구분한다. 문의처만 정해졌다고 브랜드 승인 완료로 처리하지 않는다.
- 더 많은 유료/고성능 모델, Mistral·Gateway 등은 검증된 해당 키·가격·권한 정책 없이 활성화하지 않는다.

## 단가 확인 원문

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://aistudio.google.com/api-reference/generate-content
- https://api-docs.deepseek.com/quick_start/pricing/

## 검증 파일

LOCAL_QA.txt: 격리 HTTP·세션·모델·원가·회원 집계 검증. 운영 배포·실제 청구 증거가 아니다.
각 app/operations-release-manifest.json: 배포 runtime 파일의 SHA256와 길이.
prepare_candidate.py: 기존 승인 PC 실행 경로에서 기존 배포 원본과 해시가 같은 파일만 복사하는 조립 절차. 기존 실행판을 덮어쓰지 않는다.
