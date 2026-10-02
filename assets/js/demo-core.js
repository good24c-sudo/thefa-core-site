/* ============================================================
   THEFA Core — Interactive Demo core
   One source of truth for the 7-step demo panel markup and the
   step machine. Used by the homepage inline demo and the
   standalone demo.html.

   Honesty: every panel is example data. The machine never claims a
   live backend. No fake percentages, no fake success rates.
   ============================================================ */

(function () {
  'use strict';

  var D = window.BUILDUP_DATA;
  if (!D) return;

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
  function ko(state) { return D.stateKo[state] || state; }
  function stateWord(result) {
    return result === '통과' ? 'verified' : result === '진행 중' ? 'qa' : 'waiting';
  }

  /* ---------------------------------------------------------
     Panel markup for one step. `rich` adds the deeper detail
     blocks that only the standalone demo needs.
     --------------------------------------------------------- */
  function panelHTML(step, opts) {
    var rich = !!(opts && opts.rich);

    var head = '' +
      '<div class="demo-panel__head">' +
        '<span class="eyebrow" style="margin-bottom:12px">STEP ' + step.id + ' · ' + esc(step.en) + '</span>' +
        '<h3>' + esc(step.ko) + '</h3>' +
        '<p class="demo-panel__summary">' + esc(step.summary) + '</p>' +
        '<p class="demo-panel__detail">' + esc(step.detail) + '</p>' +
      '</div>';

    var body = '';

    if (step.id === 1) {
      body += '<div class="cmd" style="margin-bottom:16px">' +
        '<span class="cmd__prompt" aria-hidden="true">&gt;_</span>' +
        '<span class="cmd__text">' + esc(D.demo.request) + '</span></div>';
    }

    if (step.payload) {
      body += '<div class="kv">' + step.payload.map(function (r) {
        return '<div class="kv__row"><span class="kv__k">' + esc(r.k) + '</span><span class="kv__v">' + esc(r.v) + '</span></div>';
      }).join('') + '</div>';
      if (rich) {
        body += '<p class="demo-panel__foot">단계 01은 실행 목록을 만들지 않습니다. 목표·종료 조건·제약을 먼저 분리해 이후 단계의 판단 기준으로 남깁니다.</p>';
      }
    }

    if (step.tasks) {
      body += '<div class="chips">' + step.tasks.map(function (t) {
        return '<span class="chip">' + esc(t) + '</span>';
      }).join('') + '</div>';
      if (rich) {
        body += '' +
          '<div class="kv" style="margin-top:16px">' +
            '<div class="kv__row"><span class="kv__k">의존관계</span><span class="kv__v">재현 → 분석 → 수정 → 테스트 → QA → 최종 검증</span></div>' +
            '<div class="kv__row"><span class="kv__k">완료 조건 없는 단위</span><span class="kv__v">실행하지 않음</span></div>' +
            '<div class="kv__row"><span class="kv__k">사람 승인 지점</span><span class="kv__v">배포 실행 전</span></div>' +
          '</div>';
      }
    }

    if (step.workers) {
      body += '<div class="worker-list">' + step.workers.map(function (w) {
        return '<div class="worker-row">' +
          '<span><span class="worker-row__name">' + esc(w.name) + '</span>' +
          '<span class="worker-row__role">' + esc(w.role) + '</span></span>' +
          status(w.state, ko(w.state)) +
        '</div>';
      }).join('') + '</div>';
      if (step.note) body += '<p class="demo-panel__foot">' + esc(step.note) + '</p>';
      if (rich) {
        body += '<p class="demo-panel__foot">여기서 표시된 이름은 역할 설명용입니다. 특정 AI 제공사나 실제 연동된 Worker를 의미하지 않습니다.</p>';
      }
    }

    if (step.units) {
      body += '<div class="units-table">' + step.units.map(function (u) {
        return '<div class="unit-row">' +
          '<span class="unit-row__id">' + esc(u.id) + '</span>' +
          '<span class="unit-row__title">' + esc(u.title) +
            '<span class="unit-row__sub">담당 · ' + esc(u.owner) + '</span>' +
            '<span class="unit-row__sub">완료 조건 · ' + esc(u.done) + '</span>' +
          '</span>' +
          status(u.state, ko(u.state)) +
        '</div>';
      }).join('') + '</div>';
      if (rich) {
        body += '<p class="demo-panel__foot">Work Unit은 진행 상태를 따로 추적하기 위한 최소 단위입니다. 단위가 실패해도 전체를 처음부터 다시 실행하지 않기 위한 구조입니다.</p>';
      }
    }

    if (step.stream) {
      body += '<ul class="stream">' + step.stream.map(function (l) {
        return '<li data-state="' + l.state + '">' +
          '<span class="stream__t">' + esc(l.t) + '</span>' +
          '<span class="stream__x">' + esc(l.text) + '</span>' +
        '</li>';
      }).join('') + '</ul>';
      if (step.note) body += '<p class="demo-panel__foot">' + esc(step.note) + '</p>';
      if (rich) {
        body += '' +
          '<div class="kv" style="margin-top:16px">' +
            '<div class="kv__row"><span class="kv__k">대기 이유</span><span class="kv__v">WU-04는 WU-03의 결과가 입력이므로 대기 상태로 기록</span></div>' +
            '<div class="kv__row"><span class="kv__k">중단 시 처리</span><span class="kv__v">재실행 전 기존 상태·checkpoint 확인</span></div>' +
          '</div>';
      }
    }

    if (step.checks) {
      body += '<div class="qa-list">' + step.checks.map(function (c) {
        var st = stateWord(c.result);
        return '<div class="qa-row" data-state="' + st + '">' +
          '<span><span class="qa-row__name">' + esc(c.name) + '</span>' +
          '<span class="qa-row__scope">확인 범위 · ' + esc(c.scope) + '</span></span>' +
          status(st, c.result) +
        '</div>';
      }).join('') + '</div>';
      if (step.note) body += '<p class="demo-panel__foot">' + esc(step.note) + '</p>';
      if (rich) {
        body += '<p class="demo-panel__foot">QA는 “통과”만 세지 않습니다. 어떤 범위에서 확인했는지 함께 기록합니다. 확인하지 않은 범위는 완료로 표시하지 않습니다.</p>';
      }
    }

    if (step.fields) {
      body += '<div class="kv">' + step.fields.map(function (f) {
        return '<div class="kv__row"><span class="kv__k">' + esc(f.k) + '</span><span class="kv__v">' + esc(f.v) + '</span></div>';
      }).join('') + '</div>';
      if (step.note) body += '<p class="demo-panel__foot">' + esc(step.note) + '</p>';
      if (rich) {
        body += '' +
          '<div class="receipt-trail-wrap">' +
            '<ul class="receipt-trail">' +
              '<li data-state="done">Execution</li>' +
              '<li data-state="done">QA</li>' +
              '<li data-state="active">Verification</li>' +
              '<li data-state="pending">Receipt</li>' +
            '</ul>' +
          '</div>';
      }
    }

    if (rich && step.id < 7) {
      body += '<p class="demo-panel__foot">다음 단계로 이동하면 이 판단이 어떻게 이어지는지 확인할 수 있습니다.</p>';
    }

    return head + body;
  }

  /* ---------------------------------------------------------
     Step machine. Returns a controller so callers can bind
     their own buttons.
     --------------------------------------------------------- */
  function createMachine(config) {
    var steps = D.demo.steps;
    var idx = 0;
    var playing = false;
    var timer = null;
    var tabs = Array.prototype.slice.call(document.querySelectorAll(config.tabSelector));
    var panel = document.querySelector(config.panelSelector);
    var label = config.labelSelector ? document.querySelector(config.labelSelector) : null;
    var stateHost = config.stateSelector ? document.querySelector(config.stateSelector) : null;
    var bar = config.barSelector ? document.querySelector(config.barSelector) : null;
    var count = config.countSelector ? document.querySelector(config.countSelector) : null;
    var playBtn = config.playSelector ? document.querySelector(config.playSelector) : null;
    var rich = !!config.rich;
    var interval = config.interval || 3400;

    var STATE_WORD = ['running', 'running', 'running', 'running', 'running', 'qa', 'verified'];

    function paint() {
      var s = steps[idx];
      tabs.forEach(function (t, i) {
        t.setAttribute('aria-selected', String(i === idx));
        if (i === idx) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
        t.setAttribute('data-done', String(i < idx));
      });
      if (panel) {
        panel.innerHTML = panelHTML(s, { rich: rich });
        if (config.announce) {
          var live = document.getElementById(config.announce);
          if (live) live.textContent = 'STEP ' + s.id + ' / ' + steps.length + ' · ' + s.ko;
        }
      }
      if (label) label.textContent = 'STEP ' + s.id + ' / ' + steps.length + ' · ' + s.ko;
      if (stateHost) {
        stateHost.setAttribute('data-state', STATE_WORD[idx]);
        stateHost.textContent = ko(STATE_WORD[idx]);
      }
      if (bar) bar.style.width = ((idx + 1) / steps.length * 100) + '%';
      if (count) count.textContent = (idx + 1) + ' / ' + steps.length + ' · ' + (playing ? '자동 재생 중' : '일시 정지');
    }

    function go(n, fromUser) {
      idx = Math.max(0, Math.min(steps.length - 1, n));
      paint();
      if (fromUser && window.buildupTrack) window.buildupTrack('demo_step_complete', { step: steps[idx].id });
      if (playing && idx === steps.length - 1) stop();
    }

    function stop() {
      playing = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (playBtn) playBtn.textContent = '자동 재생';
      paint();
    }

    function start() {
      if (idx >= steps.length - 1) idx = 0;
      playing = true;
      if (playBtn) playBtn.textContent = '일시 정지';
      if (window.buildupTrack) window.buildupTrack('demo_start');
      paint();
      timer = setInterval(function () {
        if (idx >= steps.length - 1) { stop(); return; }
        go(idx + 1, false);
      }, interval);
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        if (playing) stop();
        go(parseInt(t.getAttribute('data-step'), 10) - 1, true);
      });
    });

    var prevBtn = config.prevSelector ? document.querySelector(config.prevSelector) : null;
    var nextBtn = config.nextSelector ? document.querySelector(config.nextSelector) : null;
    if (prevBtn) prevBtn.addEventListener('click', function () { if (playing) stop(); go(idx - 1, true); });
    if (nextBtn) nextBtn.addEventListener('click', function () { if (playing) stop(); go(idx + 1, true); });
    if (playBtn) playBtn.addEventListener('click', function () {
      if (playing) stop(); else start();
      if (window.buildupTrack) window.buildupTrack('demo_autoplay_toggle', { playing: playing });
    });

    var list = config.tablistSelector ? document.querySelector(config.tablistSelector) : null;
    if (!list) {
      var firstTab = document.querySelector(config.tabSelector);
      list = firstTab ? firstTab.parentNode : null;
    }
    if (list) {
      list.addEventListener('keydown', function (e) {
        var keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (keys.indexOf(e.key) === -1) return;
        e.preventDefault();
        if (playing) stop();
        if (e.key === 'Home') go(0, true);
        else if (e.key === 'End') go(steps.length - 1, true);
        else go(idx + ((e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1), true);
        if (tabs[idx]) tabs[idx].focus();
      });
    }

    paint();

    function autoStartOnVisible(root) {
      var motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!motionOK || !('IntersectionObserver' in window) || !root) return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); start(); } });
      }, { threshold: 0.3 });
      io.observe(root);
    }

    return { go: go, start: start, stop: stop, paint: paint, autoStartOnVisible: autoStartOnVisible, get index() { return idx; } };
  }

  window.buildupDemoPanelHTML = panelHTML;
  window.buildupCreateDemoMachine = createMachine;
})();
