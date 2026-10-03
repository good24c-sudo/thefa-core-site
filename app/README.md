# THEFA Core Console V1 · Founder Beta Preview

`app/**`는 기존 공개 사이트와 분리된 실제 사용자 작업실 Preview입니다.

## 현재 실제 동작

- 로컬 서버 세션 로그인
- 사용자별 private workspace 생성 및 접근 검사
- Task 생성/수정과 JSON 원자 저장
- 서버 재시작 후 Task/세션 재조회
- Task / Run / WorkUnit / Approval / Artifact / QA / Receipt 데이터 분리
- Work Unit API 미연결 시 실행 요청 차단 (`503 WORK_UNIT_CONNECTION_PENDING`)
- 다른 사용자 workspace 접근 차단 (`403`)

## 실행

```powershell
cd app
npm test
npm start
```

기본 바인딩은 `127.0.0.1:4173`입니다. 외부 주소로 바인딩할 때는 `THEFA_CORE_PREVIEW_CODE`가 없으면 서버 시작이 거절됩니다.
