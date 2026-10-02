/* ============================================================
   THEFA Core — shell pages (login / signup / contact)

   What is real here and what is not
   ---------------------------------
   · The CONTACT form is real. It validates, composes a complete,
     readable enquiry and delivers it to thefa@thefa.kr — either by
     POSTing to D.config.formEndpoint when one is configured, or by
     handing a fully prepared message to the visitor's mail app, with a
     copy-everything fallback for people who have no mail client.
   · SIGN-IN is a finished UI with a deliberately unarmed hand-off.
     Completing an OAuth exchange needs a server holding client secrets;
     a static page cannot do it and must not pretend to. Until
     D.config.authEnabled is true, every provider button says so plainly
     instead of faking a session.
   ============================================================ */

(function () {
  'use strict';

  var D = window.BUILDUP_DATA;
  if (!D) return;

  var CF = D.contactForm;
  var EMAIL = D.meta.links.email;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function q(id) { return document.getElementById(id); }
  function setHTML(id, v) { var n = q(id); if (n) n.innerHTML = v; }
  function track(name, payload) { if (window.buildupTrack) window.buildupTrack(name, payload); }

  /* ============================================================
     Shared: provider marks
     Each mark is the provider's own logo, inline so there is no extra
     request and no third-party asset to go stale. Google keeps its
     brand colours (its guidelines require it); the monochrome marks
     inherit currentColor so they work on either surface.
     ============================================================ */
  var MARKS = {
    google:
      '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
        '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
        '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
        '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>' +
        '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
      '</svg>',
    microsoft:
      '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
        '<path fill="#F25022" d="M0 0h8.55v8.55H0z"/>' +
        '<path fill="#7FBA00" d="M9.45 0H18v8.55H9.45z"/>' +
        '<path fill="#00A4EF" d="M0 9.45h8.55V18H0z"/>' +
        '<path fill="#FFB900" d="M9.45 9.45H18V18H9.45z"/>' +
      '</svg>',
    apple:
      '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
        '<path d="M12.6 9.56c.02-1.72 1.4-2.55 1.47-2.59-.8-1.18-2.05-1.34-2.5-1.36-1.06-.1-2.08.63-2.62.63-.54 0-1.38-.62-2.27-.6-1.16.02-2.24.68-2.84 1.73-1.21 2.1-.31 5.21.87 6.92.58.84 1.27 1.78 2.17 1.74.87-.03 1.2-.56 2.25-.56s1.35.56 2.27.54c.94-.02 1.53-.85 2.1-1.69.66-.97.93-1.91.95-1.96-.02-.01-1.82-.7-1.85-2.8zM10.9 4.5c.48-.58.8-1.39.71-2.19-.69.03-1.52.46-2.01 1.04-.44.51-.83 1.33-.73 2.12.77.06 1.55-.39 2.03-.97z"/>' +
      '</svg>',
    github:
      '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
        '<path d="M9 0C4.03 0 0 4.03 0 9c0 3.98 2.58 7.35 6.16 8.54.45.08.62-.2.62-.43v-1.5C4.28 16.16 3.75 14.4 3.75 14.4c-.41-1.05-1-1.33-1-1.33-.82-.56.06-.55.06-.55.91.06 1.38.93 1.38.93.8 1.38 2.11.98 2.63.75.08-.58.31-.98.57-1.2-2-.23-4.1-1-4.1-4.45 0-.98.35-1.79.93-2.42-.1-.23-.4-1.15.08-2.4 0 0 .76-.24 2.48.92A8.6 8.6 0 0 1 9 4.3c.77 0 1.54.1 2.26.3 1.72-1.16 2.47-.92 2.47-.92.49 1.25.18 2.17.09 2.4.58.63.93 1.44.93 2.42 0 3.46-2.11 4.22-4.12 4.44.33.28.61.83.61 1.67v2.47c0 .24.17.52.63.43A9 9 0 0 0 9 0z"/>' +
      '</svg>'
  };

  /* ============================================================
     CONTACT
     ============================================================ */

  function buildContactForm() {
    var host = q('contactFormHost');
    if (!host) return;

    function field(id, label, control, hint, required) {
      return '<div class="field" data-field="' + id + '">' +
        '<label for="' + id + '">' + esc(label) +
          (required ? '<span class="req" aria-hidden="true">*</span>' : '') + '</label>' +
        control +
        (hint ? '<span class="field__hint">' + esc(hint) + '</span>' : '') +
        '<span class="field__error" id="' + id + 'Err" hidden></span>' +
      '</div>';
    }
    function options(list) {
      return list.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    }

    host.innerHTML =
      '<form class="contact-form" id="contactForm" novalidate>' +
        '<div class="form-row">' +
          field('cfName', CF.fields.name,
            '<input type="text" id="cfName" name="name" autocomplete="name" placeholder="홍길동" required>', '', true) +
          field('cfCompany', CF.fields.company,
            '<input type="text" id="cfCompany" name="company" autocomplete="organization" placeholder="주식회사 예시">') +
        '</div>' +
        '<div class="form-row">' +
          field('cfEmail', CF.fields.email,
            '<input type="email" id="cfEmail" name="email" autocomplete="email" inputmode="email" placeholder="name@company.com" required>', '', true) +
          field('cfPhone', CF.fields.phone,
            '<input type="tel" id="cfPhone" name="phone" autocomplete="tel" inputmode="tel" placeholder="010-0000-0000">') +
        '</div>' +
        '<div class="form-row">' +
          field('cfTopic', CF.fields.topic,
            '<select id="cfTopic" name="topic">' + options(CF.topics) + '</select>') +
          field('cfScope', CF.fields.scope,
            '<select id="cfScope" name="scope">' + options(CF.scopes) + '</select>') +
        '</div>' +
        field('cfMessage', CF.fields.message,
          '<textarea id="cfMessage" name="message" required placeholder="팀 규모, 현재 사용 중인 도구, 해결하고 싶은 문제, 검토 일정 등을 적어주시면 검토가 빨라집니다."></textarea>',
          '', true) +

        /* Honeypot. A real visitor never sees or focuses this. */
        '<div class="hp-field" aria-hidden="true">' +
          '<label for="cfWebsite">Website</label>' +
          '<input type="text" id="cfWebsite" name="website" tabindex="-1" autocomplete="off">' +
        '</div>' +

        '<label class="form-consent" for="cfConsent" id="cfConsentBox">' +
          '<input type="checkbox" id="cfConsent" name="consent" required>' +
          '<span>' + esc(CF.consent) +
            ' <a href="' + esc(D.meta.links.thefaPrivacy) + '" target="_blank" rel="noopener noreferrer">' + esc(CF.consentLink) + '</a>' +
            '<span class="field__error" id="cfConsentErr" hidden style="display:block;margin-top:6px"></span>' +
          '</span>' +
        '</label>' +

        '<div class="form-actions">' +
          '<button class="btn btn--primary btn--lg" type="submit" id="cfSubmit">' + esc(CF.submit) + '</button>' +
          '<button class="btn btn--ghost" type="button" id="cfReset">초기화</button>' +
        '</div>' +

        '<div class="form-status" id="cfStatus" hidden role="alert"></div>' +
        '<span class="sr-only" id="cfLive" aria-live="polite"></span>' +
      '</form>' +
      '<div id="cfResult"></div>';

    wireContactForm();
  }

  function wireContactForm() {
    var form = q('contactForm');
    if (!form) return;
    var submitted = false;

    var RULES = [
      { id: 'cfName', test: function (v) { return v.trim().length > 0; }, msg: CF.required },
      { id: 'cfEmail', test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }, msg: CF.invalidEmail },
      { id: 'cfMessage', test: function (v) { return v.trim().length >= 10; }, msg: '문의 내용을 10자 이상 적어주세요.' }
    ];

    function showError(id, msg) {
      var wrap = form.querySelector('[data-field="' + id + '"]');
      var err = q(id + 'Err');
      var input = q(id);
      if (wrap) wrap.setAttribute('data-invalid', 'true');
      if (err) { err.textContent = msg; err.hidden = false; }
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', id + 'Err');
      }
    }
    function clearError(id) {
      var wrap = form.querySelector('[data-field="' + id + '"]');
      var err = q(id + 'Err');
      var input = q(id);
      if (wrap) wrap.removeAttribute('data-invalid');
      if (err) { err.hidden = true; err.textContent = ''; }
      if (input) { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    }

    function validate() {
      var firstBad = null;
      RULES.forEach(function (r) {
        var input = q(r.id);
        if (!input) return;
        if (r.test(input.value)) { clearError(r.id); }
        else { showError(r.id, r.msg); if (!firstBad) firstBad = input; }
      });
      var consent = q('cfConsent');
      var box = q('cfConsentBox');
      var cErr = q('cfConsentErr');
      if (consent && !consent.checked) {
        if (box) box.setAttribute('data-invalid', 'true');
        if (cErr) { cErr.textContent = CF.needConsent; cErr.hidden = false; }
        if (!firstBad) firstBad = consent;
      } else {
        if (box) box.removeAttribute('data-invalid');
        if (cErr) { cErr.hidden = true; cErr.textContent = ''; }
      }
      return firstBad;
    }

    /* Re-validate a field as soon as the visitor fixes it, but only
       after the first submit — scolding someone mid-keystroke on their
       first pass through a form is the classic way to make it feel
       hostile. */
    form.addEventListener('input', function (e) {
      if (!submitted) return;
      var id = e.target.id;
      var rule = RULES.filter(function (r) { return r.id === id; })[0];
      if (rule && rule.test(e.target.value)) clearError(id);
      if (id === 'cfConsent' && e.target.checked) {
        var box = q('cfConsentBox'); var cErr = q('cfConsentErr');
        if (box) box.removeAttribute('data-invalid');
        if (cErr) cErr.hidden = true;
      }
    });

    function collect() {
      return {
        name: (q('cfName') || {}).value || '',
        company: (q('cfCompany') || {}).value || '',
        email: (q('cfEmail') || {}).value || '',
        phone: (q('cfPhone') || {}).value || '',
        topic: (q('cfTopic') || {}).value || '',
        scope: (q('cfScope') || {}).value || '',
        message: (q('cfMessage') || {}).value || ''
      };
    }

    function plainText(d) {
      var L = CF.fields;
      return [
        L.name + ': ' + d.name,
        L.company + ': ' + (d.company || '-'),
        L.email + ': ' + d.email,
        L.phone + ': ' + (d.phone || '-'),
        L.topic + ': ' + d.topic,
        L.scope + ': ' + d.scope,
        '',
        L.message,
        '----------------------------------------',
        d.message,
        '',
        '----------------------------------------',
        '보낸 경로: THEFA Core 웹사이트 문의 폼',
        '보낸 시각: ' + new Date().toLocaleString('ko-KR')
      ].join('\n');
    }

    function subjectFor(d) {
      return CF.subjectPrefix + ' ' + (d.company ? d.company + ' · ' : '') + d.name + ' · ' + d.topic;
    }

    function openMail(d) {
      var body = plainText(d);
      /* Browsers and mail clients cut a mailto: somewhere around 2000
         characters, and a silently truncated enquiry is worse than a
         short one. Keep the handed-off body safely inside that, and
         point at the copy box which always holds everything. */
      var mailBody = body.length > 1400
        ? body.slice(0, 1400) + '\n\n…(내용이 길어 일부만 담겼습니다. 페이지의 “문의 내용 복사”로 전체를 붙여넣어 주세요.)'
        : body;
      var href = 'mailto:' + EMAIL +
        '?subject=' + encodeURIComponent(subjectFor(d)) +
        '&body=' + encodeURIComponent(mailBody);
      try { window.location.href = href; } catch (err) { /* ignore */ }
      return body;
    }

    function renderResult(d, mode) {
      var body = plainText(d);
      var sent = mode === 'sent';
      var html =
        '<div class="form-done" tabindex="-1" id="cfDone">' +
          '<div class="form-done__title">' +
            '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
              '<circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.6"/>' +
              '<path d="M6 10.2l2.8 2.8L14 7.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
            esc(sent ? '문의가 접수되었습니다' : CF.doneTitle) +
          '</div>' +
          '<p>' + esc(sent ? CF.doneBodySent : CF.doneBody) + '</p>' +
          '<div class="btn-row">' +
            (window.buildupCopyChip ? window.buildupCopyChip(EMAIL, { track: 'email_copy' }) : '') +
          '</div>' +
        '</div>';

      if (!sent) {
        html +=
          '<div class="form-fallback">' +
            '<strong>' + esc(CF.fallbackTitle) + '</strong>' +
            '<span>아래 내용을 그대로 복사해 <b>' + esc(EMAIL) + '</b> 로 보내주셔도 접수됩니다.</span>' +
            '<label class="sr-only" for="cfCopyBox">문의 내용 전체</label>' +
            '<textarea id="cfCopyBox" readonly>' + esc(body) + '</textarea>' +
            '<div class="btn-row">' +
              '<button class="btn btn--primary btn--sm" type="button" data-copy="' + esc(body) + '" data-copy-track="contact_copy">' +
                esc(CF.copyBody) + '</button>' +
              '<a class="btn btn--ghost btn--sm" href="mailto:' + esc(EMAIL) + '?subject=' + encodeURIComponent(subjectFor(d)) + '">메일 앱 다시 열기</a>' +
            '</div>' +
          '</div>';
      }

      var host = q('cfResult');
      if (host) {
        host.innerHTML = html;
        var done = q('cfDone');
        if (done) done.focus();
      }
      var live = q('cfLive');
      if (live) live.textContent = sent ? '문의가 접수되었습니다.' : '문의 메일이 준비되었습니다.';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitted = true;

      /* Honeypot: a filled hidden field means a bot. Do nothing visible
         — a bot that is told it failed just tries again. */
      var hp = q('cfWebsite');
      if (hp && hp.value) return;

      var bad = validate();
      var status = q('cfStatus');
      if (bad) {
        if (status) {
          status.hidden = false;
          status.innerHTML = '<strong>입력을 확인해 주세요.</strong><span>표시된 항목을 채우면 바로 보낼 수 있습니다.</span>';
        }
        bad.focus();
        return;
      }
      if (status) status.hidden = true;

      var data = collect();
      var btn = q('cfSubmit');
      track('contact_submit', { topic: data.topic, mode: D.config.formEndpoint ? 'endpoint' : 'mail' });

      if (!D.config.formEndpoint) {
        openMail(data);
        renderResult(data, 'mail');
        return;
      }

      /* An endpoint is configured: POST, and fall back to mail if the
         request fails for any reason, so a dead endpoint never swallows
         somebody's enquiry. */
      if (btn) { btn.disabled = true; btn.textContent = CF.submitting; }
      var payload = {
        name: data.name, company: data.company, email: data.email, phone: data.phone,
        topic: data.topic, scope: data.scope, message: data.message,
        _subject: subjectFor(data), _to: EMAIL, source: 'buildup-os-web'
      };
      fetch(D.config.formEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (!res.ok) throw new Error('bad status ' + res.status);
        renderResult(data, 'sent');
        form.reset();
      }).catch(function () {
        openMail(data);
        renderResult(data, 'mail');
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = CF.submit; }
      });
    });

    var reset = q('cfReset');
    if (reset) reset.addEventListener('click', function () {
      form.reset();
      submitted = false;
      RULES.forEach(function (r) { clearError(r.id); });
      var box = q('cfConsentBox'); if (box) box.removeAttribute('data-invalid');
      var cErr = q('cfConsentErr'); if (cErr) cErr.hidden = true;
      var status = q('cfStatus'); if (status) status.hidden = true;
      var host = q('cfResult'); if (host) host.innerHTML = '';
    });
  }

  function channel(icon, title, desc, href, external) {
    var attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return '<a class="channel" href="' + esc(href) + '"' + attrs + '>' +
      '<span class="channel__icon" aria-hidden="true">' + icon + '</span>' +
      '<span><span class="channel__t">' + esc(title) + '</span>' +
      '<span class="channel__d">' + esc(desc) + '</span></span>' +
      '<span class="channel__go" aria-hidden="true">' +
        '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 7.5h9M8.5 4l3.5 3.5L8.5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>' +
    '</a>';
  }

  var ICON_MAIL = '<svg width="19" height="19" viewBox="0 0 19 19" fill="none"><rect x="1.5" y="3.5" width="16" height="12" rx="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 5l7 5 7-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_SITE = '<svg width="19" height="19" viewBox="0 0 19 19" fill="none"><circle cx="9.5" cy="9.5" r="8" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 9.5h16M9.5 1.5c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8s1.1-5.7 3.3-8z" stroke="currentColor" stroke-width="1.4"/></svg>';
  var ICON_DOC = '<svg width="19" height="19" viewBox="0 0 19 19" fill="none"><path d="M4 2.5h7l4 4v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10.5 2.5V7h4.5M6 11h7M6 14h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function bootContact() {
    buildContactForm();

    /* email: both a mail link and a one-tap copy */
    setHTML('contactEmailRow',
      '<a class="btn btn--primary btn--lg" href="mailto:' + esc(EMAIL) +
        '?subject=' + encodeURIComponent(CF.subjectPrefix) + '" data-track="contact_click">메일로 바로 보내기</a>' +
      (window.buildupCopyChip ? window.buildupCopyChip(EMAIL, { track: 'email_copy' }) : ''));

    setHTML('contactChannels',
      channel(ICON_MAIL, '이메일', EMAIL + ' · 누르면 메일 앱이 열립니다',
        'mailto:' + EMAIL + '?subject=' + encodeURIComponent(CF.subjectPrefix), false) +
      channel(ICON_SITE, 'THE FA 공식 문의 창구', '회사 차원의 기술·데이터 협력 문의',
        D.meta.links.thefaContact, true) +
      channel(ICON_DOC, '개인정보 처리방침', '문의 과정에서 수집되는 정보의 처리 기준',
        D.meta.links.thefaPrivacy, true));

    setHTML('audienceGrid', D.earlyAccess.audiences.map(function (a) {
      return '<article class="trust-card">' +
        '<span class="trust-card__title">' + esc(a.title) + '</span>' +
        '<span class="trust-card__body">' + esc(a.body) + '</span>' +
        '<span class="badge badge--early" style="margin-top:6px">' + esc(a.need) + '</span>' +
      '</article>';
    }).join(''));
  }

  /* ============================================================
     SIGN-IN / SIGN-UP (shared shell)
     ============================================================ */

  function ssoList() {
    return '<div class="sso-list">' + D.auth.providers.map(function (p) {
      return '<button class="sso-btn" type="button" data-provider="' + esc(p.id) + '">' +
        '<span class="sso-btn__mark" aria-hidden="true">' + (MARKS[p.id] || '') + '</span>' +
        '<span>' + esc(p.label) + '</span>' +
        '<span class="sso-btn__spacer" aria-hidden="true"></span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function wireSso(statusId) {
    document.querySelectorAll('.sso-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var provider = btn.getAttribute('data-provider');
        track('sso_click', { provider: provider });

        if (D.config.authEnabled && D.config.authBaseUrl) {
          btn.setAttribute('aria-busy', 'true');
          var base = D.config.authBaseUrl.replace(/\/+$/, '');
          window.location.href = base + '/' + encodeURIComponent(provider) +
            '?redirect_uri=' + encodeURIComponent(window.location.origin + '/console.html');
          return;
        }

        var status = q(statusId);
        if (!status) return;
        status.hidden = false;
        status.innerHTML =
          '<strong>' + esc(D.auth.notReadyTitle) + '</strong>' +
          '<span>' + esc(D.auth.notReadyBody) + '</span>' +
          '<span style="margin-top:4px">먼저 도입을 검토 중이시라면 <a href="contact.html" style="color:var(--gold-text);font-weight:600">문의 폼</a>으로 알려주세요. 계정이 열리는 시점을 함께 안내드립니다.</span>';
        status.setAttribute('tabindex', '-1');
        status.focus();
      });
    });
  }

  function bootLogin() {
    var host = q('loginFormHost');
    if (!host) return;

    host.innerHTML =
      ssoList() +
      '<div class="sso-divider" role="separator"><span>또는</span></div>' +
      '<form id="loginEmailForm" novalidate>' +
        '<div class="field">' +
          '<label for="loginEmail">이메일 주소</label>' +
          '<input type="email" id="loginEmail" name="email" inputmode="email" autocomplete="email" placeholder="name@company.com">' +
          '<span class="field__hint">' + esc(D.auth.emailHint) + '</span>' +
        '</div>' +
        '<button class="btn btn--primary btn--block btn--lg" type="submit">' + esc(D.auth.emailLabel) + '</button>' +
        '<div class="form-status" id="loginStatus" hidden role="status"></div>' +
      '</form>' +
      '<p class="auth-switch">아직 계정이 없으신가요? <a href="signup.html" data-track="early_access_click">Early Access 신청</a></p>' +
      '<p class="auth-legal">계속하면 <a href="' + esc(D.meta.links.thefaPrivacy) + '" target="_blank" rel="noopener noreferrer">개인정보 처리방침</a>에 동의하는 것으로 봅니다. THEFA Core는 주식회사 더파의 제품입니다.</p>';

    wireSso('loginStatus');

    var form = q('loginEmailForm');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = q('loginStatus');
      if (!status) return;
      status.hidden = false;
      status.innerHTML =
        '<strong>' + esc(D.auth.notReadyTitle) + '</strong>' +
        '<span>입력하신 주소는 전송되거나 저장되지 않았습니다. 계정 기능이 열리면 이 화면에서 바로 로그인할 수 있습니다.</span>' +
        '<span style="margin-top:4px">지금 연락처를 남기시려면 <a href="contact.html" style="color:var(--gold-text);font-weight:600">문의 폼</a>을 이용해 주세요.</span>';
      track('login_click', { result: 'not_connected' });
    });
  }

  function bootSignup() {
    var host = q('signupFormHost');
    if (!host) return;

    host.innerHTML =
      ssoList() +
      '<div class="sso-divider" role="separator"><span>또는</span></div>' +
      '<div class="link-list">' +
        '<a href="contact.html" data-track="contact_click">문의 폼으로 Early Access 신청' +
          '<span>사용 환경과 실행 범위를 알려주시면 담당자가 회신드립니다</span></a>' +
        '<a href="mailto:' + esc(EMAIL) + '?subject=' + encodeURIComponent('[THEFA Core Early Access 문의]') + '">' +
          '이메일로 바로 신청<span>' + esc(EMAIL) + '</span></a>' +
      '</div>' +
      '<div class="form-status" id="signupStatus" hidden role="status"></div>' +
      '<p class="auth-switch">이미 안내를 받으셨나요? <a href="login.html" data-track="login_click">로그인</a></p>' +
      '<p class="auth-legal">계정 생성과 Console 사용은 아직 열려 있지 않습니다. 현재 접수 중인 것은 도입 검토 문의입니다.</p>';

    wireSso('signupStatus');

    setHTML('audienceGrid', D.earlyAccess.audiences.map(function (a) {
      return '<article class="trust-card">' +
        '<span class="trust-card__title">' + esc(a.title) + '</span>' +
        '<span class="trust-card__body">' + esc(a.body) + '</span>' +
        '<span class="badge badge--early" style="margin-top:6px">' + esc(a.need) + '</span>' +
      '</article>';
    }).join(''));
  }

  /* ============================================================
     BOOT
     ============================================================ */

  function boot() {
    var page = document.body.getAttribute('data-page');
    if (page === 'contact') bootContact();
    else if (page === 'login') bootLogin();
    else if (page === 'signup') bootSignup();

    /* the auth pages share one supporting illustration */
    var art = q('authArt');
    if (art && D.art.auth) {
      art.innerHTML = '<img src="' + esc(D.art.auth.src) + '" width="' + D.art.auth.w +
        '" height="' + D.art.auth.h + '" alt="' + esc(D.art.auth.alt) + '" loading="lazy" decoding="async">';
    }

    if (window.buildupReveal) window.buildupReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
