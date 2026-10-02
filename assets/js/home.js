/* ============================================================
   THEFA Core — Homepage renderer
   Renders every section from window.BUILDUP_DATA, then wires the
   restrained motion: sequential flow activation, step-by-step demo,
   hero command loop, flow-rail progress.

   Nothing here invents product facts. Every illustrative screen
   carries an honesty badge from the data layer.
   ============================================================ */

(function () {
  'use strict';

  var D = window.BUILDUP_DATA;
  if (!D) return;

  var motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tweak = window.buildupTweakState || { heroVariant: 'command', motion: 'restrained' };

  function q(id) { return document.getElementById(id); }
  function setText(id, v) { var n = q(id); if (n) n.textContent = v; }
  function setHTML(id, v) { var n = q(id); if (n) n.innerHTML = v; }
  function lines(arr) {
    return arr.map(function (l) { return '<span class="line">' + esc(l) + '</span>'; }).join('');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function badge(label) {
    if (!label) return '';
    return '<span class="badge badge--' + (label.tone || 'concept') + '">' + esc(label.text) + '</span>';
  }
  function status(state, text) {
    return '<span class="status" data-state="' + state + '">' + esc(text) + '</span>';
  }
  /* State chips used to print the raw machine key — a Korean page showing
     "verified" / "qa" / "waiting" beside Korean labels. D.stateKo already
     held the translations; nothing was reading it. */
  function ko(state) { return D.stateKo[state] || state; }
  var PROMPT = '<svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden="true">' +
    '<path d="M1 1l5 5-5 5M8 11h5" stroke="currentColor" stroke-width="1.6"/></svg>';

  /* =========================================================
     01 HERO
     ========================================================= */

  function renderFlowChip() {
    var host = q('flowChip');
    if (!host) return;
    host.innerHTML = D.hero.flowChip.map(function (t, i) {
      return '<li data-on="false" data-idx="' + i + '">' + esc(t) + '</li>';
    }).join('');
  }

  function heroVariantA() {
    var v = D.hero.variants[0];
    return '' +
      '<div class="pane">' +
        '<div class="pane__bar">' +
          '<span class="pane__dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="pane__title">thefa core · request</span>' +
          badge(D.LABELS.concept) +
        '</div>' +
        '<div class="pane__body">' +
          '<div class="cmd">' +
            '<span class="cmd__prompt" aria-hidden="true">&gt;_</span>' +
            '<span class="cmd__text">' + esc(v.command) + '<span class="cmd__caret" aria-hidden="true"></span></span>' +
          '</div>' +
          '<ul class="units" id="heroUnits">' +
            v.units.map(function (u) {
              return '<li class="unit" data-state="idle">' +
                '<span class="unit__id">' + esc(u.id) + '</span>' +
                '<span><span class="unit__title">' + esc(u.title) + '</span><br>' +
                '<span class="unit__meta">' + esc(u.meta) + '</span></span>' +
                '<span class="stair" aria-hidden="true"><i></i><i></i><i></i></span>' +
              '</li>';
            }).join('') +
          '</ul>' +
          '<div class="receipt-mini">' +
            '<span class="stair" aria-hidden="true"><i></i><i></i><i></i></span>' +
            '<span>' +
              '<span class="receipt-mini__label">Receipt</span><br>' +
              '<span class="receipt-mini__text" id="heroReceiptText">' + esc(v.receipt.detail) + '</span>' +
            '</span>' +
          '</div>' +
          '<p class="caption" style="margin-top:12px">' + esc(D.hero.microcopy) + '</p>' +
        '</div>' +
      '</div>';
  }

  function heroVariantB() {
    var v = D.hero.variants[1];
    return '' +
      '<div class="pane">' +
        '<div class="pane__bar">' +
          '<span class="pane__dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="pane__title">thefa core · execution</span>' +
          badge(D.LABELS.concept) +
        '</div>' +
        '<div class="pane__body">' +
          '<div class="cmd" style="margin-bottom:14px">' +
            '<span class="cmd__prompt" aria-hidden="true">&gt;_</span>' +
            '<span class="cmd__text">' + esc(v.command) + '</span>' +
          '</div>' +
          '<div class="pipe" id="heroPipe">' +
            v.stages.map(function (s, i) {
              return '<div class="pipe__row" data-state="idle" data-idx="' + i + '">' +
                '<span class="pipe__no">' + esc(s.id) + '</span>' +
                '<span class="pipe__en">' + esc(s.title) + '</span>' +
                '<span class="pipe__note">' + esc(s.note) + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<p class="caption" style="margin-top:12px">' + esc(D.hero.microcopy) + '</p>' +
        '</div>' +
      '</div>';
  }

  var heroTimers = [];
  function clearHeroTimers() {
    heroTimers.forEach(clearTimeout);
    heroTimers = [];
  }

  function renderHeroVisual() {
    var host = q('heroVisual');
    if (!host) return;
    clearHeroTimers();
    host.innerHTML = tweak.heroVariant === 'pipeline' ? heroVariantB() : heroVariantA();
    if (tweak.motion === 'minimal' || !motionOK) {
      document.querySelectorAll('#heroUnits .unit').forEach(function (u) { u.setAttribute('data-state', 'verified'); });
      document.querySelectorAll('#heroPipe .pipe__row').forEach(function (r) { r.setAttribute('data-state', 'done'); });
      return;
    }
    if (tweak.heroVariant === 'pipeline') runHeroPipeline(); else runHeroCommand();
  }

  function runHeroCommand() {
    var units = Array.prototype.slice.call(document.querySelectorAll('#heroUnits .unit'));
    var chip = Array.prototype.slice.call(document.querySelectorAll('#flowChip li'));
    if (!units.length) return;
    var receipt = q('heroReceiptText');
    var settle = D.hero.variants[0].receipt;
    var cycles = 0;

    function cycle() {
      clearHeroTimers();
      units.forEach(function (u) { u.setAttribute('data-state', 'idle'); });
      chip.forEach(function (c) { c.setAttribute('data-on', 'false'); });
      if (receipt) receipt.textContent = settle.detail;

      var t = 420;
      units.forEach(function (u, i) {
        var unit = u, i2 = i;
        heroTimers.push(setTimeout(function () {
          unit.setAttribute('data-state', 'running');
          if (chip[i2 + 1]) chip[i2 + 1].setAttribute('data-on', 'true');
        }, t));
        heroTimers.push(setTimeout(function () {
          unit.setAttribute('data-state', 'verified');
          if (chip[i2 + 2]) chip[i2 + 2].setAttribute('data-on', 'true');
        }, t + 620));
        t += 820;
      });
      heroTimers.push(setTimeout(function () {
        if (receipt) receipt.textContent = 'QA 연결 · 검증 결과 기록';
        chip.forEach(function (c) { c.setAttribute('data-on', 'true'); });
      }, t + 300));

      cycles++;
      /* Two passes, then settle. No endless motion. */
      if (cycles < 2) heroTimers.push(setTimeout(cycle, t + 2600));
    }
    cycle();
  }

  function runHeroPipeline() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#heroPipe .pipe__row'));
    if (!rows.length) return;
    function cycle() {
      clearHeroTimers();
      rows.forEach(function (r) { r.setAttribute('data-state', 'idle'); });
      var t = 300;
      rows.forEach(function (r) {
        var row = r;
        heroTimers.push(setTimeout(function () { row.setAttribute('data-state', 'active'); }, t));
        heroTimers.push(setTimeout(function () { row.setAttribute('data-state', 'done'); }, t + 700));
        t += 620;
      });
    }
    cycle();
  }

  /* =========================================================
     03 WHY
     ========================================================= */

  function renderWhy() {
    setText('whyEyebrow', D.why.eyebrow);
    setHTML('whyTitle', lines(D.why.h2));
    setText('whyBody', D.why.body);
    setText('whyClosing', D.why.closing);
    setHTML('whyGrid', D.why.problems.map(function (p) {
      return '<article class="card card--hover prob-card reveal">' +
        '<span class="prob-card__n">' + esc(p.n) + '</span>' +
        '<h3>' + esc(p.title) + '</h3>' +
        '<p>' + esc(p.body) + '</p>' +
        '<p class="prob-card__detail">' + esc(p.detail) + '</p>' +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     04 CORE FLOW
     ========================================================= */

  function renderCoreFlow() {
    setText('flowEyebrow', D.coreFlow.eyebrow);
    setHTML('flowTitle', lines(D.coreFlow.h2));
    setText('flowBody', D.coreFlow.body);

    setHTML('flowNodes', D.coreFlow.stages.map(function (s) {
      return '<li data-on="false">' + esc(s.en) + '</li>';
    }).join(''));

    setHTML('flowGrid', D.coreFlow.stages.map(function (s) {
      return '<article class="stage" data-on="false">' +
        '<div class="stage__top">' +
          '<span class="stage__no">' + esc(s.id) + '</span>' +
          '<span class="stage__ko">' + esc(s.ko) + '</span>' +
          '<span class="stage__en">' + esc(s.en) + '</span>' +
        '</div>' +
        '<p class="stage__body">' + esc(s.body) + '</p>' +
        '<p class="stage__human">' + esc(s.human) + '</p>' +
      '</article>';
    }).join(''));

    setHTML('flowStatement',
      '<span aria-hidden="true" style="color:var(--gold);display:inline-flex">' + PROMPT + '</span>' +
      D.coreFlow.statement.split('→').map(function (part, i, arr) {
        var t = part.trim();
        var out = i === arr.length - 1 ? '<strong>' + esc(t) + '</strong>' : esc(t);
        return out + (i < arr.length - 1 ? ' <span style="color:var(--tx-on-dark-dim)">→</span> ' : '');
      }).join(''));

    var fill = q('flowFill');
    function activateAll() {
      document.querySelectorAll('.stage').forEach(function (n) { n.setAttribute('data-on', 'true'); });
      document.querySelectorAll('.flow-rail__nodes li').forEach(function (n) { n.setAttribute('data-on', 'true'); });
      if (fill) fill.style.width = '100%';
    }

    if (!motionOK || !('IntersectionObserver' in window)) { activateAll(); return; }

    var grid = q('flowGrid');
    if (!grid) return;
    var started = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || started) return;
        started = true;
        io.disconnect();
        var stages = Array.prototype.slice.call(document.querySelectorAll('.stage'));
        var nodes = Array.prototype.slice.call(document.querySelectorAll('.flow-rail__nodes li'));
        if (fill) fill.style.width = '100%';
        stages.forEach(function (s, i) {
          setTimeout(function () {
            s.setAttribute('data-on', 'true');
            if (nodes[i]) nodes[i].setAttribute('data-on', 'true');
          }, i * 190);
        });
      });
    }, { threshold: 0.15 });
    io.observe(grid);
  }

  /* =========================================================
     05..07 INTERACTIVE DEMO
     ========================================================= */

  function renderDemo() {
    setText('demoEyebrow', D.demo.eyebrow);
    setHTML('demoTitle', lines(D.demo.h2));
    setText('demoBody', D.demo.body);
    setText('demoDisclaimer', D.demo.disclaimer);

    var host = q('demoApp');
    if (!host) return;

    host.innerHTML =
      '<div class="demo__controls">' +
        '<div class="demo-request">' +
          '<span class="demo-request__label">사용자 요청 · 예시</span>' +
          '<p>' + esc(D.demo.request) + '</p>' +
        '</div>' +
        '<div class="demo-steps" role="tablist" aria-label="THEFA Core 실행 단계" id="demoStepList"></div>' +
        '<div class="demo__player">' +
          '<div class="demo__progress" aria-hidden="true"><i id="demoBar"></i></div>' +
          '<div class="demo__player-actions">' +
            '<button class="btn btn--sm btn--primary" type="button" id="demoPlay">자동 재생</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" id="demoPrev">이전</button>' +
            '<button class="btn btn--sm btn--ghost" type="button" id="demoNext">다음</button>' +
          '</div>' +
          '<span class="demo__count" id="demoCount"></span>' +
          '<span class="sr-only" id="demoLive" aria-live="polite"></span>' +
        '</div>' +
      '</div>' +
      '<div class="demo__stage">' +
        '<div class="demo__stage-head">' +
          '<span class="demo__stage-title" id="demoStageLabel"></span>' +
          '<span class="status" id="demoStageState" data-state="ready">준비</span>' +
          badge(D.demo.label) +
        '</div>' +
        '<div class="demo-panel" id="demoPanel" role="tabpanel" aria-live="polite"></div>' +
      '</div>';

    setHTML('demoStepList', D.demo.steps.map(function (s) {
      return '<button class="demo-step" type="button" role="tab" id="demoTab' + s.id + '" ' +
        'aria-controls="demoPanel" aria-selected="false" data-step="' + s.id + '" data-done="false">' +
        '<span class="demo-step__n">' + s.id + '</span>' +
        '<span><span class="demo-step__label">' + esc(s.ko) + '</span>' +
        '<span class="demo-step__en">' + esc(s.en) + '</span></span>' +
        '<span class="demo-step__tick" aria-hidden="true">✓</span>' +
      '</button>';
    }).join(''));

    if (window.buildupCreateDemoMachine) {
      window.buildupCreateDemoMachine({
        tabSelector: '.demo-step',
        tablistSelector: '#demoStepList',
        panelSelector: '#demoPanel',
        labelSelector: '#demoStageLabel',
        stateSelector: '#demoStageState',
        barSelector: '#demoBar',
        countSelector: '#demoCount',
        playSelector: '#demoPlay',
        prevSelector: '#demoPrev',
        nextSelector: '#demoNext',
        announce: 'demoLive',
        rich: false,
        interval: 3400
      }).autoStartOnVisible(host);
    }
  }

  /* =========================================================
     06 BEFORE / AFTER
     ========================================================= */

  function renderBeforeAfter() {
    setText('baEyebrow', D.beforeAfter.eyebrow);
    setHTML('baTitle', lines(D.beforeAfter.h2));
    setText('baBody', D.beforeAfter.body);
    setText('baFootnote', D.beforeAfter.footnote);

    function col(kind, data) {
      return '<article class="ba-card" data-kind="' + kind + '">' +
        '<span class="ba-card__label">' + esc(data.label) + '</span>' +
        '<ul class="ba-steps">' + data.steps.map(function (s, i) {
          var mark = kind === 'after' ? ('0' + (i + 1)).slice(-2) : '·';
          return '<li><span class="ba-steps__mark">' + mark + '</span><span>' + esc(s) + '</span></li>';
        }).join('') + '</ul>' +
        '<p class="ba-card__note">' + esc(data.note) + '</p>' +
      '</article>';
    }
    setHTML('baGrid', col('before', D.beforeAfter.before) + col('after', D.beforeAfter.after));
  }

  /* =========================================================
     07 ORCHESTRATION
     ========================================================= */

  function renderOrchestration() {
    setText('orchEyebrow', D.orchestration.eyebrow);
    setHTML('orchTitle', lines(D.orchestration.h2));
    setText('orchBody', D.orchestration.body);
    setText('orchPrinciple', D.orchestration.principle);
    setText('orchDisclaimer', D.orchestration.disclaimer);
    setHTML('orchGrid', D.orchestration.domains.map(function (d) {
      return '<article class="orch-card">' +
        '<span class="orch-card__tag">' + esc(d.tag) + '</span>' +
        '<span class="orch-card__title">' + esc(d.title) + '</span>' +
        '<span class="orch-card__body">' + esc(d.body) + '</span>' +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     08 EXECUTION MODES
     ========================================================= */

  function renderModes() {
    setText('modesEyebrow', D.modes.eyebrow);
    setHTML('modesTitle', lines(D.modes.h2));
    setText('modesBody', D.modes.body);
    setText('modesFootnote', D.modes.footnote);
    setHTML('modeGrid', D.modes.items.map(function (m) {
      return '<article class="mode-card">' +
        '<span class="mode-card__id">' + esc(m.id) + '</span>' +
        '<span class="mode-card__ko">' + esc(m.ko) + '</span>' +
        '<p class="mode-card__body">' + esc(m.body) + '</p>' +
        '<div class="mode-card__meta">' +
          '<div><span>적합한 경우</span> · ' + esc(m.when) + '</div>' +
          '<div><span>기본 원칙</span> · ' + esc(m.guard) + '</div>' +
        '</div>' +
        badge(D.modes.badge) +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     09 VERIFICATION
     ========================================================= */

  function renderVerify() {
    setText('verEyebrow', D.verify.eyebrow);
    setHTML('verTitle', lines(D.verify.h2));
    setText('verBody', D.verify.body);
    setText('verCaution', D.verify.caution);

    setHTML('neqGrid', D.verify.statements.map(function (s) {
      var parts = s.en.split('≠').map(function (p) { return p.trim(); });
      return '<article class="neq-card">' +
        '<span class="neq-card__en">' + esc(parts[0]) +
          ' <span style="color:var(--state-wait)">≠</span> ' + esc(parts[1]) + '</span>' +
        '<span class="neq-card__ko">' + esc(s.ko) + '</span>' +
        '<p class="neq-card__body">' + esc(s.body) + '</p>' +
      '</article>';
    }).join(''));

    var r = D.verify.receipt;
    setText('receiptTitle', r.title);
    setText('receiptSub', r.subtitle);
    setText('receiptBadge', r.badge.text);
    setHTML('receiptFields', r.fields.map(function (f) {
      return '<div class="kv__row">' +
        '<span class="kv__k">' + esc(f.k) + '</span>' +
        '<span class="kv__v">' + esc(f.v) + ' ' + status(f.state, ko(f.state)) + '</span>' +
      '</div>';
    }).join(''));
    setHTML('receiptTrail', r.trail.map(function (t) {
      return '<li data-state="' + t.state + '">' + esc(t.label) + '</li>';
    }).join(''));
  }

  /* =========================================================
     10 CONTINUITY
     ========================================================= */

  function renderContinuity() {
    setText('contEyebrow', D.continuity.eyebrow);
    setHTML('contTitle', lines(D.continuity.h2));
    setText('contBody', D.continuity.body);
    setText('contCallout', D.continuity.callout);
    setText('contCaution', D.continuity.caution);
    setHTML('contTimeline', D.continuity.timeline.map(function (t) {
      return '<li data-state="' + t.state + '">' +
        '<span class="timeline__id">' + esc(t.id) + '</span>' +
        '<span class="timeline__ko">' + esc(t.ko) + '</span>' +
        '<span class="timeline__body">' + esc(t.body) + '</span>' +
      '</li>';
    }).join(''));
  }

  /* =========================================================
     11 RESOURCE
     ========================================================= */

  function renderResource() {
    setText('resEyebrow', D.resource.eyebrow);
    setHTML('resTitle', lines(D.resource.h2));
    setText('resBody', D.resource.body);
    setText('resFootnote', D.resource.faqish);
    setHTML('resMessage', '<span class="hl">' + esc(D.resource.message) + '</span>');
    setHTML('resGrid', D.resource.items.map(function (i) {
      return '<article class="res-card">' +
        '<span class="res-card__title">' + esc(i.title) + '</span>' +
        '<span class="res-card__body">' + esc(i.body) + '</span>' +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     12 USE CASES
     ========================================================= */

  function renderUseCases() {
    setText('ucEyebrow', D.useCases.eyebrow);
    setHTML('ucTitle', lines(D.useCases.h2));
    setText('ucBody', D.useCases.body);
    setText('ucFootnote', D.useCases.footnote);

    function row(k, arr) {
      return '<div class="uc-flow__row">' +
        '<span class="uc-flow__k">' + esc(k) + '</span>' +
        '<span class="uc-flow__v">' + arr.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</span>' +
      '</div>';
    }

    setHTML('ucGrid', D.useCases.items.map(function (c) {
      return '<article class="uc-card">' +
        '<div class="uc-card__head">' +
          '<h3>' + esc(c.title) + '</h3>' + badge(c.badge) +
        '</div>' +
        '<p class="uc-card__request">' + esc(c.request) + '</p>' +
        '<div class="uc-flow">' +
          row('Input', c.input) + row('Process', c.process) + row('Output', c.output) +
        '</div>' +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     13 CONSOLE PREVIEW  (markup shared with console.html)
     ========================================================= */

  function consoleMarkup(opts) {
    var c = D.consolePreview;
    var active = (opts && opts.active) || 'Home';

    var nav = c.nav.map(function (n) {
      return '<li data-active="' + String(n === active) + '"><i aria-hidden="true"></i>' + esc(n) + '</li>';
    }).join('');

    var stages = c.stages.map(function (s) {
      return '<div class="stage-rail__item" data-state="' + s.state + '">' +
        '<span class="stage-rail__no">' + esc(s.id) + '</span>' +
        '<span class="stage-rail__label">' + esc(s.label) + '</span>' +
        '<span class="stage-rail__state">' + esc(ko(s.state)) + '</span>' +
      '</div>';
    }).join('');

    var workers = c.workers.map(function (w) {
      return '<div class="mini-row">' +
        '<span class="mini-row__k">' + esc(w.name) + '<span class="mini-row__sub">' + esc(w.load) + '</span></span>' +
        status(w.state, ko(w.state)) + '</div>';
    }).join('');

    var units = c.units.map(function (u) {
      return '<div class="mini-row">' +
        '<span class="mini-row__k">' + esc(u.id) + ' · ' + esc(u.title) +
        '<span class="mini-row__sub">' + esc(u.owner) + '</span></span>' +
        status(u.state, ko(u.state)) + '</div>';
    }).join('');

    var qa = c.qa.map(function (x) {
      return '<div class="mini-row"><span class="mini-row__k">' + esc(x.name) + '</span>' + status(x.state, ko(x.state)) + '</div>';
    }).join('');

    var receipt = c.receipt.lines.map(function (l) {
      return '<div class="kv__row"><span class="kv__k">' + esc(l.k) + '</span><span class="kv__v">' + esc(l.v) + '</span></div>';
    }).join('');

    var tabKeys = ['plan', 'run', 'verify', 'receipt'];
    var tabs = tabKeys.map(function (k, i) {
      return '<button class="console-tab" type="button" role="tab" aria-selected="' + (i === 0) + '" ' +
        'data-console-tab="' + k + '" aria-controls="consolePanel">' + esc(c.tabs[k].title) + '</button>';
    }).join('');

    var first = c.tabs.plan;

    return '' +
    '<div class="console-frame">' +
      '<div class="console-top">' +
        '<img src="assets/brand/core/THEFA_Core_Wordmark_Dark_web.svg" width="1300" height="300" alt="THEFA Core" style="height:17px;width:auto">' +
        '<span class="console-top__path">console · /tasks/current</span>' +
        badge(c.badge) +
      '</div>' +
      '<div class="console-body">' +
        '<ul class="console-nav" aria-label="Console 메뉴">' + nav + '</ul>' +
        '<div class="console-main">' +
          '<div class="console-req">' +
            '<span class="console-req__label">현재 요청 · 예시 데이터</span>' +
            '<p>' + esc(c.request) + '</p>' +
          '</div>' +
          '<div class="stage-rail" aria-label="실행 단계">' + stages + '</div>' +
          '<div class="console-cols">' +
            '<div class="panel-box">' +
              '<div class="panel-box__head">배치된 Worker' + badge(D.LABELS.demo) + '</div>' +
              '<div class="panel-box__body">' + workers + '</div>' +
            '</div>' +
            '<div class="panel-box">' +
              '<div class="panel-box__head">진행 중 Work Unit' + badge(D.LABELS.demo) + '</div>' +
              '<div class="panel-box__body">' + units + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="console-cols">' +
            '<div class="panel-box">' +
              '<div class="panel-box__head">QA 상태' + badge(D.LABELS.demo) + '</div>' +
              '<div class="panel-box__body">' + qa + '</div>' +
            '</div>' +
            '<div class="panel-box">' +
              '<div class="panel-box__head">최종 Receipt · ' + esc(c.receipt.id) + badge(D.LABELS.demo) + '</div>' +
              '<div class="panel-box__body">' +
                '<div class="mini-row"><span class="mini-row__k">상태</span>' + status('qa', c.receipt.stateText) + '</div>' +
                '<div class="kv">' + receipt + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="console-tabs" role="tablist" aria-label="Console 상세 탭">' + tabs + '</div>' +
            '<div class="console-tabpanel" id="consolePanel" role="tabpanel" aria-live="polite">' +
              '<p class="caption" style="margin-bottom:10px">' + esc(first.body) + '</p>' +
              first.rows.map(function (r) { return '<div class="console-tabpanel__row"><span>' + esc(r) + '</span></div>'; }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function initConsoleTabs(root) {
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-console-tab]'));
    var panel = root.querySelector('#consolePanel');
    if (!panel) return;
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var data = D.consolePreview.tabs[t.getAttribute('data-console-tab')];
        tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
        panel.innerHTML = '<p class="caption" style="margin-bottom:10px">' + esc(data.body) + '</p>' +
          data.rows.map(function (r) { return '<div class="console-tabpanel__row"><span>' + esc(r) + '</span></div>'; }).join('');
      });
    });
  }

  function renderConsolePreview() {
    setText('cpEyebrow', D.consolePreview.eyebrow);
    setHTML('cpTitle', lines(D.consolePreview.h2));
    setText('cpBody', D.consolePreview.body);
    setText('cpNote', D.consolePreview.note);
    var host = q('consolePreviewHost');
    if (!host) return;
    host.innerHTML = consoleMarkup({ active: 'Home' });
    initConsoleTabs(host);
  }

  /* =========================================================
     14 TRUST
     ========================================================= */

  function renderTrust() {
    setText('trustEyebrow', D.trust.eyebrow);
    setHTML('trustTitle', lines(D.trust.h2));
    setText('trustBody', D.trust.body);
    setText('trustNote', D.trust.note);
    setText('trustDisclosure', D.trust.disclosure);
    setHTML('trustGrid', D.trust.pillars.map(function (p) {
      return '<article class="trust-card">' +
        '<span class="trust-card__title">' + esc(p.title) + '</span>' +
        '<span class="trust-card__body">' + esc(p.body) + '</span>' +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     15 EARLY ACCESS
     ========================================================= */

  function renderEarlyAccess() {
    setText('eaEyebrow', D.earlyAccess.eyebrow);
    setHTML('eaTitle', lines(D.earlyAccess.h2));
    setText('eaBody', D.earlyAccess.body);
    setText('eaFootNote', '가격 · ' + D.earlyAccess.priceNote + ' · ' + D.earlyAccess.note);
    setText('eaCta1', D.earlyAccess.cta);
    setText('eaCta2', D.earlyAccess.ctaSecondary);
    setHTML('eaGrid', D.earlyAccess.audiences.map(function (a) {
      return '<article class="ea-card">' +
        '<span class="ea-card__title">' + esc(a.title) + '</span>' +
        '<span class="ea-card__body">' + esc(a.body) + '</span>' +
        '<span class="ea-card__need">' + esc(a.need) + '</span>' +
      '</article>';
    }).join(''));
  }

  /* =========================================================
     16 DEVELOPMENT STAGES
     ========================================================= */

  function stageBadge(word) {
    var tone = word === 'Coming Soon' ? 'soon' : word === 'Early Access' ? 'early' : 'concept';
    return '<span class="badge badge--' + tone + '">' + esc(word) + '</span>';
  }

  function renderStages() {
    setText('stEyebrow', D.stages.eyebrow);
    setHTML('stTitle', lines(D.stages.h2));
    setText('stBody', D.stages.body);
    setText('stUpdated', '기준일 · ' + D.stages.updated);
    setText('stNote', D.stages.note);
    setHTML('stList', D.stages.items.map(function (s) {
      return '<div class="stage-list__row">' +
        '<span>' + stageBadge(s.status) + '</span>' +
        '<span>' +
          '<span class="stage-list__title">' + esc(s.title) + '</span>' +
          '<span class="stage-list__body">' + esc(s.body) + '</span>' +
        '</span>' +
      '</div>';
    }).join(''));
  }

  /* =========================================================
     17 THE FA
     ========================================================= */

  function renderTheFa() {
    setText('tfEyebrow', D.thefa.eyebrow);
    setHTML('tfTitle', lines(D.thefa.h2));
    setText('tfBody', D.thefa.body);
  }

  /* =========================================================
     18 FAQ
     ========================================================= */

  function renderFaq() {
    setText('faqEyebrow', D.faq.eyebrow);
    setText('faqTitle', D.faq.h2);
    setHTML('faqList', D.faq.items.map(function (f) {
      return '<div class="faq-item">' +
        '<h3><button class="faq-q" type="button">' +
          '<span>' + esc(f.q) + '</span>' +
          '<span class="faq-q__icon" aria-hidden="true"></span>' +
        '</button></h3>' +
        '<div class="faq-a"><div class="faq-a__inner">' + esc(f.a) + '</div></div>' +
      '</div>';
    }).join(''));
  }

  /* =========================================================
     19 FINAL CTA
     ========================================================= */

  function renderFinalCta() {
    setHTML('ctaTitle',
      '<span class="line">' + esc(D.finalCta.h2[0]) + '</span>' +
      '<span class="line dim">' + esc(D.finalCta.h2[1]) + '</span>');
  }

  /* =========================================================
     BOOT
     ========================================================= */

  function renderAll() {
    renderFlowChip();
    renderHeroVisual();
    renderWhy();
    renderCoreFlow();
    renderDemo();
    renderBeforeAfter();
    renderOrchestration();
    renderModes();
    renderVerify();
    renderContinuity();
    renderResource();
    renderUseCases();
    renderConsolePreview();
    renderTrust();
    renderEarlyAccess();
    renderStages();
    renderTheFa();
    renderFaq();
    renderFinalCta();

    setHTML('trustStrip', D.trustStrip.map(function (t) {
      return '<div class="trust-strip__item"><dt>' + esc(t.k) + '</dt><dd>' + esc(t.v) + '</dd></div>';
    }).join(''));

    /* Section artwork. Each scene is a real content image with alt text,
       placed after the section's own explanation rather than instead of
       it, so the page still reads correctly with images off. */
    if (window.buildupFigure) {
      [['whyFigure', 'why'], ['flowFigure', 'flow'], ['orchFigure', 'orchestration'],
       ['verFigure', 'verify'], ['contFigure', 'continuity'], ['resFigure', 'resource']
      ].forEach(function (pair) {
        setHTML(pair[0], window.buildupFigure(pair[1]));
      });
    }

    /* Content is visible by default; initReveal only opts elements into
       the fade-in animation once the observer is confirmed working. */
    if (window.buildupReveal) window.buildupReveal();
    if (window.buildupInitFaq) window.buildupInitFaq();
  }

  window.__buildupOnTweak = function (state) {
    var prev = tweak.heroVariant;
    tweak = state;
    if (state.heroVariant !== prev) renderHeroVisual();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAll);
  else renderAll();

  window.buildupConsoleMarkup = consoleMarkup;
  window.buildupInitConsoleTabs = initConsoleTabs;
})();
