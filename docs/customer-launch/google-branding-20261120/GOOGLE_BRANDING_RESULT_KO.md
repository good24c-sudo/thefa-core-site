# THE FA Core Google 표시 개선 결과

관측: 2026-11-20 15:41 KST · P02_더파개발실

## 결론

**Google 앱의 이름·홈페이지·도메인 등록은 변경하고 저장했습니다. 첨부하신 계정 선택 화면의 Supabase 도메인 표시는 아직 바뀌지 않았습니다.**

상태: `BRAND_METADATA_SAVED_PUBLIC_DISPLAY_NOT_CHANGED`. 설정 저장과 실제 고객 화면 반영을 구분합니다.

## 진행률과 방 상태

| 단계 | 결과 |
|---|---|
| 실제 운영 client와 Google 프로젝트 대조 | 완료 |
| 변경 전 브랜드 설정 백업 | 완료 |
| 앱 이름 변경 | THE FA Core (더파코어) |
| 홈페이지 등록 | https://thefacore.com/about |
| 승인된 도메인 추가 | thefacore.com |
| Google 저장 및 새로고침 후 확인 | 완료 |
| 변경 후 실제 Google 로그인 | 더파코어 복귀·작업공간 연결 성공 |
| 고객 계정 선택 화면 | 여전히 Supabase 도메인 표시 |
| Google 브랜드 검증·게시 | 미완료, 제출하지 않음 |
| 서비스용 개인정보 안내 초안의 사실 정리 | 완료, 공개 게시하지 않음 |

이번 변경은 P02에서 현재 대표 지시에 따라 Google 설정 화면을 통해 수행했습니다. 공용 Core revision 62의 대상별 명시 승인·서비스별 실제 변경 경로를 확인했습니다. 기존 writer/fence, 원 Job, 운영 코드와 배포는 그대로입니다.

## 된 것

### 실제 대상 식별

Supabase `custom:google`의 공개 client ID와 Google 콘솔의 client 목록을 대조했습니다.

- Google 프로젝트: `sangme` / 화면 프로젝트명 SANGME.
- 기존 client 내부 이름: 단골리턴 Web Login.
- client ID: `817682012223-r3dsftua7ee3tdoh702fk5a1hkpg9vd9.apps.googleusercontent.com`.
- 기존 앱 표시 이름: 단골리턴.
- 이 프로젝트에서 조회된 OAuth client는 위 하나입니다.

처음 열렸던 Default Gemini Project의 ‘THE FA Core Customer Login’과 ‘THE FA Core STAGING’은 현재 운영 client와 달랐습니다. 그 프로젝트는 수정하지 않았습니다.

Google 브랜딩은 프로젝트 단위이므로 기존 공유 client를 사용하는 인증 화면에도 새 등록 이름이 적용 대상이 됩니다. client 내부 관리명·secret·callback은 바꾸지 않았습니다.

### 저장된 변경

| 설정 | 이전 | 변경 후 |
|---|---|---|
| 앱 이름 | 단골리턴 | THE FA Core (더파코어) |
| 애플리케이션 홈페이지 | 비어 있음 | https://thefacore.com/about |
| 승인된 도메인 | 기존 3개 | 기존 3개 + thefacore.com |
| 개인정보처리방침·약관 | 비어 있음 | 미확정 내용을 임의 입력하지 않음 |

Google의 ‘브랜딩 변경사항이 저장되었습니다’ 알림을 관측했고, 새로고침 후 위 세 값이 유지되는 것을 확인했습니다. `GOOGLE_BRANDING_SAVED.jpg`는 이 저장 결과의 화면 증거입니다.

## 남은 것과 문제

### 왜 화면에는 아직 Supabase가 보이는가

현재 Google 앱의 공개 상태는 **Testing**입니다. Audience 화면의 **앱 게시 버튼은 비활성화**되어 있고 ‘브랜딩 페이지에서 구성을 완료해야 한다’는 안내가 있습니다. Verification Center는 테스트 상태라 검증이 필요하지 않다는 안내만 표시합니다.

이름 저장 후 새로 시작한 실제 Google 인증에서도 `cgrppxfdurpzzfvkmfte.supabase.co(으)로 이동`이 그대로 보였습니다. 따라서 등록값 변경만으로 사용자 화면까지 완료됐다고 판단하지 않습니다. 어떤 단일 누락 필드만 채우면 버튼이 활성화된다고 단정하지도 않습니다.

Google 공식 문서는 공개 앱의 이름·로고 표시를 위해 브랜드 검증과 게시가 필요하며, 초안 저장과 게시 상태를 구분합니다.

