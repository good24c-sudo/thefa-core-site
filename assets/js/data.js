/* ============================================================
   THEFA Core — Content & Demo Data
   Everything the UI renders lives here, separated from markup so a
   real THEFA Core API can replace `demoData` later without touching
   the components.

   IMPORTANT
   - No fabricated metrics, customer counts, testimonials, partners,
     benchmarks, ratings or prices.
   - Every illustrative screen is example data. `label` fields carry
     the honesty badge that the UI must display.
   ============================================================ */

window.BUILDUP_DATA = (function () {
  'use strict';

  /* ---------- labels used to keep real vs. concept honest ---------- */
  var LABELS = {
    concept: { text: 'Concept UI', tone: 'concept' },
    demo: { text: 'Demo', tone: 'demo' },
    example: { text: '예시 데이터', tone: 'concept' },
    preview: { text: 'Preview', tone: 'concept' },
    comingSoon: { text: 'Coming Soon', tone: 'soon' },
    earlyAccess: { text: 'Early Access', tone: 'early' },
    planning: { text: '설계 단계', tone: 'concept' },
    notConnected: { text: '미연결', tone: 'soon' }
  };

  /* ============================================================
     DEPLOYMENT CONFIG — the only block a deployer needs to touch
     ------------------------------------------------------------
     Everything that depends on where this site is hosted, or on which
     back-end services are wired up, lives here. Nothing else in the
     codebase hard-codes a domain, an endpoint or a provider.
     ============================================================ */
  var config = {
    /* 1. Production origin, no trailing slash.
          Used for absolute og:url and the JSON-LD @id values.
          Leave '' and the page falls back to relative URLs, which work
          on any host — including a file:// preview. Fill it in before
          submitting the sitemap to Search Console. */
    siteUrl: 'https://thefacore.com',

    /* 2. Where the contact form goes.
          ''      -> the form composes a complete email addressed to
                     contactEmail and hands it to the visitor's mail app,
                     with a full copy-to-clipboard fallback. Works on
                     every host with no back end. This is the default.
          a URL   -> the form POSTs JSON there instead (Formspree,
                     Netlify Functions, Vercel Functions, Workers, …) and
                     only falls back to mail if that request fails. */
    formEndpoint: '',

    /* Invite-only email authentication is handled by the separate server.
       Social signup remains unavailable. No client-side allowlist or session. */
    authEnabled: true,
    authBaseUrl: 'https://app.thefacore.com',
    consoleLoginUrl: 'https://app.thefacore.com/login.html'
  };

  /* ---------- site-wide ---------- */
  var meta = {
    brand: 'THEFA Core',
    company: 'THE FA',
    legal: '주식회사 더파 (The FA Co., Ltd.)',
    tagline: '한 번의 지시를, 검증된 실행으로.',
    category: 'AI Work OS · 업무 실행 운영체제',
    links: {
      thefa: 'https://thefa.kr',
      thefaContact: 'https://thefa.kr/contact.html',
      thefaPrivacy: 'https://thefa.kr/privacy.html',
      dangolReturn: 'https://thefa.co.kr',
      email: 'thefa@thefa.kr'
    }
  };

  /* ---------- invite-only email sign-in ----------
     The public site only links to consoleLoginUrl. Email verification,
     allowlist checks and HttpOnly sessions belong to the Console server.
     Social signup buttons remain disabled; authEnabled does not arm them. */
  var auth = {
    providers: [
      { id: 'google', label: 'Google로 계속하기' },
      { id: 'microsoft', label: 'Microsoft로 계속하기' },
      { id: 'apple', label: 'Apple로 계속하기' },
      { id: 'github', label: 'GitHub로 계속하기' }
    ],
    notReadyTitle: '간편가입은 준비 중입니다',
    notReadyBody: 'Google·Microsoft·Apple·GitHub 간편가입은 아직 제공하지 않습니다. 사전에 허가된 이메일의 참가자는 별도 로그인 화면에서 이메일 인증 후 Console에 참여할 수 있습니다.',
    emailLabel: '허가된 이메일로 로그인',
    emailHint: '이메일 입력과 인증은 별도 Console 로그인 화면에서 진행합니다. 이 홈페이지에서는 계정 정보를 수집하지 않습니다.'
  };

  /* ---------- contact form ---------- */
  var contactForm = {
    eyebrow: 'CONTACT',
    title: '도입 문의',
    body: '사용 환경과 필요한 실행 범위를 알려주시면, THE FA 담당자가 검토 후 회신드립니다.',
    subjectPrefix: '[THEFA Core 도입 문의]',
    fields: {
      name: '이름',
      company: '회사 · 조직',
      email: '회신받을 이메일',
      phone: '연락처 (선택)',
      topic: '문의 유형',
      scope: '검토 중인 실행 범위',
      message: '문의 내용'
    },
    topics: ['도입 검토 · 상담', '기술 협력 · 연동', 'Early Access 참여', '미디어 · 제휴', '기타 문의'],
    scopes: [
      '개발 · 코드 수정 · QA',
      '조사 · 분석 자료 정리',
      '반복 업무 자동화 설계',
      '화면 기준 QA',
      '기업 업무 흐름',
      '아직 정하지 못했습니다'
    ],
    consent: '회신을 위해 입력한 이름·이메일·문의 내용을 THE FA가 처리하는 것에 동의합니다.',
    consentLink: '개인정보 처리방침',
    submit: '문의 보내기',
    submitting: '보내는 중…',
    required: '필수 항목입니다.',
    invalidEmail: '이메일 주소 형식을 확인해 주세요.',
    needConsent: '회신을 위해 동의가 필요합니다.',
    doneTitle: '문의 메일이 준비되었습니다',
    doneBody: '메일 앱이 열리면 내용을 확인하고 보내주세요. 메일 앱이 열리지 않았다면 아래 내용을 복사해 thefa@thefa.kr 로 보내주셔도 됩니다.',
    doneBodySent: '문의가 접수되었습니다. 담당자가 검토 후 입력하신 이메일 주소로 회신드립니다.',
    fallbackTitle: '메일 앱이 열리지 않았나요?',
    copyBody: '문의 내용 복사',
    copied: '복사했습니다'
  };

  /* ---------- section artwork ----------
     Original vector scenes drawn in the logo's own visual language
     (command prompt, ascending stair, execution nodes, receipt card).
     Not stock photography: no licensing exposure, no 400KB JPEGs, and
     they stay sharp on a 3x display. Each carries real alt text. */
  var art = {
    why: {
      src: 'assets/img/art/why-fragmented.svg',
      w: 880, h: 420,
      alt: '왼쪽은 도구마다 맥락이 끊겨 같은 설명을 반복하는 기존 방식, 오른쪽은 하나의 흐름에서 작업이 이어지고 마지막에 검증 기록이 남는 THEFA Core 방식을 비교한 그림.',
      tag: 'Fig. 01',
      cap: '도구를 늘리는 대신, 하나의 작업을 끝까지 이어갑니다.'
    },
    flow: {
      src: 'assets/img/art/flow-decompose.svg',
      w: 880, h: 520,
      alt: '한 줄의 요청이 다섯 개의 실행 단위로 나뉘고, 각 단위가 확인·실행·대기 상태를 가진 뒤 다시 하나의 검증 기록으로 모이는 구조도.',
      tag: 'Fig. 02',
      cap: '요청 하나가 추적 가능한 실행 단위로 나뉘고, 다시 하나의 기록으로 모입니다.'
    },
    orchestration: {
      src: 'assets/img/art/orchestration-graph.svg',
      w: 880, h: 520,
      alt: 'THEFA Core를 가운데 두고 계획·구현·조사·검토·QA·브라우저·실행 영역이 각각 연결된 오케스트레이션 구조도.',
      tag: 'Fig. 03',
      cap: '개수를 늘리는 구조가 아니라, 충돌 없이 이어가기 위한 배치입니다.'
    },
    verify: {
      src: 'assets/img/art/verify-receipt.svg',
      w: 880, h: 520,
      alt: '네 개의 확인 항목 중 둘은 통과, 하나는 진행 중, 하나는 대기 상태이며 그 결과가 확인 범위와 남은 조건을 함께 담은 Receipt 기록으로 이어지는 그림.',
      tag: 'Fig. 04',
      cap: '통과한 개수가 아니라, 어떤 범위에서 확인했는지를 남깁니다.'
    },
    continuity: {
      src: 'assets/img/art/continuity-resume.svg',
      w: 880, h: 400,
      alt: '실행 중 연결이 끊긴 지점에서 바로 실패로 처리하지 않고, 기존 상태와 checkpoint를 확인한 뒤 남은 작업만 이어가 검증으로 마무리하는 흐름도.',
      tag: 'Fig. 05',
      cap: '끊긴 지점부터 확인하고, 남은 작업만 이어갑니다.'
    },
    resource: {
      src: 'assets/img/art/resource-dispatch.svg',
      w: 880, h: 400,
      alt: '들어온 작업들이 가운데 배치 엔진을 거쳐 성격에 맞는 실행 경로로 나뉘고, 문제가 생긴 경로는 대체 경로로 판단되는 자원 배치 도식.',
      tag: 'Fig. 06',
      cap: '어떤 실행 자원을 쓸지는 THEFA Core가 판단합니다.'
    },
    auth: {
      src: 'assets/img/art/auth-panel.svg',
      w: 560, h: 720,
      alt: '한 줄의 지시가 작업 단위 목록으로 나뉘고 아래쪽 Receipt 카드로 수렴하는 THEFA Core 콘솔 화면 예시.'
    }
  };

  var nav = [
    { label: '제품', href: 'index.html#product' },
    { label: '작동 방식', href: 'index.html#how' },
    { label: 'AI 자원', href: 'index.html#resources' },
    { label: '활용 사례', href: 'index.html#usecases' },
    { label: '보안·검증', href: 'index.html#trust' },
    { label: 'Demo', href: 'demo.html' }
  ];

  /* ---------- 01 HERO ---------- */
  var hero = {
    eyebrow: 'AI WORK OPERATING SYSTEM',
    h1: ['모든 AI와 도구를,', '하나의 Core로.'],
    sub: ['AI에게 질문만 하는 시대에서,', 'AI가 실제 작업을 수행하고 결과까지 검증하는 시대로.'],
    body: 'THE FA Core는 목표와 필요한 회사·프로젝트 기억을 이해하고, AI·Agent·PC·도구를 조합해 실행·QA·결과물·다음 작업까지 연결하는 AI Work OS입니다.',
    flowChip: ['신뢰할 수 있는 실행', '권한 기반 통제', '검증 결과 기록'],
    microcopy: '제품 구조를 설명하기 위한 예시 화면입니다. 실제 연결 범위는 실행 환경과 권한에 따라 달라질 수 있습니다.',
    /* Two hero visual directions, switchable via Tweaks. */
    variants: [
      {
        id: 'command',
        name: 'A · Command 분해형',
        caption: '한 줄의 요청이 실행 단위로 분해되고, QA를 거쳐 Receipt로 수렴하는 구조',
        command: '이번 서비스의 모바일 오류를 찾아 수정하고 배포 전까지 검증해줘.',
        units: [
          { id: 'WU-01', title: '오류 재현', state: 'verified', meta: 'Browser Worker' },
          { id: 'WU-02', title: '원인 분석', state: 'verified', meta: 'Coding AI' },
          { id: 'WU-03', title: '코드 수정', state: 'running', meta: 'Coding AI' },
          { id: 'WU-04', title: '테스트', state: 'waiting', meta: 'Test Worker' },
          { id: 'WU-05', title: '모바일 QA', state: 'waiting', meta: 'QA Worker' }
        ],
        receipt: { title: 'Receipt', state: '검증 대기', detail: 'QA 통과 후 생성' }
      },
      {
        id: 'pipeline',
        name: 'B · 실행 파이프라인형',
        caption: 'Request에서 Receipt까지, 실행 레이어가 순서대로 활성화되는 구조',
        command: '경쟁 서비스를 조사하고 의사결정 자료를 만들어줘.',
        stages: [
          { id: '01', title: 'Request', note: '목표 접수' },
          { id: '02', title: 'Plan', note: '작업 분해' },
          { id: '03', title: 'Worker', note: '실행 주체 배치' },
          { id: '04', title: 'Schedule', note: '순서 조율' },
          { id: '05', title: 'Execute', note: '실제 수행' },
          { id: '06', title: 'Verify', note: 'QA 연결' },
          { id: '07', title: 'Receipt', note: '기록 생성' }
        ]
      }
    ]
  };

  var trustStrip = [
    { k: '01 · UNDERSTAND', v: '복잡한 작업도 정확하게 이해', body: '자연어 지시를 분석해 목표와 필요한 작업을 분해합니다.' },
    { k: '02 · EXECUTE', v: '스스로 계획하고 단계적으로 실행', body: '적합한 AI와 실행 자원을 연결해 하나의 흐름으로 이어갑니다.' },
    { k: '03 · VERIFY', v: '결과를 검증하고 신뢰할 수 있게 전달', body: '실행 결과를 검증하고 근거와 기록을 남깁니다.' }
  ];

  /* ---------- 03 WHY ---------- */
  var why = {
    eyebrow: 'WHY THEFA CORE',
    h2: ['AI가 많아질수록,', '실행은 더 복잡해집니다.'],
    body: '모델마다 다시 설명하고, 작업이 겹치고, 연결이 끊기면 다시 시작하고, 완료 여부는 사람이 확인합니다. THEFA Core는 그 사이를 하나의 실행 흐름으로 정리합니다.',
    problems: [
      { n: '01', title: '맥락 반복', body: '같은 목표를 도구마다 다시 설명하는 시간.', detail: '도구가 늘어날수록 맥락은 파편화됩니다.' },
      { n: '02', title: '중복 실행', body: '여러 AI가 같은 일을 동시에 건드리는 위험.', detail: '누가 어떤 작업을 하는지 겹치면 결과가 섞입니다.' },
      { n: '03', title: '끊김과 재시작', body: '상태 확인 없이 처음부터 다시 돌리는 낭비.', detail: 'timeout 하나로 전체 작업이 초기화됩니다.' },
      { n: '04', title: '완료의 착시', body: '“끝났다”와 “검증됐다”가 섞이는 문제.', detail: '작성됨과 검증됨은 다른 상태입니다.' }
    ],
    closing: '핵심은 AI를 더 많이 호출하는 것이 아니라, 하나의 작업을 끝까지 이어가는 것입니다.'
  };

  /* ---------- 04 CORE FLOW (8) ---------- */
  var coreFlow = {
    eyebrow: 'CORE FLOW',
    h2: ['하나의 요청이,', '검증 가능한 실행 흐름이 됩니다.'],
    body: '요청을 받는 순간부터 결과 기록이 남는 순간까지, THEFA Core는 같은 흐름을 따릅니다.',
    stages: [
      { id: '01', en: 'Request', ko: '요청', body: '목표와 제약을 받습니다.', human: '사용자는 하고 싶은 일을 한 번 말합니다.' },
      { id: '02', en: 'Plan', ko: '계획', body: '큰 작업을 실행 가능한 단위로 나눕니다.', human: '한 문장이 여러 개의 할 일로 정리됩니다.' },
      { id: '03', en: 'Worker', ko: '실행 주체', body: '작업 성격에 맞는 AI·Worker를 선택합니다.', human: '모든 일을 한 AI에게 몰아주지 않습니다.' },
      { id: '04', en: 'Work Unit', ko: '작업 단위', body: '추적 가능한 실행 단위로 관리합니다.', human: '각 단위의 상태를 따로 봅니다.' },
      { id: '05', en: 'Schedule', ko: '조율', body: '순서와 의존관계를 조율합니다.', human: '먼저 되어야 할 일이 먼저 갑니다.' },
      { id: '06', en: 'Execute', ko: '실행', body: '허용된 환경과 도구에서 작업을 수행합니다.', human: '권한이 허용한 범위에서만 움직입니다.' },
      { id: '07', en: 'Verify', ko: '검증', body: '결과를 확인하고 필요한 검증을 연결합니다.', human: '끝났다는 말 대신 확인된 근거를 봅니다.' },
      { id: '08', en: 'Receipt', ko: '기록', body: '무엇이 실행되고 검증됐는지 기록합니다.', human: '다음 판단에 쓸 기록이 남습니다.' }
    ],
    statement: 'Task → Worker / AI → Work Unit → Scheduler → Execution → QA → Receipt'
  };

  /* ---------- 05 INTERACTIVE DEMO (7 steps) ---------- */
  var demo = {
    label: LABELS.demo,
    eyebrow: 'INTERACTIVE DEMO',
    h2: ['직접 눌러서 보는', 'THEFA Core 실행 흐름.'],
    body: '아래 Demo는 실제 서비스 화면이 아니라, THEFA Core가 요청을 어떻게 처리하는지 설명하기 위한 예시 흐름입니다. 단계를 누르거나 자동 재생으로 순서를 확인할 수 있습니다.',
    disclaimer: '제품 동작을 설명하기 위한 Demo · 실제 THEFA Core 백엔드에 연결되어 있지 않습니다. 표시된 모든 상태와 결과는 예시 데이터입니다.',
    request: '이번 서비스의 모바일 오류를 찾아 수정하고 배포 전까지 검증해줘.',
    steps: [
      {
        id: 1, en: 'REQUEST UNDERSTOOD', ko: '요청 이해',
        summary: '한 문장에서 목표·범위·제약을 읽습니다.',
        detail: 'THEFA Core는 요청을 그대로 실행 목록으로 옮기지 않습니다. 먼저 목표(모바일 오류 수정), 종료 조건(배포 전 검증), 제약(운영 환경 접근 범위)을 구분해 기록합니다.',
        payload: [
          { k: '목표', v: '모바일 화면 오류 수정' },
          { k: '종료 조건', v: '배포 전 검증 완료' },
          { k: '범위', v: '서비스 웹 · 모바일 뷰' },
          { k: '사람 승인 필요', v: '배포 실행' }
        ]
      },
      {
        id: 2, en: 'TASK DECOMPOSITION', ko: 'Task 분해',
        summary: '큰 요청을 실행 가능한 작업으로 나눕니다.',
        detail: '나눈 단위는 각각 시작 조건과 완료 조건을 가집니다. 앞 단위의 결과가 다음 단위의 입력이 되는 의존관계도 함께 정리합니다.',
        tasks: [
          '오류 재현', '원인 분석', '코드 수정', '테스트', '모바일 QA', '최종 검증'
        ]
      },
      {
        id: 3, en: 'WORKER / AI PLACEMENT', ko: 'Worker · AI 배치',
        summary: '작업 성격에 맞는 실행 주체를 연결합니다.',
        detail: '모든 작업을 하나의 모델에 보내지 않습니다. 분석·수정·브라우저 확인·검토처럼 성격이 다른 작업은 다른 실행 주체에 배치됩니다. 특정 AI 제공사와의 공식 제휴를 의미하지 않습니다.',
        workers: [
          { name: 'Planner', role: '작업 분해 · 순서 결정', state: 'ready' },
          { name: 'Coding AI', role: '코드 수정 · 테스트 작성', state: 'ready' },
          { name: 'Browser QA Worker', role: '실제 화면 기준 확인', state: 'waiting' },
          { name: 'Reviewer', role: '변경 범위 검토', state: 'waiting' }
        ],
        note: 'Worker 종류는 실행 환경과 권한 정책에 따라 달라질 수 있습니다.'
      },
      {
        id: 4, en: 'WORK UNIT', ko: 'Work Unit',
        summary: '각 작업을 추적 가능한 실행 단위로 바꿉니다.',
        detail: '단위마다 담당 실행 주체, 입력, 완료 조건, 검증 방법이 붙습니다. 완료 조건이 비어 있는 단위는 실행되지 않습니다.',
        units: [
          { id: 'WU-01', title: '오류 재현', owner: 'Browser QA Worker', done: '동일 조건 재현 기록', state: 'verified' },
          { id: 'WU-02', title: '원인 분석', owner: 'Planner', done: '원인 후보와 근거', state: 'verified' },
          { id: 'WU-03', title: '코드 수정', owner: 'Coding AI', done: '변경 파일과 요약', state: 'running' },
          { id: 'WU-04', title: '테스트', owner: 'Coding AI', done: '테스트 실행 결과', state: 'waiting' },
          { id: 'WU-05', title: '모바일 QA', owner: 'Browser QA Worker', done: '390px 기준 확인', state: 'waiting' }
        ]
      },
      {
        id: 5, en: 'EXECUTION', ko: '실행',
        summary: '허용된 환경에서 실제 작업을 수행합니다.',
        detail: '실행 중에는 진행 상태와 대기 이유를 함께 기록합니다. 연결이 끊기거나 실행 자원에 문제가 생기면, 처음부터 다시 돌리기 전에 기존 상태를 먼저 확인합니다.',
        stream: [
          { t: '00:00', text: 'WU-01 오류 재현 시작', state: 'done' },
          { t: '00:41', text: '재현 조건 기록 · 390px 뷰 기준', state: 'done' },
          { t: '01:02', text: 'WU-02 원인 후보 정리', state: 'done' },
          { t: '02:18', text: 'WU-03 코드 수정 진행', state: 'running' },
          { t: '—', text: 'WU-04 테스트 대기 (선행 의존)', state: 'waiting' }
        ],
        note: '표시된 시간과 진행 상태는 설명을 위한 예시 값입니다.'
      },
      {
        id: 6, en: 'QA', ko: 'QA',
        summary: '결과를 확인 가능한 근거와 연결합니다.',
        detail: '작성 여부와 검증 여부를 분리합니다. 한 환경에서 통과한 사실이 전체 완료를 의미하지 않으므로, 확인 범위를 함께 기록합니다.',
        checks: [
          { name: '변경 범위 확인', result: '통과', scope: '수정된 파일 기준' },
          { name: '테스트 실행', result: '통과', scope: '로컬 환경' },
          { name: '모바일 화면 확인', result: '진행 중', scope: '360 / 390 / 430px' },
          { name: '배포 전 최종 검증', result: '대기', scope: '사람 승인 후' }
        ],
        note: '로컬 통과 ≠ 최종 완료.'
      },
      {
        id: 7, en: 'RECEIPT', ko: 'Receipt',
        summary: '무엇이 실행되고 검증됐는지 기록합니다.',
        detail: 'Receipt는 성공 선언이 아니라 기록입니다. 실행된 단위, 확인된 범위, 남은 조건, 다음 행동을 함께 남겨 다음 판단의 근거로 씁니다.',
        fields: [
          { k: 'Work Unit', v: 'WU-01 ~ WU-05' },
          { k: 'Result', v: '수정 적용 · 검증 진행 중' },
          { k: 'QA State', v: '2 / 4 확인' },
          { k: 'Evidence', v: '재현 기록 · 테스트 로그 · 화면 확인' },
          { k: 'Next Action', v: '배포 전 사람 승인 요청' }
        ],
        note: '예시 데이터 · 실제 연결 환경에 따라 증거 형태는 달라질 수 있습니다.'
      }
    ]
  };

  /* ---------- 06 BEFORE / AFTER ---------- */
  var beforeAfter = {
    eyebrow: 'BEFORE / AFTER',
    h2: ['답변을 생성하는 AI에서,', '일을 끝내는 AI 운영체제로.'],
    body: '같은 요청을 받았을 때 사람이 어디까지 개입해야 하는지가 다릅니다.',
    before: {
      label: '기존 방식',
      steps: ['사람이 질문', 'AI가 답변', '사람이 실행', '사람이 테스트', '사람이 결과 확인'],
      note: '답변은 받았지만, 일은 아직 사람에게 남아 있습니다.'
    },
    after: {
      label: 'THEFA Core',
      steps: ['사람이 목표 전달', '작업 분해', 'AI / Worker 실행', 'QA', '검증', '결과 기록'],
      note: '사람은 목표와 승인에 집중합니다.'
    },
    footnote: '“완전 무인 자동화”가 아닙니다. 실행 범위는 연결된 환경과 권한 정책에 따라 달라지며, 중요한 변경에는 사람의 승인이 필요할 수 있습니다.'
  };

  /* ---------- 07 MULTI-AI ORCHESTRATION ---------- */
  var orchestration = {
    eyebrow: 'ORCHESTRATION',
    h2: ['AI 하나가 아니라,', '작업에 맞는 실행 조합.'],
    body: '특정 모델에 종속되지 않고, 작업 성격에 따라 여러 실행 주체를 배치합니다. 개수를 늘리는 것이 목적이 아니라 충돌 없이 이어가는 것이 핵심입니다.',
    domains: [
      { title: 'Planning', body: '작업 분해와 순서 설계', tag: '분해' },
      { title: 'Coding', body: '구현 · 수정 · 테스트 작성', tag: '구현' },
      { title: 'Research', body: '자료 수집과 정리', tag: '조사' },
      { title: 'Review', body: '변경 범위와 품질 검토', tag: '검토' },
      { title: 'QA', body: '결과 확인과 검증 연결', tag: '검증' },
      { title: 'Browser', body: '실제 화면 기준 확인', tag: '화면' },
      { title: 'PC Execution', body: '허용된 환경에서의 실행', tag: '실행' }
    ],
    disclaimer: '위 항목은 THEFA Core가 다루는 실행 영역의 개념 설명입니다. 특정 AI 제공사와의 공식 제휴·연동을 의미하지 않으며, 실제 연결 범위는 실행 환경과 권한 정책에 따라 달라집니다.',
    principle: '선택은 THEFA Core가, 판단의 기준은 사용자가.'
  };

  /* ---------- 08 EXECUTION MODES ---------- */
  var modes = {
    eyebrow: 'EXECUTION MODES',
    h2: ['작업의 무게에 따라,', '실행 방식도 달라집니다.'],
    body: '아래는 THEFA Core의 실행 개념입니다. 현재 공개된 요금제나 확정된 기능 목록이 아닙니다.',
    badge: LABELS.concept,
    items: [
      { id: 'FAST', ko: '빠른 처리', body: '일반적인 업무를 빠르게 처리합니다.', when: '범위가 분명하고 되돌리기 쉬운 작업', guard: '확인이 필요한 변경은 별도 단계로 분리' },
      { id: 'STANDARD', ko: '표준 처리', body: '추가 검토와 검증이 필요한 작업을 처리합니다.', when: '결과가 다른 작업에 영향을 주는 경우', guard: '검증 단계와 기록을 기본으로 연결' },
      { id: 'ALL-HANDS', ko: '확장 처리', body: '복잡한 문제에서 여러 Worker와 검토 단계를 활용합니다.', when: '원인 후보가 여러 개이거나 비교가 필요한 경우', guard: '승인 지점과 자원 정책을 함께 적용' }
    ],
    footnote: '실행 모드별 공개 범위와 제공 시점은 실행 환경과 권한 정책에 따라 달라질 수 있습니다.'
  };

  /* ---------- 09 VERIFY / QA ---------- */
  var verify = {
    eyebrow: 'VERIFY THE RESULT',
    h2: ['끝났다는 말보다,', '검증된 결과를 남깁니다.'],
    body: 'THEFA Core는 실행 종료와 검증 완료를 같은 상태로 보지 않습니다.',
    statements: [
      { en: 'CODE WRITTEN ≠ VERIFIED', ko: '작성됨 ≠ 검증됨', body: '코드가 작성됐다고 검증된 것은 아닙니다.' },
      { en: 'LOCAL PASS ≠ COMPLETE', ko: '로컬 통과 ≠ 최종 완료', body: '한 환경에서 통과했다고 전체 완료는 아닙니다.' },
      { en: 'COMPLETED ≠ VERIFIED', ko: '실행 종료 ≠ 검증 완료', body: '완료 표시와 검증 완료는 다릅니다.' }
    ],
    receipt: {
      badge: LABELS.example,
      title: 'Execution Receipt',
      subtitle: '예시 데이터 · 실제 기록 형식은 연결 환경에 따라 달라집니다.',
      fields: [
        { k: 'Work Unit', v: 'WU-03 · 코드 수정', state: 'verified' },
        { k: 'Result', v: '변경 적용 완료', state: 'verified' },
        { k: 'QA State', v: '2 / 4 확인', state: 'qa' },
        { k: 'Evidence', v: '재현 기록 · 테스트 로그 · 화면 캡처', state: 'verified' },
        { k: 'Next Action', v: '배포 전 사람 승인 요청', state: 'waiting' }
      ],
      trail: [
        { label: 'Execution', state: 'done' },
        { label: 'QA', state: 'done' },
        { label: 'Verification', state: 'active' },
        { label: 'Receipt', state: 'pending' }
      ]
    },
    caution: 'THEFA Core는 “100% 정확”, “실패 없음”, “완벽한 코드”를 보장하지 않습니다. 검증 범위와 결과는 연결된 환경과 확인 절차에 따라 달라집니다.'
  };

  /* ---------- 10 CONTINUITY ---------- */
  var continuity = {
    eyebrow: 'CONTINUITY',
    h2: ['연결이 끊겼다고,', '작업까지 사라진 것은 아닙니다.'],
    body: 'THEFA Core는 timeout이나 disconnect를 곧바로 실패로 취급하지 않습니다. 기존 작업 상태, checkpoint, 결과 기록을 먼저 확인하고 다음 행동을 결정하는 흐름을 지향합니다.',
    timeline: [
      { id: 'RUNNING', ko: '실행 중', body: '작업 단위와 상태가 기록됩니다.', state: 'running' },
      { id: 'CONNECTION LOST', ko: '연결 끊김', body: '즉시 실패로 단정하지 않습니다.', state: 'waiting' },
      { id: 'RECONCILE', ko: '상태 확인', body: '기존 상태·checkpoint·기록을 확인합니다.', state: 'qa' },
      { id: 'RESUME / VERIFIED', ko: '이어가기 또는 검증', body: '남은 작업만 이어가거나 결과를 확정합니다.', state: 'verified' }
    ],
    callout: '이미 끝난 일을 처음부터 다시 실행하는 위험을 낮춥니다.',
    caution: '중복 실행이 0이라고 보장하지 않습니다. 확인 절차를 우선한다는 원칙입니다.'
  };

  /* ---------- 11 RESOURCE INTELLIGENCE ---------- */
  var resource = {
    eyebrow: 'RESOURCE INTELLIGENCE',
    h2: ['어떤 AI를 쓸지 고민하는 대신,', '해야 할 일을 말합니다.'],
    body: '실행 자원을 고르고 조율하는 일은 THEFA Core가 맡습니다. 사용자는 목표와 기준만 정하면 됩니다.',
    message: '어떤 AI를 쓸지 고민하는 대신, 해야 할 일을 말한다.',
    items: [
      { title: 'AI 선택', body: '작업 성격에 맞는 실행 주체를 고릅니다.' },
      { title: 'Worker 배치', body: '동시에 처리할 일과 순서가 있는 일을 나눕니다.' },
      { title: '작업 순서', body: '의존관계를 기준으로 실행 순서를 정합니다.' },
      { title: '실행 자원', body: '허용된 환경과 자원 정책 안에서 실행합니다.' },
      { title: 'Failover', body: '한 실행 경로에 문제가 생기면 대체 경로를 판단합니다.' },
      { title: '검증', body: '결과를 확인 가능한 근거와 연결합니다.' }
    ],
    faqish: 'Provider Failover는 특정 실행 경로의 문제를 전체 작업 실패로 단정하지 않기 위한 개념이며, 항상 대체 경로가 존재한다는 의미는 아닙니다.'
  };

  /* ---------- 12 USE CASES ---------- */
  var useCases = {
    eyebrow: 'USE CASES',
    h2: ['반복되는 AI 작업을,', '운영 가능한 흐름으로.'],
    body: '각 사례는 아이콘이 아니라 입력 · 처리 · 출력 구조로 봅니다.',
    items: [
      {
        title: '개발', badge: LABELS.concept,
        request: '“웹 서비스 오류를 수정하고 모바일까지 검증해줘.”',
        input: ['오류 증상', '대상 화면', '검증 기준'],
        process: ['오류 재현', '원인 분석', '코드 수정', '테스트', '모바일 QA'],
        output: ['변경 요약', '검증 범위 기록', '남은 조건']
      },
      {
        title: '조사·분석', badge: LABELS.concept,
        request: '“경쟁 서비스를 조사하고 의사결정 자료를 만들어줘.”',
        input: ['조사 질문', '비교 기준', '자료 범위'],
        process: ['자료 수집', '역할 분담', '교차 확인', '정리'],
        output: ['비교 자료', '근거 출처', '확인 필요 항목']
      },
      {
        title: '운영 자동화', badge: LABELS.concept,
        request: '“반복되는 업무를 찾아 실행 흐름으로 만들어줘.”',
        input: ['반복 업무 목록', '승인 필요 지점', '실행 환경'],
        process: ['업무 분해', 'Work Unit 구성', '승인 단계 연결'],
        output: ['실행 흐름 정의', '승인 지점 목록', '기록 항목']
      },
      {
        title: 'QA', badge: LABELS.concept,
        request: '“현재 버전에서 문제가 있는지 실제 화면 기준으로 검사해줘.”',
        input: ['대상 버전', '확인 화면', '기준 너비'],
        process: ['화면 확인', '오류 목록화', '재현 조건 기록'],
        output: ['문제 목록', '재현 조건', '심각도 분류']
      },
      {
        title: '기업 업무', badge: LABELS.concept,
        request: '“자료를 모아 분석하고 다음 실행 항목까지 정리해줘.”',
        input: ['자료 출처', '분석 목적', '공유 대상'],
        process: ['자료 수집', '분석', '검토', '실행 항목 정리'],
        output: ['분석 요약', '다음 실행 항목', '승인 요청 목록']
      }
    ],
    footnote: '모든 업무를 자동화한다는 의미가 아닙니다. 실행 범위는 연결된 환경과 권한 정책에 따라 달라집니다.'
  };

  /* ---------- 13 CONSOLE PREVIEW ---------- */
  var consolePreview = {
    eyebrow: 'CONSOLE PREVIEW',
    h2: ['복잡한 실행을,', '한눈에 보이는 작업 단위로.'],
    body: 'Core Console은 요청·실행·검증 기록을 한 화면에서 확인하는 자리입니다. 아래는 향후 구조를 보여주는 Preview입니다.',
    badge: LABELS.preview,
    note: 'Preview · 이 화면의 수치와 상태는 예시 데이터입니다. 초대 참가자용 Console은 별도 이메일 인증 후 접근합니다.',
    nav: ['Home', 'Tasks', 'Runs', 'Workers', 'Resources', 'QA', 'Receipts', 'Connections', 'Settings'],
    request: '이번 서비스의 모바일 오류를 찾아 수정하고 배포 전까지 검증해줘.',
    stages: [
      { id: '01', label: 'Request', state: 'verified' },
      { id: '02', label: 'Plan', state: 'verified' },
      { id: '03', label: 'Workers', state: 'running' },
      { id: '04', label: 'Execute', state: 'running' },
      { id: '05', label: 'QA', state: 'waiting' },
      { id: '06', label: 'Receipt', state: 'waiting' }
    ],
    workers: [
      { name: 'Planner', state: 'verified', load: '완료' },
      { name: 'Coding AI', state: 'running', load: '실행 중' },
      { name: 'Browser QA Worker', state: 'waiting', load: '대기' },
      { name: 'Reviewer', state: 'waiting', load: '대기' }
    ],
    units: [
      { id: 'WU-01', title: '오류 재현', owner: 'Browser QA Worker', state: 'verified' },
      { id: 'WU-02', title: '원인 분석', owner: 'Planner', state: 'verified' },
      { id: 'WU-03', title: '코드 수정', owner: 'Coding AI', state: 'running' },
      { id: 'WU-04', title: '테스트', owner: 'Coding AI', state: 'waiting' },
      { id: 'WU-05', title: '모바일 QA', owner: 'Browser QA Worker', state: 'waiting' },
      { id: 'WU-06', title: '최종 검증', owner: 'Reviewer', state: 'waiting' }
    ],
    qa: [
      { name: '변경 범위 확인', state: 'verified' },
      { name: '테스트 실행', state: 'verified' },
      { name: '모바일 화면 확인', state: 'qa' },
      { name: '배포 전 최종 검증', state: 'waiting' }
    ],
    receipt: {
      id: 'RCPT-0001',
      state: 'partial',
      stateText: '검증 진행 중',
      lines: [
        { k: '실행 단위', v: 'WU-01 ~ WU-06' },
        { k: '적용된 변경', v: '1건 (요약 제공)' },
        { k: '확인된 범위', v: '2 / 4' },
        { k: '남은 조건', v: '사람 승인 · 배포 전 검증' }
      ]
    },
    tabs: {
      plan: { title: 'Plan', body: '요청이 어떤 단위로 나뉘었는지 확인합니다.', rows: ['오류 재현', '원인 분석', '코드 수정', '테스트', '모바일 QA', '최종 검증'] },
      run: { title: 'Run', body: '지금 실행 중인 단위와 대기 이유를 확인합니다.', rows: ['WU-03 실행 중', 'WU-04 선행 의존 대기', 'WU-05 대기'] },
      verify: { title: 'Verify', body: '확인된 범위와 남은 조건을 확인합니다.', rows: ['변경 범위 확인 · 통과', '테스트 실행 · 통과', '모바일 화면 확인 · 진행 중'] },
      receipt: { title: 'Receipt', body: '무엇이 실행되고 검증됐는지 기록을 봅니다.', rows: ['RCPT-0001 · 검증 진행 중', 'Evidence 3건', 'Next Action: 사람 승인'] }
    }
  };

  /* ---------- 14 TRUST ---------- */
  var trust = {
    eyebrow: 'TRUST & CONTROL',
    h2: ['실행에는 기록이,', '기록에는 기준이 필요합니다.'],
    body: 'THEFA Core는 사람이 통제할 수 있는 실행 구조를 지향합니다. 아래는 제품이 따르는 원칙입니다.',
    pillars: [
      { title: '사람의 승인', body: '중요한 변경은 사람이 확인하고 승인합니다.' },
      { title: '실행 기록', body: '무엇이 실행됐는지 기록으로 남습니다.' },
      { title: '작업 상태', body: '각 단위의 현재 상태를 따로 확인합니다.' },
      { title: '검증 단계', body: '실행 종료와 검증 완료를 구분합니다.' },
      { title: 'Receipt', body: '결과와 남은 조건을 함께 기록합니다.' },
      { title: '권한 분리', body: '허용된 범위 밖의 실행은 하지 않습니다.' }
    ],
    note: '구체적인 보안 구성·내부 운영 정책은 공개하지 않습니다. 도입 검토 시 별도 협의 절차를 따릅니다.',
    disclosure: 'THEFA Core는 “100% 자동”, “무조건 성공”, “무인 실행”을 주장하지 않습니다.'
  };

  /* ---------- 15 EARLY ACCESS ---------- */
  var earlyAccess = {
    eyebrow: 'EARLY ACCESS',
    h2: ['가격표 대신,', '도입 검토부터 시작합니다.'],
    body: 'THEFA Core의 요금제와 공개 범위는 아직 확정되지 않았습니다. 확인되지 않은 가격을 게시하지 않습니다. 대신 사용 환경과 필요한 실행 범위를 알려주시면 도입 검토를 함께 진행합니다.',
    audiences: [
      { title: '개발팀', body: '여러 AI 도구를 함께 쓰면서 작업 상태와 검증 기록이 필요한 팀', need: '실행 추적 · 검증 기록' },
      { title: '스타트업', body: '반복 작업을 실행 흐름으로 정리하고 싶은 초기 팀', need: '업무 분해 · 자동화 설계' },
      { title: '기업', body: '승인 절차와 권한 분리가 필요한 조직', need: '권한 정책 · 기록 체계' },
      { title: '검토 조직', body: 'AI 기반 업무 자동화를 검토 중인 조직', need: '개념 검증 · 파일럿 범위' }
    ],
    cta: '도입 문의하기',
    ctaSecondary: 'Early Access 안내 보기',
    status: LABELS.earlyAccess,
    /* Rendered as: 가격 · 별도 문의 (확정 전) — <note>
       The old copy repeated "별도 문의" twice in one line because the
       renderer concatenated priceNote and note, and note said the same
       thing again. */
    note: '사용 환경과 실행 범위를 확인한 뒤 함께 정합니다.',
    priceNote: '별도 문의 (확정 전)'
  };

  /* ---------- 16 DEVELOPMENT STAGES ---------- */
  var stages = {
    eyebrow: 'DEVELOPMENT STAGES',
    h2: ['공개할 수 있는 범위를', '있는 그대로 적었습니다.'],
    body: '부풀린 진행률 대신 현재 상태를 그대로 표기합니다. 실제 연결 기능이 추가되면 이 표기도 함께 갱신됩니다.',
    updated: '2026년 10월 기준',
    items: [
      { status: 'Concept', title: '실행 흐름 구조', body: 'Request → Plan → Worker → Work Unit → Schedule → Execute → Verify → Receipt 흐름 정의.' },
      { status: 'Concept', title: 'Multi-AI Orchestration', body: '작업 성격에 따른 실행 주체 배치 개념 정리.' },
      { status: 'Preview', title: 'Core Console', body: 'Tasks · Runs · Workers · QA · Receipts 화면 구조 설계.' },
      { status: 'Preview', title: 'Verification · Receipt', body: '검증 범위와 결과 기록 형식 설계.' },
      { status: 'Early Access', title: '초대 참가자 Console', body: '사전에 허가된 이메일의 참가자만 이메일 인증 후 접근. 간편가입은 준비 중.' },
      { status: 'Early Access', title: '도입 검토 접수', body: '사용 환경과 실행 범위 상담 접수 중.' }
    ],
    note: '위 항목은 제품 구조 설명용이며, 확정된 출시 일정이나 기능 보장이 아닙니다.'
  };

  /* ---------- 17 THE FA ---------- */
  var thefa = {
    eyebrow: 'BUILT BY THE FA',
    h2: ['THEFA Core는', 'THE FA가 만드는 실행 기반입니다.'],
    body: 'THE FA는 여러 AI와 실제 실행을 연결해, 한 번의 지시가 검증 가능한 진전으로 이어지는 구조를 만듭니다.',
    tagline: 'One Command. Many AI. Real Progress.',
    links: [
      { label: 'THE FA 알아보기', href: 'https://thefa.kr', external: true },
      { label: '단골리턴 보기', href: 'https://thefa.co.kr', external: true }
    ],
    entity: 'THEFA Core by THE FA'
  };

  /* ---------- 18 FAQ ---------- */
  var faq = {
    eyebrow: 'FAQ',
    h2: '자주 묻는 질문',
    items: [
      { q: 'THEFA Core는 무엇인가요?', a: '사용자의 요청을 실행 가능한 작업 단위로 나누고, 적합한 AI와 실행 자원을 연결한 뒤, 실행과 검증 결과까지 하나의 흐름으로 이어주는 THE FA의 AI 실행 운영체제입니다.' },
      { q: 'ChatGPT 같은 AI와 무엇이 다른가요?', a: '답변을 생성하는 도구가 아니라, 작업을 분해하고 실행 주체에 배분하고 검증과 결과 기록까지 연결하는 실행 운영체제입니다. 모델 하나를 대체하는 것이 목적이 아닙니다.' },
      { q: '여러 AI를 사용할 수 있나요?', a: '필요하면 여러 AI·Worker를 사용할 수 있지만, 핵심은 개수를 늘리는 것이 아니라 작업에 맞게 배분하고 충돌 없이 이어가는 것입니다. 특정 AI 제공사와의 공식 제휴를 의미하지 않습니다.' },
      { q: 'THEFA Core가 모든 작업을 자동으로 실행하나요?', a: '아닙니다. 실제 실행 범위는 연결된 환경과 권한 정책에 따라 달라지며, 중요한 변경에는 별도 승인이나 검증 단계가 필요할 수 있습니다. “완전 무인 자동화”를 주장하지 않습니다.' },
      { q: '실행 결과는 어떻게 확인하나요?', a: '실행 종료와 검증 완료를 다른 상태로 봅니다. 확인된 범위, 근거, 남은 조건을 Receipt 기록으로 함께 남기는 흐름을 지향합니다.' },
      { q: '개발 업무에만 사용할 수 있나요?', a: '개발 흐름이 대표적인 활용 예이지만, 작업을 분해하고 실행·검증·기록할 수 있는 다양한 업무 흐름으로 확장할 수 있습니다. 모든 업무의 자동화를 의미하지는 않습니다.' },
      { q: '기업에서도 사용할 수 있나요?', a: '승인 절차, 실행 기록, 권한 분리가 필요한 조직을 주요 검토 대상으로 봅니다. 구체적인 보안 구성은 도입 검토 시 별도 협의 절차를 따릅니다.' },
      { q: '현재 바로 사용할 수 있나요?', a: '홈페이지와 Interactive Demo는 공개되어 있습니다. 초대 참가자용 Console은 사전에 허가된 이메일의 인증 후 접근할 수 있습니다. 간편가입은 준비 중이며, 실제 실행 범위는 Console에 표시된 연결 상태와 검증 범위를 확인해 주세요.' },
      { q: '도입하려면 어떻게 해야 하나요?', a: '도입 문의를 통해 사용 환경과 필요한 실행 범위를 알려주세요. THE FA 담당자를 통해 회신드립니다.' }
    ]
  };

  /* ---------- 19 FINAL CTA ---------- */
  var finalCta = {
    h2: ['해야 할 일을 설명하세요.', 'THEFA Core가 실행 가능한 작업으로 바꿉니다.'],
    body: ['한 번의 지시에서,', '실행과 검증된 결과까지.'],
    primary: 'THEFA Core 체험하기',
    secondary: '도입 문의'
  };

  /* ---------- 20 FOOTER ---------- */
  var footer = {
    product: [
      { label: '제품 개요', href: 'index.html#product' },
      { label: 'Interactive Demo', href: 'demo.html' },
      { label: '작동 방식', href: 'index.html#how' },
      { label: 'Console Preview', href: 'console.html' },
      { label: '도입 문의', href: 'contact.html' }
    ],
    company: [
      { label: 'THE FA 홈페이지', href: 'https://thefa.kr', external: true },
      { label: '단골리턴', href: 'https://thefa.co.kr', external: true },
      { label: '도입 문의', href: 'contact.html' }
    ],
    legal: [
      { label: 'Privacy', href: 'https://thefa.kr/privacy.html', external: true },
      { label: 'Terms', href: 'contact.html#terms' },
      { label: 'Contact', href: 'contact.html' }
    ],
    service: [
      { label: '로그인', href: 'login.html' },
      { label: 'Early Access', href: 'signup.html' }
    ],
    copyright: '© 2026 THE FA. All rights reserved.'
  };

  /* ---------- state word map (Korean-first status labels) ---------- */
  var stateKo = {
    verified: '확인됨', running: '실행 중', waiting: '대기',
    qa: '검증 중', idle: '미배치', ready: '준비', partial: '진행 중', done: '완료'
  };

  /* ---------- analytics (event names only, no provider) ---------- */
  var analyticsEvents = [
    'hero_demo_click', 'nav_demo_click', 'demo_start', 'demo_step_complete',
    'demo_autoplay_toggle', 'contact_click', 'login_click', 'early_access_click',
    'console_preview_open', 'faq_open', 'thefa_link_click',
    'sso_click', 'contact_submit', 'contact_copy', 'email_copy'
  ];

  /* ---------- Demo-facing API shape (for future real backend) ---------- */
  var apiContract = {
    note: 'UI는 아래 형태의 데이터를 기대합니다. 실제 연결 시 이 객체만 교체하면 화면 구조는 그대로 사용할 수 있습니다.',
    endpoints: [
      { method: 'POST', path: '/v1/requests', returns: '{ requestId, units[], workers[] }' },
      { method: 'GET', path: '/v1/runs/:id', returns: '{ stages[], units[], qa[] }' },
      { method: 'GET', path: '/v1/receipts/:id', returns: '{ receiptId, result, qaState, evidence[], nextAction }' }
    ]
  };

  return {
    config: config, auth: auth, contactForm: contactForm, art: art,
    LABELS: LABELS, stateKo: stateKo, meta: meta, nav: nav, hero: hero, trustStrip: trustStrip,
    why: why, coreFlow: coreFlow, demo: demo, beforeAfter: beforeAfter,
    orchestration: orchestration, modes: modes, verify: verify, continuity: continuity,
    resource: resource, useCases: useCases, consolePreview: consolePreview, trust: trust,
    earlyAccess: earlyAccess, stages: stages, thefa: thefa, faq: faq,
    finalCta: finalCta, footer: footer, analyticsEvents: analyticsEvents,
    apiContract: apiContract
  };
})();

