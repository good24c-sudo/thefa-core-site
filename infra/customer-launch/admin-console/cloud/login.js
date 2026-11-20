/* Invite-only email authentication. Authorization and session cookies are server-owned. */
(function () {
  'use strict';
  var emailForm = document.getElementById('emailForm');
  var codeForm = document.getElementById('codeForm');
  var email = document.getElementById('email');
  var code = document.getElementById('code');
  var requestButton = document.getElementById('requestCode');
  var verifyButton = document.getElementById('verifyCode');
  var resendButton = document.getElementById('resendCode');
  var changeButton = document.getElementById('changeEmail');
  var message = document.getElementById('authMessage');
  var retryNotice = document.getElementById('retryNotice');
  var state = { challengeId: null, busy: false, verified: false, nextRequestAt: 0, expiresAt: 0, timer: null };

  function notify(text, type) {
    message.textContent = text;
    message.className = 'status-box' + (type ? ' ' + type : '');
    message.hidden = !text;
  }

  function updateControls() {
    var retry = Math.max(0, Math.ceil((state.nextRequestAt - Date.now()) / 1000));
    var expired = Boolean(state.expiresAt && Date.now() >= state.expiresAt);
    requestButton.disabled = state.busy || retry > 0;
    resendButton.disabled = state.busy || retry > 0;
    verifyButton.disabled = state.busy || expired || !state.challengeId;
    changeButton.disabled = state.busy;
    requestButton.textContent = state.busy && !state.challengeId ? '인증번호 요청 중…' : retry ? '다시 요청까지 ' + retry + '초' : '이메일로 인증번호 받기 →';
    resendButton.textContent = state.busy ? '요청 처리 중…' : retry ? '새 인증번호 요청까지 ' + retry + '초' : '새 인증번호 받기';
    verifyButton.textContent = state.busy && state.challengeId ? '서버에서 확인 중…' : '인증 후 Console 열기 →';
    if (!codeForm.hidden) retryNotice.textContent = expired ? '번호의 유효시간이 지났습니다. 새 인증번호를 요청해 주세요.' : retry ? '새 번호는 ' + retry + '초 후 요청할 수 있습니다.' : '메일이 도착하지 않았다면 새 번호를 요청해 주세요.';
    if (!retry && (!state.expiresAt || expired) && state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function updateTimer() {
    updateControls();
    if (!state.timer) state.timer = setInterval(updateControls, 1000);
  }

  function seconds(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : fallback;
  }

  function failureMessage(status, phase) {
    if (status === 403) return '이 이메일의 Console 접근 허가 또는 인증을 확인하지 못했습니다. 사전에 허가된 참가자만 참여할 수 있습니다.';
    if (status === 429) return '요청 또는 인증 시도 한도에 도달했습니다. 안내된 시간이 지난 뒤 다시 요청해 주세요.';
    if (status === 502) return '메일 전송이 완료되지 않았습니다. 잠시 후 다시 요청하거나 도입 문의로 알려주세요.';
    if (status === 503) return '이메일 인증 서비스를 현재 사용할 수 없습니다. 로그인은 완료되지 않았습니다.';
    if (status === 400) return phase === 'request' ? '이메일 주소를 다시 확인해 주세요.' : '인증번호가 올바르지 않거나 만료되었습니다. 받은 메일을 확인하거나 새 번호를 요청해 주세요.';
    return '인증 응답을 확인하지 못했습니다. 로그인은 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.';
  }

  async function post(url, payload, phase) {
    var response = await fetch(url, {
      method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    var result;
    try { result = await response.json(); }
    catch { throw new Error('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      if (response.status === 429) {
        var headerRetry = response.headers.get('Retry-After');
        var retry = seconds(result.retryAfter, headerRetry === null ? 60 : seconds(Number(headerRetry), 60));
        state.nextRequestAt = Math.max(state.nextRequestAt, Date.now() + retry * 1000);
        updateTimer();
      }
      throw new Error(failureMessage(response.status, phase));
    }
    return result;
  }

  async function requestCode() {
    if (state.busy || Date.now() < state.nextRequestAt) return;
    email.value = email.value.trim();
    if (!email.value || !email.checkValidity()) {
      email.setAttribute('aria-invalid', 'true');
      notify('초대받은 이메일 주소를 올바르게 입력해 주세요.', 'error');
      email.focus(); return;
    }
    email.removeAttribute('aria-invalid');
    state.busy = true; updateControls(); notify('서버에서 접근 허가와 메일 전송을 확인하고 있습니다.');
    try {
      var result = await post('/auth/request-code', { email: email.value }, 'request');
      if (typeof result.challengeId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(result.challengeId)) throw new Error('메일 인증 요청의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      state.challengeId = result.challengeId;
      state.expiresAt = Date.now() + Math.min(600, seconds(result.expiresIn, 600)) * 1000;
      state.nextRequestAt = Date.now() + seconds(result.retryAfter, 60) * 1000;
      email.readOnly = true;
      requestButton.hidden = true;
      codeForm.hidden = false;
      code.value = '';
      code.removeAttribute('aria-invalid');
      notify('인증 메일 전송이 확인되었습니다. 메일로 받은 6자리 인증번호를 입력해 주세요.', 'success');
      updateTimer(); code.focus();
    } catch (error) {
      notify(error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name) ? '메일 요청의 결과를 확인하지 못했습니다. 연결을 확인하고 잠시 후 다시 요청해 주세요.' : error.message, 'error');
    } finally { state.busy = false; updateControls(); }
  }

  emailForm.addEventListener('submit', function (event) { event.preventDefault(); requestCode(); });
  resendButton.addEventListener('click', requestCode);
  codeForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (state.busy || state.verified || !state.challengeId) return;
    if (Date.now() >= state.expiresAt) { notify('인증번호가 만료되었습니다. 새 번호를 요청해 주세요.', 'error'); updateControls(); return; }
    if (!/^[0-9]{6}$/.test(code.value.trim())) {
      code.setAttribute('aria-invalid', 'true'); notify('메일로 받은 6자리 숫자를 입력해 주세요.', 'error'); code.focus(); return;
    }
    state.busy = true; updateControls(); notify('서버에서 이메일 인증과 접근 허가를 확인하고 있습니다.');
    try {
      var result = await post('/auth/verify-code', { challengeId: state.challengeId, code: code.value.trim() }, 'verify');
      if (result.verified !== true) throw new Error('이메일 인증 완료를 확인하지 못했습니다. 로그인은 완료되지 않았습니다.');
      state.verified = true;
      notify('이메일 인증이 확인되었습니다. Console로 이동합니다.', 'success');
      window.location.replace('/');
    } catch (error) {
      code.setAttribute('aria-invalid', 'true');
      notify(error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name) ? '인증 결과를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.' : error.message, 'error');
      code.focus();
    } finally { if (!state.verified) { state.busy = false; updateControls(); } }
  });

  changeButton.addEventListener('click', function () {
    if (state.busy) return;
    state.challengeId = null; state.expiresAt = 0;
    code.value = ''; email.readOnly = false; requestButton.hidden = false; codeForm.hidden = true;
    notify(''); updateControls(); email.focus();
  });
  email.addEventListener('input', function () { email.removeAttribute('aria-invalid'); });
  code.addEventListener('input', function () { code.removeAttribute('aria-invalid'); });
  var reason = new URLSearchParams(window.location.search).get('reason');
  if (reason === 'session-expired') {
    var notice = document.getElementById('sessionNotice');
    notice.textContent = '로그인이 만료되었습니다. 이메일 인증 후 다시 참여해 주세요.';
    notice.hidden = false;
  }
  window.addEventListener('pagehide', function () { if (state.timer) clearInterval(state.timer); });
  updateControls();
})();