### 현행 개인정보 안내와 서비스가 다름

실제 로그인 화면의 개인정보 링크는 https://thefa.kr/privacy.html 입니다. 이 문서는 회사 홈페이지 문의를 대상으로 하며 회사 홈페이지에는 회원가입·결제가 없다고 설명합니다. Google 계정 로그인, 고객 계정·대화 저장, AI 처리에 대한 더파코어 안내가 아닙니다.

더파코어의 공개 소개 페이지 https://thefacore.com/about 는 HTTP 200이고 제품과 운영 회사를 설명하지만 개인정보처리방침 링크가 없습니다. 확인한 공개 연결 범위와 현재 앱/문서 저장소에서는 Core 전용 정책 원문을 찾지 못했습니다. 전체 회사 자산에 정책이 없다고 단정하지 않습니다.

이 상태에서 존재하지 않는 정책 URL이나 내용이 다른 회사 홈페이지 정책을 넣어 검증 준비 완료로 표시하지 않았습니다.

## 검증

- 운영 도메인의 배포는 `dpl_HmHyj1t82zoaPWWz29KktwdqXFck`로 유지됩니다.
- 설정 저장 후 실제 Google 계정을 선택해 https://thefacore.com/ 으로 돌아왔습니다.
- ‘작업공간 연결됨’ 표시를 다시 확인했습니다.
- 이번 변경은 신규 외부 Google 계정 가입이나 브랜드 공개 검증 완료를 의미하지 않습니다.
- 별도 코드 변경·Vercel build·유료 도메인 추가 구매는 수행하지 않았습니다.

## 보호

기존 Google 비밀키, callback, scope, Supabase URL, 고객 UUID·작업공간 식별 기준은 변경하지 않았습니다. 기존 도메인 항목도 삭제하지 않았습니다. 같은 Google client를 재사용하는 실제 로그인 경로는 시험 후 성공했습니다.

무료 Supabase 프로젝트를 유료 플랜으로 변경하거나 custom domain 비용을 발생시키지 않았습니다. 단순 브랜드 표시 개선의 첫 단계로 Google의 공식 브랜딩 경로를 사용했습니다.

## 다음

1. `CORE_PRIVACY_PUBLICATION_DRAFT_KO.md`의 확정된 구현 사실을 바탕으로 계정·대화의 보유기간, 삭제·탈퇴 지원, 처리 업체/국외 이전 조건을 확정합니다.
2. 확정된 더파코어 전용 개인정보 안내를 같은 서비스 도메인에 게시하고 소개·로그인·가입 화면에서 연결합니다.
3. Google 브랜딩 양식의 실제 누락 항목과 도메인 소유 확인을 완료합니다.
4. Google 브랜드 검증 및 게시 결과를 확인하고, 실제 계정 선택 화면의 이름과 로그인 복귀를 다시 검증합니다.

현재 UI의 ‘기록 지우기’ 호출과 서버의 삭제 API 연결에도 코드상 차이가 발견되었습니다. 실제 고객 기록을 삭제하는 시험은 하지 않았습니다. 공개 안내에 ‘즉시 직접 삭제·회원탈퇴 가능’이라고 쓰기 전에 실제 삭제 처리와 지원 절차를 확인해야 합니다.

## 대표님 할 일과 결정

Google 콘솔에서 이름을 다시 입력하실 필요는 없습니다. 이미 저장된 값은 위와 같습니다.

새 서비스 개인정보 안내에는 회사의 보관·삭제 운영 기준이 필요합니다. 기존 기록에 기준이 확인되지 않아 공개 약속을 임의로 확정하지 않았습니다. 초안은 **계정·대화는 고객의 삭제/탈퇴 요청까지 보관하고, ceo@thefa.kr에서 요청을 접수하는 안**을 검토안으로 제시합니다. 실제 삭제 범위·처리기한·업체 및 백업 보관 조건을 함께 확정해야 게시할 수 있습니다.

이번 대표 지시는 ‘그리고 이 부분도 개선 해야지 더파코어로 이동 하게 해야지’이며, 현재 결과는 **브랜드 등록정보 수정 완료 / 실제 Google 표시 반영 미완료**입니다.

## 공식 근거

- https://support.google.com/cloud/answer/15549049?hl=en — 브랜드 초안·검증·게시와 이름 표시.
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google — Google 브랜딩을 통해 프로젝트 ID 대신 이름·로고 표시.
- https://developers.google.com/identity/siwg/best-practices — Google 프로젝트별 브랜딩 공유.
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification — 공개 홈페이지와 개인정보 안내의 요구사항.
