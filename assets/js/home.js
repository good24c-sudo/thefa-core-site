/* THE FA Core V3 — local illustrative interaction, no provider or execution API calls. */
(function () {
  'use strict';

  var steps = [
    { name: '지시', tag: 'REQUEST', title: '원하는 결과와 조건을 이해합니다.', body: '모바일 오류를 고친다는 목표와 수정 가능한 범위를 확인합니다. 사용자의 요청이 업무의 출발점입니다.', resource: '사용자 → THE FA Core', items: ['목표: 모바일에서 문제없이 사용', '범위: 승인된 홈페이지 소스', '완료 조건: 수정 + 모바일 QA 근거'], caption: '목표와 완료 조건 확인' },
    { name: '기억', tag: 'COMPANY MEMORY', title: '지금 필요한 문맥을 복구합니다.', body: '프로젝트 목표, 브랜드 유지 결정과 이전 결과를 불러옵니다. 전체 과거 대화 대신 현재 작업에 필요한 문맥을 연결합니다.', resource: 'Company Memory / Fast Context', items: ['회사 결정: 기존 브랜드 유지', '작업 경계: Production 승인 필요', '재사용: 최근 결과·Checkpoint'], caption: '관련 기억과 재개 지점 복구' },
    { name: 'BuildUp', tag: 'TASK / WORK UNIT', title: '목표를 실행 가능한 일로 나눕니다.', body: '오류 재현, 원인 분석, 수정, 검토와 QA를 나누고 의존성과 완료 조건을 정리합니다. 같은 소스의 수정 권한은 하나로 유지합니다.', resource: 'BuildUp OS + Scheduler', items: ['오류 재현 → 원인 분석 → 수정', '독립 검토와 모바일 QA 계획', 'Work Unit별 범위·완료 조건'], caption: '작업 분해와 실행 순서 정리' },
    { name: 'Route', tag: 'RESOURCE SELECTION', title: '필요한 능력에 맞춰 자원을 선택합니다.', body: '반복 확인은 로컬 자원, 코드 수정은 Coding Agent, 화면 재현은 Browser로 보냅니다. 실제 연결과 가용성 확인이 먼저입니다.', resource: 'THE FA Router + Resource Governor', items: ['Local AI: 반복 정리·경량 확인', 'Coding Agent: 원인 분석·수정', 'Browser: 화면 재현·QA'], caption: '능력·비용·가용성을 기준으로 선택' },
    { name: 'Execute', tag: 'AUTHORIZED EXECUTION', title: '허용된 실행 환경에서 작업합니다.', body: '승인된 PC나 Worker가 소스 수정과 테스트를 수행합니다. 실행 상태와 재개 지점을 남기고, 연결 중단만으로 작업을 다시 시작하지 않습니다.', resource: 'PC / Browser / Worker', items: ['승인된 파일·Git·터미널 범위', '한 수정 권한으로 코드 변경', '진행 기록과 Checkpoint 보존'], caption: '권한 안에서 실제 작업 수행' },
    { name: 'Review & QA', tag: 'VERIFICATION', title: '다른 검토와 실제 동작으로 확인합니다.', body: '다른 AI의 검토, 테스트, 모바일 화면 확인을 함께 사용합니다. 수정한 버전과 QA 근거를 맞추고 문제를 찾으면 다시 수정합니다.', resource: 'Reviewer + Test + Browser QA', items: ['독립 Review와 테스트 결과', '320–430px 모바일 사용성 확인', '수정 버전과 일치하는 QA 근거'], caption: '만들었다는 말과 실제 동작을 구분' },
    { name: 'Result & Memory', tag: 'EVIDENCE / CONTINUITY', title: '결과와 근거를 다음 일의 자산으로 남깁니다.', body: '코드, 검증 보고서와 완료 근거를 함께 남깁니다. 결과·결정·다음 행동을 기억해 이후 작업을 이어갑니다. Production 반영은 별도의 승인 범위입니다.', resource: 'Artifact + QA + Receipt + Memory', items: ['결과물: 수정 코드·QA 보고서', '근거: 결과 버전·검증·Receipt', '기억: 결정·남은 승인·다음 행동'], caption: '검증 결과와 결정을 기록해 다음 일로' }
  ];

  var usecases = [
    { tag: 'DEVELOPMENT', title: '아이디어를 검증 가능한 제품으로.', body: '요구사항을 정리하고 코드를 작성한 뒤, 다른 검토와 테스트로 실제 동작을 확인합니다.', flow: ['요구사항', '코드', 'Review', 'Test', 'QA'], result: '수정 코드 + 테스트·QA 근거' },
    { tag: 'IR / DOCUMENTS', title: '흩어진 자료를 의사결정 자료로.', body: '회사 자료와 시장 근거를 모으고 분석·작성·다른 AI의 검토를 거쳐 투자자용 결과물을 정리합니다.', flow: ['자료', '시장검증', '작성', 'AI Review', '결과물'], result: 'IR 자료 + 출처·검토 기록' },
    { tag: 'RESEARCH', title: '검색에서, 근거 있는 판단까지.', body: '관련 자료를 모아 비교하고 출처·시점·데이터를 확인한 뒤 판단에 필요한 보고서로 정리합니다.', flow: ['검색', '비교', '근거확인', '보고서'], result: '비교 보고서 + 확인 가능한 출처' },
    { tag: 'COMPANY OPERATIONS', title: '회사 도구를 실제 업무로 연결.', body: '허용된 메일, 파일, 일정과 업무 도구에서 필요한 정보를 확인하고 승인된 범위의 작업을 이어갑니다.', flow: ['메일·파일·일정', '업무 정리', '승인', '실행', '확인'], result: '업무 결과 + 처리 근거·결정' },
    { tag: 'RECURRING WORK', title: '반복 요청도, 이어지는 실행으로.', body: '반복 업무를 실행 단위로 정리하고 Scheduler와 Worker가 처리하도록 연결합니다. 결과 기록으로 중복 실행을 줄입니다.', flow: ['Task', 'Scheduler', 'Worker', 'Result'], result: '처리 결과 + 실행 기록·Receipt' },
    { tag: 'INCIDENT RESPONSE', title: '장애의 원인부터, 복구 확인까지.', body: '문제를 재현하고 원인을 찾은 뒤 수정·테스트·실제 상태 확인을 이어갑니다. 다음 대응에 필요한 근거를 남깁니다.', flow: ['문제', '원인', '수정', '검증'], result: '복구 결과 + 원인·검증 기록' }
  ];

  function setText(host, selector, value) {
    var node = host.querySelector(selector);
    if (node) node.textContent = value;
  }

  function setList(host, selector, values) {
    var list = host.querySelector(selector);
    if (!list) return;
    list.replaceChildren();
    values.forEach(function (value) {
      var li = document.createElement('li');
      li.textContent = value;
      list.appendChild(li);
    });
  }

  function wireTabs(host, attribute, panel, change) {
    var tabs = Array.from(host.querySelectorAll('[' + attribute + ']'));
    if (!tabs.length) return null;
    var current = 0;
    function select(index, moveFocus) {
      if (index < 0 || index >= tabs.length) return;
      current = index;
      tabs.forEach(function (tab, i) {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
        if (attribute === 'data-step') tab.dataset.passed = String(i < index);
      });
      panel.setAttribute('aria-labelledby', tabs[index].id);
      change(index);
      if (moveFocus) {
        tabs[index].focus({ preventScroll: true });
        tabs[index].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      }
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { select(index, false); });
      tab.addEventListener('keydown', function (event) {
        var target;
        if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = tabs.length - 1;
        if (target === undefined) return;
        event.preventDefault();
        select(target, true);
      });
    });
    return { select: select, current: function () { return current; } };
  }

  function initWorkflow() {
    var host = document.querySelector('[data-workflow]');
    if (!host) return;
    var previous = host.querySelector('[data-step-prev]');
    var next = host.querySelector('[data-step-next]');
    var controller = wireTabs(host, 'data-step', document.getElementById('stepPanel'), function (index) {
      var step = steps[index];
      var number = String(index + 1).padStart(2, '0');
      setText(host, '[data-step-meta]', number + ' / 07 · ' + step.tag);
      setText(host, '[data-step-title]', step.title);
      setText(host, '[data-step-body]', step.body);
      setText(host, '[data-step-resource]', step.resource);
      setText(host, '[data-step-caption]', number + ' ' + step.name + ' · ' + step.caption);
      setList(host, '[data-step-items]', step.items);
      previous.disabled = index === 0;
      next.disabled = index === steps.length - 1;
    });
    if (!controller) return;
    previous.addEventListener('click', function () { controller.select(controller.current() - 1, true); });
    next.addEventListener('click', function () { controller.select(controller.current() + 1, true); });
  }

  function initUsecases() {
    var host = document.querySelector('[data-usecases]');
    if (!host) return;
    wireTabs(host, 'data-use', document.getElementById('usePanel'), function (index) {
      var use = usecases[index];
      setText(host, '[data-use-meta]', use.tag);
      setText(host, '[data-use-title]', use.title);
      setText(host, '[data-use-body]', use.body);
      setText(host, '[data-use-result]', '결과: ' + use.result);
      setList(host, '[data-use-flow]', use.flow);
    });
  }

  function initSectionNav() {
    var header = document.querySelector('[data-site-header]');
    if (!header) return;
    var links = Array.from(header.querySelectorAll('.nav a'));
    var sections = links.map(function (a) {
      var href = a.getAttribute('href') || '';
      return /^index\.html#/.test(href) ? document.getElementById(href.split('#')[1]) : null;
    }).filter(Boolean).sort(function (a, b) { return a.offsetTop - b.offsetTop; });
    function sync() {
      var y = window.scrollY + header.offsetHeight + Math.min(180, window.innerHeight * .25);
      var current = sections[0];
      sections.forEach(function (section) { if (section.offsetTop <= y) current = section; });
      links.forEach(function (a) {
        if (current && a.getAttribute('href') === 'index.html#' + current.id) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { sync(); ticking = false; });
    }, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  }

  function init() {
    initWorkflow();
    initUsecases();
    initSectionNav();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else requestAnimationFrame(init);
})();
