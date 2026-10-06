(() => {
  'use strict';
  const form = document.getElementById('contactForm');
  if (!form) return;
  const get = id => document.getElementById(id);
  const rules = [
    ['cfName', value => value.trim().length > 0, '이름을 입력해 주세요.'],
    ['cfEmail', value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()), '이메일 주소 형식을 확인해 주세요.'],
    ['cfMessage', value => value.trim().length >= 10, '문의 내용을 10자 이상 입력해 주세요.']
  ];
  const result = get('cfResult');
  const status = get('cfStatus');
  const submit = get('cfSubmit');
  let submitted = false;
  let sending = false;
  function error(id, message) {
    const field = get(id);
    const label = get(id + 'Err');
    field.setAttribute('aria-invalid', String(Boolean(message)));
    label.textContent = message;
    label.hidden = !message;
  }
  function validate() {
    let first;
    for (const [id, valid, message] of rules) {
      const bad = !valid(get(id).value);
      error(id, bad ? message : '');
      if (bad && !first) first = get(id);
    }
    const consent = get('cfConsent');
    error('cfConsent', consent.checked ? '' : '문의 전달과 회신을 위한 개인정보 처리에 동의해 주세요.');
    return first || (!consent.checked ? consent : null);
  }
  function clearResult() {
    result.hidden = true;
    status.hidden = true;
    status.textContent = '';
    get('cfLive').textContent = '';
  }
  const selected = (window.THEFA_CASES || []).find(item => item.id === new URLSearchParams(location.search).get('case'));
  if (selected) get('cfMessage').value = selected.name + ' 도입을 검토하고 있습니다.\n필요한 업무: ';
  function onEdit() {
    if (sending) return;
    clearResult();
    if (submitted) validate();
  }
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || get('cfWebsite').value) return;
    submitted = true;
    clearResult();
    const first = validate();
    if (first) {
      get('cfLive').textContent = '표시된 입력 항목을 확인해 주세요.';
      first.focus();
      return;
    }
    const data = new FormData(form);
    const value = id => get(id).value.trim();
    data.set('_subject', ('[THEFA Core 도입 문의] ' + [value('cfCompany'), value('cfName'), value('cfTopic')].filter(Boolean).join(' · ')).replace(/[\r\n]/g, ' ').slice(0, 160));
    data.set('source', 'THEFA Core 웹사이트 문의 폼');
    const fields = Array.from(form.elements);
    const disabled = fields.map(field => field.disabled);
    sending = true;
    fields.forEach(field => { field.disabled = true; });
    submit.textContent = '전송 중…';
    form.setAttribute('aria-busy', 'true');
    get('cfLive').textContent = '문의 내용을 전송하고 있습니다.';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: data,
        headers: {Accept: 'application/json'},
        signal: controller.signal
      });
      if (!response.ok) throw new Error('FORM_REJECTED');
      form.reset();
      result.hidden = false;
      get('cfDone').focus();
      get('cfLive').textContent = '문의가 전송되었습니다.';
    } catch {
      result.hidden = true;
      status.textContent = '문의 전송을 확인하지 못했습니다. 입력 내용은 그대로 남겨두었습니다. 잠시 후 다시 시도하거나 thefa@thefa.kr로 연락해 주세요.';
      status.hidden = false;
      status.focus();
      get('cfLive').textContent = '문의 전송을 확인하지 못했습니다.';
    } finally {
      clearTimeout(timeout);
      fields.forEach((field, index) => { field.disabled = disabled[index]; });
      submit.textContent = '문의 보내기 →';
      form.removeAttribute('aria-busy');
      sending = false;
    }
  });
  form.addEventListener('reset', () => {
    submitted = false;
    rules.forEach(([id]) => error(id, ''));
    error('cfConsent', '');
    clearResult();
  });
})();
