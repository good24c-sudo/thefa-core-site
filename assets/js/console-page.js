/* ============================================================
   THEFA Core — console.html controller
   9 Console areas, all example data. Nothing is connected.
   ============================================================ */

(function () {
  'use strict';

  var D = window.BUILDUP_DATA;
  if (!D) return;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function badge(l) {
    if (!l) return '';
    return '<span class="badge badge--' + (l.tone || 'concept') + '">' + esc(l.text) + '</span>';
  }
  function status(st, t) {
    return '<span class="status" data-state="' + st + '">' + esc(t) + '</span>';
  }
  function demoBadge() { return badge(D.LABELS.demo); }

  var STATE_KO = window.buildupStateKo || {
    verified: '확인됨', running: '실행 중', waiting: '대기',
    qa: '검증 중', idle: '미배치', partial: '진행 중'
  };

  var DEMO = {
    project: '데모 요청 · 모바일 오류 수정 및 배포 전 검증',
    tasks: [
      { a: 'T-01 · 오류 재현', b: 'Browser QA Worker', c: '완료 조건 · 동일 조건 재현 기록 확보', state: 'verified' },
      { a: 'T-02 · 원인 분석', b: 'Planner', c: '완료 조건 · 원인 후보와 근거 정리', state: 'verified' },
      { a: 'T-03 · 코드 수정', b: 'Coding AI', c: '완료 조건 · 변경 파일과 요약 생성', state: 'running' },
      { a: 'T-04 · 테스트', b: 'Coding AI', c: '의존 · T-03 완료 후 실행', state: 'waiting' },
      { a: 'T-05 · 모바일 QA', b: 'Browser QA Worker', c: '확인 범위 · 360 / 390 / 430px', state: 'waiting' },
      { a: 'T-06 · 최종 검증', b: 'Reviewer', c: '사람 승인 필요 · 배포 실행 전', state: 'waiting' }
    ],
    runs: [
      { a: 'RUN-0007', b: '현재 실행', c: 'WU-03 진행 · WU-04 선행 의존 대기', state: 'running' },
      { a: 'RUN-0006', b: '기록 완료', c: '오류 재현 · 원인 분석 단계 종료', state: 'verified' },
      { a: 'RUN-0005', b: '중단 · 상태 확인', c: '연결 끊김 이후 재개 판단 대기', state: 'waiting' }
    ],
    workers: D.consolePreview.workers.map(function (w) {
      return { a: w.name, b: '상태 · ' + w.load, c: w.role || w.load, state: w.state };
    }).concat([
      { a: 'Research Worker', b: '대기', c: '자료 수집 · 정리', state: 'idle' },
      { a: 'PC Execution Worker', b: '대기', c: '허용된 실행 환경에서의 작업', state: 'idle' }
    ]),
    resources: [
      { name: '동시 실행 한도', value: '정책으로 제한', sub: '무리한 동시 실행을 줄이기 위한 개념' },
      { name: '실행 환경', value: '허용된 범위만', sub: '권한 정책 밖의 실행은 수행하지 않음' },
      { name: 'Failover', value: '대체 경로 판단', sub: '항상 대체 경로가 존재한다는 의미는 아님' },
      { name: 'Checkpoint', value: '중단 후 확인', sub: '처음부터 재실행하기 전 상태 확인' }
    ],
    connections: [
      { name: 'THEFA Core 계정', state: '미연결', sub: '계정 기능 준비 중' },
      { name: '저장소 연결', state: '미연결', sub: '연결 시 권한 범위를 함께 설정' },
      { name: '브라우저 실행 환경', state: '미연결', sub: '허용된 환경에서만 실행' },
      { name: '알림 채널', state: '미연결', sub: '승인 요청 전달용' }
    ],
    receipts: [
      { a: 'RCPT-0001', b: '현재 기록', c: '확인 2 / 4 · 남은 조건 있음', state: 'qa' },
      { a: 'RCPT-0000', b: '기록 완료', c: '오류 재현 단계 기록', state: 'verified' }
    ]
  };

  var AREAS = [
    { key: 'home', label: 'Home', path: '/home' },
    { key: 'tasks', label: 'Tasks', path: '/tasks/current' },
    { key: 'runs', label: 'Runs', path: '/runs' },
    { key: 'workers', label: 'Workers', path: '/workers' },
    { key: 'resources', label: 'Resources', path: '/resources' },
    { key: 'qa', label: 'QA', path: '/qa' },
    { key: 'receipts', label: 'Receipts', path: '/receipts' },
    { key: 'connections', label: 'Connections', path: '/connections' },
    { key: 'settings', label: 'Settings', path: '/settings' }
  ];

  function head(title, body) {
    return '<div class="console-view__head">' +
      '<h2>' + esc(title) + '</h2>' +
      '<p>' + esc(body) + '</p>' +
    '</div>';
  }

  function table(rows) {
    return '<div class="table-simple">' +
      rows.map(function (r) {
        return '<div class="table-simple__row">' +
          '<span class="table-simple__k">' + esc(r.a) +
            '<span class="table-simple__sub">' + esc(r.b) + '</span></span>' +
          '<span class="table-simple__sub" style="margin:0;font-family:var(--font-sans);font-size:var(--fs-caption)">' + esc(r.c) + '</span>' +
          status(r.state, STATE_KO[r.state] || r.state) +
        '</div>';
      }).join('') + '</div>';
  }

  var VIEWS = {
    home: function () {
      var c = D.consolePreview;
      return '<div class="console-view">' +
        head('Home', '요청 하나가 어디까지 진행됐는지 요약해 보여주는 화면입니다.') +
        '<div class="console-req">' +
          '<span class="console-req__label">현재 요청 · 예시 데이터</span>' +
          '<p>' + esc(c.request) + '</p>' +
        '</div>' +
        '<div class="stage-rail" aria-label="실행 단계">' + c.stages.map(function (s) {
          return '<div class="stage-rail__item" data-state="' + s.state + '">' +
            '<span class="stage-rail__no">' + esc(s.id) + '</span>' +
            '<span class="stage-rail__label">' + esc(s.label) + '</span>' +
            '<span class="stage-rail__state">' + esc(STATE_KO[s.state] || s.state) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="console-cols">' +
          '<div class="panel-box"><div class="panel-box__head">배치된 Worker' + demoBadge() + '</div>' +
            '<div class="panel-box__body">' + c.workers.map(function (w) {
              return '<div class="mini-row"><span class="mini-row__k">' + esc(w.name) +
                '<span class="mini-row__sub">' + esc(w.load) + '</span></span>' + status(w.state, STATE_KO[w.state] || w.state) + '</div>';
            }).join('') + '</div></div>' +
          '<div class="panel-box"><div class="panel-box__head">진행 중 Work Unit' + demoBadge() + '</div>' +
            '<div class="panel-box__body">' + c.units.map(function (u) {
              return '<div class="mini-row"><span class="mini-row__k">' + esc(u.id) + ' · ' + esc(u.title) +
                '<span class="mini-row__sub">' + esc(u.owner) + '</span></span>' + status(u.state, STATE_KO[u.state] || u.state) + '</div>';
            }).join('') + '</div></div>' +
        '</div>' +
        '<div class="console-cols">' +
          '<div class="panel-box"><div class="panel-box__head">QA 상태' + demoBadge() + '</div>' +
            '<div class="panel-box__body">' + c.qa.map(function (q) {
              return '<div class="mini-row"><span class="mini-row__k">' + esc(q.name) + '</span>' + status(q.state, STATE_KO[q.state] || q.state) + '</div>';
            }).join('') + '</div></div>' +
          '<div class="panel-box"><div class="panel-box__head">최종 Receipt · ' + esc(c.receipt.id) + demoBadge() + '</div>' +
            '<div class="panel-box__body"><div class="mini-row"><span class="mini-row__k">상태</span>' +
              status('qa', c.receipt.stateText) + '</div><div class="kv">' +
              c.receipt.lines.map(function (l) {
                return '<div class="kv__row"><span class="kv__k">' + esc(l.k) + '</span><span class="kv__v">' + esc(l.v) + '</span></div>';
              }).join('') + '</div></div></div>' +
        '</div>' +
      '</div>';
    },

    tasks: function () {
      return '<div class="console-view">' +
        head('Tasks', '하나의 요청이 어떤 작업으로 나뉘었는지 보여줍니다. 작업마다 담당과 완료 조건이 붙습니다.') +
        table(DEMO.tasks) +
        '<p class="caption">완료 조건이 비어 있는 작업은 실행되지 않습니다. 앞 단위의 결과가 다음 단위의 입력이 되는 의존관계도 함께 기록됩니다.</p>' +
      '</div>';
    },

    runs: function () {
      return '<div class="console-view">' +
        head('Runs', '지금 실행 중인 작업과, 중단된 뒤 상태 확인이 필요한 작업을 함께 봅니다.') +
        table(DEMO.runs) +
        '<p class="caption">연결 끊김은 곧바로 실패로 단정하지 않습니다. 기존 상태·checkpoint·결과 기록을 먼저 확인합니다.</p>' +
      '</div>';
    },

    workers: function () {
      return '<div class="console-view">' +
        head('Workers', '작업 성격에 따라 배치된 실행 주체입니다. 이름은 역할 설명용이며, 특정 AI 제공사와의 공식 연동을 의미하지 않습니다.') +
        '<div class="table-simple">' + DEMO.workers.map(function (w) {
          return '<div class="table-simple__row">' +
            '<span class="table-simple__k">' + esc(w.a) +
            '<span class="table-simple__sub">' + esc(w.b) + '</span></span>' +
            '<span class="table-simple__sub" style="margin:0;font-family:var(--font-sans);font-size:var(--fs-caption)">' + esc(w.c) + '</span>' +
            status(w.state, STATE_KO[w.state] || w.state) + '</div>';
        }).join('') + '</div>' +
        '<p class="caption">실제 배치 가능한 Worker 종류와 실행 범위는 연결된 환경과 권한 정책에 따라 달라집니다.</p>' +
      '</div>';
    },

    resources: function () {
      return '<div class="console-view">' +
        head('Resources', '실행 자원과 정책을 어떻게 다루는지 보여주는 개념 화면입니다. 실제 설정값이 아닙니다.') +
        '<div class="grid grid--2">' + DEMO.resources.map(function (r) {
          return '<div class="panel-box"><div class="panel-box__head">' + esc(r.name) + demoBadge() + '</div>' +
            '<div class="panel-box__body"><div class="mini-row"><span class="mini-row__k">' + esc(r.value) +
            '<span class="mini-row__sub">' + esc(r.sub) + '</span></span></div></div></div>';
        }).join('') + '</div>' +
        '<p class="caption">구체적인 자원 정책과 한도는 실행 환경과 요금제에 따라 달라지며, 현재 공개된 값이 아닙니다.</p>' +
      '</div>';
    },

    qa: function () {
      var c = D.consolePreview;
      return '<div class="console-view">' +
        head('QA', '실행 종료가 아니라 확인된 범위를 봅니다. 확인하지 않은 범위는 완료로 표시하지 않습니다.') +
        '<div class="qa-list">' + c.qa.map(function (q) {
          return '<div class="qa-row" data-state="' + q.state + '">' +
            '<span><span class="qa-row__name">' + esc(q.name) + '</span>' +
            '<span class="qa-row__scope">확인 범위 · ' + esc(q.state === 'verified' ? '기록 있음' : q.state === 'qa' ? '진행 중' : '대기') + '</span></span>' +
            status(q.state, STATE_KO[q.state] || q.state) + '</div>';
        }).join('') + '</div>' +
        '<div class="kv">' +
          '<div class="kv__row"><span class="kv__k">작성됨</span><span class="kv__v">≠ 검증됨</span></div>' +
          '<div class="kv__row"><span class="kv__k">로컬 통과</span><span class="kv__v">≠ 최종 완료</span></div>' +
          '<div class="kv__row"><span class="kv__k">실행 종료</span><span class="kv__v">≠ 검증 완료</span></div>' +
        '</div>' +
        '<p class="caption">확인 절차 없이 “완료”로 표시하지 않는 것이 이 화면의 목적입니다.</p>' +
      '</div>';
    },

    receipts: function () {
      return '<div class="console-view">' +
        head('Receipts', '무엇이 실행되고 무엇이 확인됐는지 남는 기록입니다. 성공 선언이 아니라 다음 판단의 근거입니다.') +
        table(DEMO.receipts) +
        '<div class="panel-box"><div class="panel-box__head">예시 Receipt · ' + esc(D.consolePreview.receipt.id) + demoBadge() + '</div>' +
          '<div class="panel-box__body"><div class="kv">' +
            D.consolePreview.receipt.lines.map(function (l) {
              return '<div class="kv__row"><span class="kv__k">' + esc(l.k) + '</span><span class="kv__v">' + esc(l.v) + '</span></div>';
            }).join('') +
          '</div></div></div>' +
        '<p class="caption">' + esc(D.verify.receipt.subtitle) + '</p>' +
      '</div>';
    },

    connections: function () {
      return '<div class="console-view">' +
        head('Connections', '외부 실행 환경과 계정을 연결하는 자리입니다. 현재는 어떤 연결도 활성화되어 있지 않습니다.') +
        '<div class="table-simple">' + DEMO.connections.map(function (c) {
          return '<div class="table-simple__row">' +
            '<span class="table-simple__k">' + esc(c.name) +
            '<span class="table-simple__sub">' + esc(c.sub) + '</span></span>' +
            '<span class="table-simple__spacer" aria-hidden="true"></span>' +
            '<span class="badge badge--soon">' + esc(c.state) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="caption">연결 상태를 실제처럼 보이게 만들지 않습니다. 연결되면 이 화면의 라벨과 상태만 갱신됩니다.</p>' +
      '</div>';
    },

    settings: function () {
      return '<div class="console-view">' +
        head('Settings', '계정과 실행 정책을 관리하는 영역입니다. 계정 기능이 열리기 전까지는 사용할 수 없습니다.') +
        '<div class="empty-state">' +
          badge(D.LABELS.comingSoon) +
          '<h3 style="margin-top:8px">계정 연결 후 사용 가능</h3>' +
          '<p>Settings는 계정과 권한 체계가 연결된 뒤에 열립니다. 지금은 화면 구성만 확인할 수 있으며, 어떤 설정값도 저장되지 않습니다.</p>' +
          '<a class="btn btn--ghost btn--sm" href="signup.html" data-track="early_access_click">Early Access 문의</a>' +
        '</div>' +
        '<div class="kv">' +
          '<div class="kv__row"><span class="kv__k">권한 분리</span><span class="kv__v">허용된 범위 밖의 실행은 하지 않습니다.</span></div>' +
          '<div class="kv__row"><span class="kv__k">사람의 승인</span><span class="kv__v">중요한 변경은 사람이 확인합니다.</span></div>' +
          '<div class="kv__row"><span class="kv__k">실행 기록</span><span class="kv__v">무엇이 실행됐는지 남습니다.</span></div>' +
        '</div>' +
      '</div>';
    }
  };

  function boot() {
    var nav = document.getElementById('consoleNav');
    var main = document.getElementById('consoleMain');
    var path = document.getElementById('consolePath');
    if (!nav || !main) return;

    nav.innerHTML = AREAS.map(function (a) {
      return '<button type="button" data-area="' + a.key + '"><i aria-hidden="true"></i>' + esc(a.label) + '</button>';
    }).join('');

    function show(key) {
      var area = AREAS.filter(function (a) { return a.key === key; })[0] || AREAS[0];
      nav.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-current', String(b.getAttribute('data-area') === area.key));
      });
      if (path) path.textContent = 'console · ' + area.path;
      main.innerHTML = VIEWS[area.key]();
      if (window.buildupTrack) window.buildupTrack('console_preview_open', { area: area.key });
    }

    nav.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-area]');
      if (b) show(b.getAttribute('data-area'));
    });

    show('home');

    /* connection status grid in the following section */
    var grid = document.getElementById('statusGrid');
    if (grid) {
      var items = [
        { t: 'Demo · 설명용', tone: 'demo', body: '7단계 실행 흐름 Demo, Console 구조 Preview, 활용 사례 예시는 모두 제품 구조 설명용이며 실제 실행이 아닙니다.' },
        { t: 'Preview · 설계 화면', tone: 'concept', body: 'Console의 화면 구성과 정보 구조는 설계 단계입니다. 실제 화면과 다를 수 있습니다.' },
        { t: 'Coming Soon · 미연결', tone: 'soon', body: '계정, 로그인, 실행 엔진, 저장소 연결은 아직 공개되지 않았습니다. 없는 기능을 구현된 것처럼 표시하지 않습니다.' },
        { t: 'Early Access · 접수 중', tone: 'early', body: '도입 검토 문의는 받고 있습니다. 가격과 제공 범위는 확정 전까지 “별도 문의”로 안내합니다.' }
      ];
      grid.innerHTML = items.map(function (i) {
        return '<article class="trust-card">' +
          '<span class="badge badge--' + i.tone + '">' + esc(i.t.split(' · ')[0]) + '</span>' +
          '<span class="trust-card__title" style="margin-top:6px">' + esc(i.t.split(' · ')[1]) + '</span>' +
          '<span class="trust-card__body">' + esc(i.body) + '</span>' +
        '</article>';
      }).join('');
    }

    if (window.buildupReveal) window.buildupReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
