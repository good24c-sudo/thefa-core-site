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
  let submitted = false;
  let preparedBody = '';
  let preparedFields = '';
  const currentFields = () => JSON.stringify([
    ...['cfName','cfCompany','cfEmail','cfPhone','cfTopic','cfScope','cfMessage'].map(id => get(id).value),
    get('cfConsent').checked
  ]);
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
    error('cfConsent', consent.checked ? '' : '회신을 위한 개인정보 처리에 동의해 주세요.');
    return first || (!consent.checked ? consent : null);
  }
  function clearResult() {
    result.hidden = true;
    preparedBody = '';
    preparedFields = '';
    get('cfMailLink').removeAttribute('href');
    get('cfCopyStatus').textContent = '';
    get('cfLive').textContent = '';
  }
  const selected = (window.THEFA_CASES || []).find(item => item.id === new URLSearchParams(location.search).get('case'));
  if (selected) get('cfMessage').value = selected.name + ' 도입을 검토하고 있습니다.\n필요한 업무: ';
  function onEdit() {
    if (!result.hidden && currentFields() !== preparedFields) clearResult();
    if (submitted) validate();
  }
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    submitted = true;
    if (get('cfWebsite').value) return;
    const first = validate();
    if (first) {
      get('cfLive').textContent = '표시된 입력 항목을 확인해 주세요.';
      first.focus();
      return;
    }
    const value = id => get(id).value.trim();
    const subject = '[THEFA Core 도입 문의] ' + [value('cfCompany'), value('cfName'), value('cfTopic')].filter(Boolean).join(' · ');
    preparedBody = [
      '이름: ' + value('cfName'), '회사 · 조직: ' + (value('cfCompany') || '-'),
      '회신받을 이메일: ' + value('cfEmail'), '연락처: ' + (value('cfPhone') || '-'),
      '문의 유형: ' + value('cfTopic'), '검토 중인 실행 범위: ' + value('cfScope'),
      '', '문의 내용', '────────────', value('cfMessage'), '',
      '보낸 경로: THEFA Core 웹사이트 문의 폼',
      '보낸 시각: ' + new Date().toLocaleString('ko-KR')
    ].join('\n');
    const prefix = 'mailto:thefa@thefa.kr?subject=' + encodeURIComponent(subject.slice(0, 100)) + '&body=';
    const fullLink = prefix + encodeURIComponent(preparedBody);
    const shortened = fullLink.length > 2000;
    const fallback = '문의 내용이 길어 전체 본문은 홈페이지의 “문의 내용 복사”로 복사한 뒤 이 메일에 붙여넣어 주세요.\n\n회신받을 이메일: ' + value('cfEmail');
    get('cfMailLink').href = shortened ? prefix + encodeURIComponent(fallback) : fullLink;
    get('cfMailHelp').textContent = shortened
      ? '문의 내용이 길어 메일에는 안내문만 담깁니다. 먼저 전체 내용을 복사한 뒤 메일 앱에 붙여넣어 보내주세요.'
      : '아래 버튼으로 메일 앱을 열고 내용을 확인한 뒤 직접 보내주세요. 메일 앱이 없으면 문의 내용을 복사해 thefa@thefa.kr로 보내실 수 있습니다.';
    get('cfCopyBox').value = preparedBody;
    preparedFields = currentFields();
    result.hidden = false;
    get('cfDone').focus();
    get('cfLive').textContent = '문의 메일이 준비되었습니다. 메일 앱에서 직접 보내주세요.';
  });
  get('cfCopy').addEventListener('click', async () => {
    if (!preparedBody) return;
    try {
      await navigator.clipboard.writeText(preparedBody);
      get('cfCopyStatus').textContent = '문의 내용을 복사했습니다.';
    } catch {
      get('cfCopyBox').focus();
      get('cfCopyBox').select();
      get('cfCopyStatus').textContent = '본문을 선택했습니다. 복사해 메일에 붙여넣어 주세요.';
    }
  });
  form.addEventListener('reset', () => {
    submitted = false;
    rules.forEach(([id]) => error(id, ''));
    error('cfConsent', '');
    clearResult();
  });
})();
