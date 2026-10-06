/* ============================================================
   THEFA Core — Site chrome
   Header, mobile sheet, footer, reveal, FAQ, Tweaks panel,
   Analytics event stub. Shared by every page.

   No third-party scripts. No trackers installed — analytics is an
   event-name-only stub that a provider can be wired into later.
   ============================================================ */

(function () {
  'use strict';

  var D = window.BUILDUP_DATA;
  if (!D) return;

  var motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- analytics stub ----------------
     Real provider is NOT installed. Events are validated against the
     declared list and pushed to a buffer so a provider can drain it. */
  var analytics = {
    buffer: [],
    events: D.analyticsEvents.slice(),
    track: function (name, payload) {
      if (this.events.indexOf(name) === -1) return false;
      this.buffer.push({ name: name, payload: payload || {}, at: Date.now() });
      return true;
    }
  };
  window.buildupTrack = function (n, p) { return analytics.track(n, p); };
  window.__buildupAnalytics = analytics;

  /* ---------------- tiny helpers ---------------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  window.buEsc = esc;
  window.buEl = el;
  /* console-page.js looks for this; without it the Console preview fell
     back to printing raw English state keys ("verified", "qa") next to
     Korean labels. */
  window.buildupStateKo = D.stateKo;

  /* ---------------- clipboard ----------------
     navigator.clipboard needs a secure context and is refused inside
     some embedded webviews, so there is always a textarea+execCommand
     fallback. Resolves true/false; the caller decides what to show. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) { return false; }
  }
  window.buildupCopy = copyText;

  /* A copy chip: the whole chip is the button, the label swaps to a
     confirmation for 2s, and the swap is announced to screen readers
     through the live region the chip owns. */
  function copyChip(value, opts) {
    var o = opts || {};
    return '<button type="button" class="copy-chip" data-copy="' + esc(value) + '"' +
      (o.track ? ' data-copy-track="' + esc(o.track) + '"' : '') +
      ' aria-label="' + esc((o.label || value) + ' 주소 복사하기') + '">' +
      '<span class="copy-chip__icon" aria-hidden="true">' +
        '<svg width="15" height="15" viewBox="0 0 15 15" fill="none">' +
          '<rect x="4.75" y="4.75" width="9.5" height="9.5" rx="2" stroke="currentColor" stroke-width="1.3"/>' +
          '<path d="M10.5 2.25A1.5 1.5 0 0 0 9 .75H2.25a1.5 1.5 0 0 0-1.5 1.5V9a1.5 1.5 0 0 0 1.5 1.5" stroke="currentColor" stroke-width="1.3"/>' +
        '</svg>' +
      '</span>' +
      '<span class="copy-chip__addr">' + esc(o.label || value) + '</span>' +
      '<span class="sr-only" data-copy-live aria-live="polite"></span>' +
    '</button>';
  }
  window.buildupCopyChip = copyChip;

  /* ---------------- section artwork ----------------
     width/height are always emitted so the browser reserves the box and
     the figure cannot shift the page as it decodes (CLS). Everything
     below the hero is lazy. */
  function figure(key, opts) {
    var a = D.art[key];
    if (!a) return '';
    var o = opts || {};
    return '<figure class="figure' + (o.className ? ' ' + o.className : '') + '">' +
      '<div class="figure__frame' + (o.scroll === false ? '' : ' figure__frame--scroll') + '">' +
        '<img src="' + esc(a.src) + '" width="' + a.w + '" height="' + a.h + '" alt="' + esc(a.alt) + '"' +
        (o.eager ? '' : ' loading="lazy"') + ' decoding="async">' +
      '</div>' +
      (a.cap ? '<figcaption class="figure__cap"><b>' + esc(a.tag) + '</b><span>' + esc(a.cap) + '</span></figcaption>' : '') +
    '</figure>';
  }
  window.buildupFigure = figure;

  function initCopy() {
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-copy]');
      if (!chip) return;
      e.preventDefault();
      var value = chip.getAttribute('data-copy');
      var addr = chip.querySelector('.copy-chip__addr');
      var live = chip.querySelector('[data-copy-live]');
      var original = chip.getAttribute('data-copy-original') || (addr ? addr.textContent : '');
      chip.setAttribute('data-copy-original', original);

      copyText(value).then(function (ok) {
        if (!ok) {
          /* Clipboard access can be refused outright — an unfocused
             document, a locked-down webview, a browser that wants a
             permission first. Select the text so the manual copy is a
             single gesture instead of a careful drag. */
          if (addr) {
            try {
              var range = document.createRange();
              range.selectNodeContents(addr);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            } catch (err) { /* ignore */ }
          }
          if (live) live.textContent = '자동 복사가 차단되었습니다. 선택된 주소를 직접 복사해 주세요.';
          return;
        }
        chip.setAttribute('data-copied', 'true');
        if (addr) addr.textContent = '복사했습니다';
        if (live) live.textContent = value + ' 주소를 복사했습니다.';
        var track = chip.getAttribute('data-copy-track');
        if (track) window.buildupTrack(track, { value: value });
        window.clearTimeout(chip.__copyT);
        chip.__copyT = window.setTimeout(function () {
          chip.removeAttribute('data-copied');
          if (addr) addr.textContent = original;
          if (live) live.textContent = '';
        }, 2000);
      });
    });
  }

  /* Which page are we on? Used to mark the current nav item. */
  var path = location.pathname.split('/').pop() || 'index.html';

  /* ---------------- header ---------------- */
  function buildHeader(host) {
    var onLight = host.dataset.theme === 'light';
    var logo = onLight
      ? 'assets/brand/core/THEFA_Core_Primary_Light_web.svg'
      : 'assets/brand/core/THEFA_Core_Primary_Dark_web.svg';

    host.className = 'site-header' + (onLight ? ' light-header' : '');
    host.setAttribute('data-scrolled', 'false');

    var nav = D.nav.map(function (item) {
      var target = item.href.split('#')[0];
      var current = target && target === path;
      return '<a href="' + esc(item.href) + '"' + (current ? ' aria-current="true"' : '') + '>' + esc(item.label) + '</a>';
    }).join('');

    host.innerHTML =
      '<div class="shell header-inner">' +
        '<a class="brand" href="index.html" aria-label="THEFA Core 홈으로 이동">' +
          '<img src="' + logo + '" width="1621" height="424" alt="THEFA Core — a product by THE FA">' +
        '</a>' +
        '<nav class="nav" aria-label="주요 섹션">' + nav + '</nav>' +
        '<div class="header-actions">' +
          '<a class="header-login header-login-desktop" href="login.html" data-track="login_click">로그인</a>' +
          /* The header CTA used to say "체험하기" and point at a page where
             nothing could be tried. The one action that genuinely works
             today is the contact form, so that is what it offers. */
          /* The label lives in its own span so it can be ellipsized. A
             bare text node cannot be, and a machine-translated CTA is
             long enough to push the whole header sideways at 320px. */
          '<a class="btn btn--primary header-cta" href="contact.html" data-track="contact_click">' +
            '<span class="header-cta__label"><span class="long">THEFA Core&nbsp;</span>도입 문의</span>' +
          '</a>' +
          '<button class="menu-toggle" type="button" id="menuToggle" aria-expanded="false" aria-controls="mobileSheet" aria-label="메뉴 열기">' +
            '<svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">' +
              '<path d="M0 1h18M0 7h18M0 13h18" stroke="currentColor" stroke-width="1.6"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    /* mobile sheet */
    var sheet = el('div', 'mobile-sheet');
    sheet.id = 'mobileSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '사이트 메뉴');
    sheet.hidden = true;
    sheet.innerHTML =
      '<div class="mobile-sheet__bar">' +
        '<img src="' + logo + '" height="30" alt="THEFA Core">' +
        '<button class="mobile-sheet__close" type="button" id="sheetClose" aria-label="메뉴 닫기">' +
          '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">' +
            '<path d="M1 1l13 13M14 1L1 14" stroke="currentColor" stroke-width="1.6"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<div class="mobile-sheet__body">' +
        D.nav.map(function (i) { return '<a href="' + esc(i.href) + '">' + esc(i.label) + '</a>'; }).join('') +
        '<div class="ms-sep" role="presentation"></div>' +
        '<a href="console.html">Console Preview</a>' +
        '<a href="login.html" data-track="login_click">로그인</a>' +
        '<a href="signup.html" data-track="early_access_click">Early Access 신청</a>' +
        '<div class="mobile-sheet__foot">' +
          '<a class="btn btn--primary btn--block btn--lg" href="contact.html" data-track="contact_click">도입 문의하기</a>' +
          '<a class="btn btn--ghost btn--block" href="demo.html" data-track="nav_demo_click">실행 흐름 체험하기</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);

    var toggle = host.querySelector('#menuToggle');
    var close = sheet.querySelector('#sheetClose');
    var lastFocus = null;

    function openSheet() {
      lastFocus = document.activeElement;
      sheet.hidden = false;
      /* The transition needs a layout pass between `hidden = false` and
         `data-open`, or it has no start value to animate from. rAF was
         doing that job, but rAF does not fire in a backgrounded or
         non-rendering tab — and then the sheet stayed mounted,
         invisible and un-closable. Reading offsetHeight forces the same
         reflow synchronously and always runs. */
      void sheet.offsetHeight;
      sheet.setAttribute('data-open', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', '메뉴 닫기');
      document.body.style.overflow = 'hidden';
      /* A second reflow so the visibility:hidden -> visible flip has
         actually been applied. focus() on a still-hidden element is
         silently ignored, which left keyboard users stranded on the
         page behind an open menu. */
      void sheet.offsetHeight;
      close.focus();
    }
    function closeSheet() {
      sheet.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '메뉴 열기');
      document.body.style.overflow = '';
      window.setTimeout(function () { sheet.hidden = true; }, motionOK ? 260 : 0);
      /* Return focus where it came from, but never to <body> — closing
         the menu has to leave the keyboard on the control that opened
         it, not at the top of the document. */
      var back = (lastFocus && lastFocus.focus && lastFocus !== document.body) ? lastFocus : toggle;
      back.focus();
    }

    toggle.addEventListener('click', function () {
      if (toggle.getAttribute('aria-expanded') === 'true') closeSheet(); else openSheet();
    });
    close.addEventListener('click', closeSheet);
    sheet.addEventListener('click', function (e) { if (e.target.closest('a')) closeSheet(); });
    document.addEventListener('keydown', function (e) {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (e.key === 'Escape') { closeSheet(); return; }
      /* aria-modal="true" promises the rest of the page is inert. Without
         a trap, Tab walked straight out of the sheet and into the links
         behind it, which a screen-reader user cannot see are there. */
      if (e.key !== 'Tab') return;
      var items = sheet.querySelectorAll('a[href], button:not([disabled])');
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    /* scroll state */
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        host.setAttribute('data-scrolled', window.scrollY > 12 ? 'true' : 'false');
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- footer ---------------- */
  function col(title, items) {
    return '<div class="footer-col"><h2>' + esc(title) + '</h2><ul>' +
      items.map(function (i) {
        var attrs = i.external ? ' target="_blank" rel="noopener noreferrer"' : '';
        var track = i.external ? ' data-track="thefa_link_click"' : '';
        return '<li><a href="' + esc(i.href) + '"' + attrs + track + '>' + esc(i.label) + '</a></li>';
      }).join('') +
      '</ul></div>';
  }

  function buildFooter(host) {
    host.className = 'site-footer';
    host.innerHTML =
      '<div class="shell">' +
        '<div class="footer-grid">' +
          '<div class="footer-brand">' +
            '<img src="assets/brand/core/THEFA_Core_Primary_Dark_web.svg" width="1621" height="424" alt="THEFA Core" loading="lazy" decoding="async">' +
            '<p class="footer-by">THEFA Core by THE FA</p>' +
            '<p class="caption" style="margin-top:10px;max-width:32ch">' +
              'AI 실행 운영체제. 요청을 작업으로 나누고, 실행과 검증 결과까지 하나의 흐름으로 연결합니다.' +
            '</p>' +
            '<div class="footer-contact">' +
              '<span class="caption">문의</span>' +
              copyChip(D.meta.links.email, { track: 'email_copy' }) +
            '</div>' +
          '</div>' +
          col('제품', D.footer.product) +
          col('계정', D.footer.service) +
          '<div class="footer-company">' + col('회사', D.footer.company) +
          (host.dataset.mascot === 'footer' ? '<img class="core-mascot core-mascot--footer" src="assets/img/mascots/goodbye-320.webp" srcset="assets/img/mascots/goodbye-320.webp 320w, assets/img/mascots/goodbye-640.webp 640w" sizes="(max-width: 640px) 112px, 144px" width="320" height="320" alt="" aria-hidden="true" loading="lazy" decoding="async">' : '') + '</div>' +
        '</div>' +
        '<div class="footer-legal">' +
          '<div class="footer-co">' +
            '<span><strong style="color:var(--tx-on-dark)">' + esc(D.meta.legal) + '</strong></span>' +
            '<span>법인명 주식회사 더파 (The Fa Co., Ltd.) · THE FA가 만드는 제품 THEFA Core</span>' +
            '<span>회사 정보와 문의는 <a href="' + D.meta.links.thefa + '" target="_blank" rel="noopener noreferrer">thefa.kr</a>에서 확인할 수 있습니다.</span>' +
          '</div>' +
          '<div class="footer-bottom-links">' +
            D.footer.legal.map(function (i) {
              var attrs = i.external ? ' target="_blank" rel="noopener noreferrer"' : '';
              return '<a href="' + esc(i.href) + '"' + attrs + '>' + esc(i.label) + '</a>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="footer-legal" style="border-top:1px solid var(--ink-line);margin-top:22px;padding-top:18px">' +
          '<span>' + esc(D.footer.copyright) + '</span>' +
          '<span class="caption">이 페이지의 제품 화면은 구조 설명용 예시이며, 실제 THEFA Core 화면과 다를 수 있습니다.</span>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- reveal on scroll ----------------
     Opt-in pattern: elements are visible by default in CSS. We only hide
     them once an IntersectionObserver is confirmed live, and a failsafe
     timer unhides anything the observer missed. Content therefore can never
     get stuck invisible. */
  var revealSeen = [];

  function showAll() {
    /* Remove the attribute rather than setting "shown": the CSS default for
       a bare .reveal is visible, so this can never leave content hidden. */
    revealSeen.forEach(function (n) { n.removeAttribute('data-reveal'); });
  }

  function initReveal() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!nodes.length) return;

    nodes.forEach(function (n) { if (revealSeen.indexOf(n) === -1) revealSeen.push(n); });

    if (!motionOK || !('IntersectionObserver' in window)) { showAll(); return; }

    nodes.forEach(function (n) {
      if (n.getAttribute('data-reveal') !== 'shown') n.setAttribute('data-reveal', 'pending');
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.setAttribute('data-reveal', 'shown');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    nodes.forEach(function (n) { io.observe(n); });

    /* Failsafe: if anything is still hidden shortly after boot, show it.
       Protects against observer quirks inside nested frames. */
    window.clearTimeout(initReveal._t);
    initReveal._t = window.setTimeout(function () {
      if (document.querySelector('.reveal[data-reveal="pending"]')) showAll();
    }, 1200);
  }

  /* ---------------- FAQ ---------------- */
  function initFaq() {
    document.querySelectorAll('.faq-item').forEach(function (item, i) {
      if (item.dataset.faqReady === '1') return;
      item.dataset.faqReady = '1';
      var btn = item.querySelector('.faq-q');
      var panel = item.querySelector('.faq-a');
      if (!btn || !panel) return;
      var id = 'faq-panel-' + i;
      panel.id = id;
      btn.setAttribute('aria-controls', id);
      btn.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        panel.hidden = open;
        if (!open) window.buildupTrack('faq_open', { index: i });
      });
    });
  }

  /* ---------------- scroll-to (no scrollIntoView) ---------------- */
  function initAnchorScroll() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      if (!id) return;
      var t = document.getElementById(id);
      if (!t) return;
      e.preventDefault();
      var top = t.getBoundingClientRect().top + window.pageYOffset - 84;
      window.scrollTo({ top: top, behavior: motionOK ? 'smooth' : 'auto' });
    });
  }

  /* ---------------- tracking on marked elements ---------------- */
  function initTracking() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-track]');
      if (!a) return;
      window.buildupTrack(a.getAttribute('data-track'));
    });
  }

  /* ---------------- TWEAKS ---------------- */
  var TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "heroVariant": "command",
  "sectionRhythm": "contrast",
  "motion": "restrained",
  "goldUsage": "controlled",
  "density": "comfortable",
  "accent": "#F4B223"
}/*EDITMODE-END*/;

  var tweakState = Object.assign({}, TWEAK_DEFAULTS);
  try {
    var saved = localStorage.getItem('buildup-tweaks');
    if (saved) tweakState = Object.assign(tweakState, JSON.parse(saved));
  } catch (err) { /* ignore */ }

  function applyTweaks() {
    var r = document.documentElement;
    r.setAttribute('data-tweak-hero', tweakState.heroVariant);
    r.setAttribute('data-tweak-rhythm', tweakState.sectionRhythm);
    r.setAttribute('data-tweak-motion', tweakState.motion);
    r.setAttribute('data-tweak-gold', tweakState.goldUsage);
    r.setAttribute('data-tweak-density', tweakState.density);
    r.style.setProperty('--gold', tweakState.accent);
    if (window.__buildupOnTweak) window.__buildupOnTweak(tweakState);
  }

  function setTweak(key, value) {
    tweakState[key] = value;
    try { localStorage.setItem('buildup-tweaks', JSON.stringify(tweakState)); } catch (err) { /* ignore */ }
    applyTweaks();
    try {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { heroVariant: tweakState.heroVariant } }, '*');
    } catch (err) { /* ignore */ }
  }

  function buildTweaks() {
    var panel = el('div', 'tweaks');
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Tweaks');

    var groups = [
      { key: 'heroVariant', label: 'Hero 시각화', opts: [['command', 'A · Command 분해형'], ['pipeline', 'B · 파이프라인형']] },
      { key: 'sectionRhythm', label: '섹션 리듬', opts: [['contrast', '다크·라이트 교차'], ['technical', '다크 중심'], ['light', '라이트 중심']] },
      { key: 'motion', label: '모션 강도', opts: [['restrained', '절제'], ['medium', '중간'], ['minimal', '최소']] },
      { key: 'goldUsage', label: 'Gold 사용', opts: [['controlled', '제한적'], ['strong', '강조 강화']] },
      { key: 'density', label: '여백 밀도', opts: [['comfortable', '넉넉'], ['compact', '조밀']] }
    ];

    panel.innerHTML =
      '<div class="tweaks__head" id="tweakDrag"><strong>Tweaks</strong><button type="button" id="tweakClose" aria-label="Tweaks 닫기">✕</button></div>' +
      '<div class="tweaks__body">' +
        groups.map(function (g) {
          return '<div><span class="tweak__label">' + esc(g.label) + '</span><div class="tweak__opts" role="group" aria-label="' + esc(g.label) + '">' +
            g.opts.map(function (o) {
              return '<button type="button" class="tweak__opt" data-key="' + g.key + '" data-value="' + o[0] + '" aria-pressed="false">' + esc(o[1]) + '</button>';
            }).join('') +
          '</div></div>';
        }).join('') +
        '<div><span class="tweak__label">강조 색</span><div class="tweak__swatches" role="group" aria-label="강조 색">' +
          ['#F4B223', '#E8A317', '#D78B00'].map(function (c) {
            return '<button type="button" class="tweak__swatch" data-key="accent" data-value="' + c + '" style="background:' + c + '" aria-pressed="false" aria-label="강조 색 ' + c + '"></button>';
          }).join('') +
        '</div></div>' +
        '<p class="caption" style="margin:0">이 패널은 디자인 검토용입니다. 실제 공개 사이트에서는 꺼진 상태로 보입니다.</p>' +
      '</div>';
    document.body.appendChild(panel);

    function syncPanel() {
      panel.querySelectorAll('[data-key]').forEach(function (b) {
        var k = b.getAttribute('data-key');
        var v = b.getAttribute('data-value');
        b.setAttribute('aria-pressed', String(tweakState[k] === v));
      });
    }

    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-key]');
      if (!b) return;
      setTweak(b.getAttribute('data-key'), b.getAttribute('data-value'));
      syncPanel();
    });
    panel.querySelector('#tweakClose').addEventListener('click', function () { panel.hidden = true; });

    /* drag */
    (function () {
      var handle = panel.querySelector('#tweakDrag');
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      handle.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button')) return;
        dragging = true;
        var rect = panel.getBoundingClientRect();
        ox = rect.left; oy = rect.top;
        sx = e.clientX; sy = e.clientY;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        panel.style.left = Math.max(6, Math.min(window.innerWidth - 60, ox + e.clientX - sx)) + 'px';
        panel.style.top = Math.max(6, Math.min(window.innerHeight - 60, oy + e.clientY - sy)) + 'px';
      });
      handle.addEventListener('pointerup', function (e) {
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
    })();

    syncPanel();
    return { panel: panel, sync: syncPanel };
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var headerHost = document.querySelector('[data-site-header]');
    if (headerHost) buildHeader(headerHost);
    var footerHost = document.querySelector('[data-site-footer]');
    if (footerHost) buildFooter(footerHost);

    initReveal();
    initFaq();
    initAnchorScroll();
    initTracking();
    initCopy();

    /* Tweaks: register the listener BEFORE announcing availability. */
    var tweaks = null;
    window.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === '__activate_edit_mode') {
        if (!tweaks) tweaks = buildTweaks();
        tweaks.panel.hidden = false;
        tweaks.sync();
        tweaks.panel.style.display = 'block';
      } else if (d.type === '__deactivate_edit_mode') {
        if (tweaks) tweaks.panel.hidden = true;
      }
    });
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (err) { /* ignore */ }

    applyTweaks();
    document.documentElement.setAttribute('data-booted', 'true');

    /* Exposed so page renderers can re-run these after they build their DOM. */
    window.buildupReveal = initReveal;
    window.buildupInitFaq = initFaq;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.buildupTweakState = tweakState;
})();
