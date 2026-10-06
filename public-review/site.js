(() => {
  'use strict';
  const cases = window.THEFA_CASES || [];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId = id => cases.find(item => item.id === id) || cases[0];
  const paths = {
    spark:'M12 3l2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3z',
    store:'M4 10v10h16V10M3 10l2-6h14l2 6M3 10h18M9 20v-6h6v6',
    ticket:'M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4V6zM12 8v2m0 4v2',
    chart:'M4 4v16h16M8 16v-4m5 4V8m5 8V5',
    chat:'M4 4h16v12H9l-5 4V4zM8 9h8m-8 3h5',
    wallet:'M4 5h15v15H4V5zM4 9h15m-4 4h6v4h-6v-4z',
    building:'M5 21V3h14v18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3',
    list:'M4 6h2m3 0h11M4 12h2m3 0h11M4 18h2m3 0h11',
    book:'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1V5zM12 6v15',
    send:'M3 10l18-7-7 18-3-8-8-3zM11 13L21 3',
    phone:'M7 3h10v18H7V3zM10 6h4m-3 12h2',
    desktop:'M3 4h18v12H3V4zM12 16v5m-5 0h10',
    shield:'M12 3l8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6l8-3zM8 12l3 3 5-6',
    browser:'M3 4h18v16H3V4zM3 9h18M6 7h1m2 0h1'
  };
  const icon = item => `<span class="case-icon ${esc(item.color)}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[item.icon] || paths.spark}"/></svg></span>`;
  const menu = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('.mobile-nav');
  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    mobileNav.classList.toggle('open', open);
  });
  mobileNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    menu.setAttribute('aria-expanded', 'false'); mobileNav.classList.remove('open');
  }));
  function showDialog(dialog) { dialog.showModal(); document.body.classList.add('dialog-open'); }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) dialog.close(); } });
  });
  document.querySelector('[data-review]')?.addEventListener('click', () => showDialog(document.getElementById('reviewDialog')));

  const grid = document.getElementById('caseGrid');
  if (grid) {
    let category = '전체';
    const search = document.getElementById('caseSearch');
    function renderCases() {
      const query = search.value.trim().toLocaleLowerCase();
      const filtered = cases.filter(item => (category === '전체' || item.category === category) && [item.name,item.label,item.description,...item.features].join(' ').toLocaleLowerCase().includes(query));
      grid.innerHTML = filtered.map(item => `<article class="case-card" data-case="${item.id}"><div class="card-top">${icon(item)}<span class="case-state">${esc(item.status)}</span></div><div class="case-label">${esc(item.label)}</div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><div class="card-features">${item.features.slice(0,3).map(feature=>`<span>${esc(feature)}</span>`).join('')}</div><div class="card-bottom"><button type="button" data-detail="${item.id}" aria-label="${esc(item.name)} 사례 자세히 보기">사례 자세히 보기 <span aria-hidden="true">↗</span></button><a href="demo.html?case=${item.id}">체험하기 <span aria-hidden="true">→</span></a></div></article>`).join('');
      document.getElementById('caseCount').textContent = `${filtered.length}개 사례 · ${category === '전체' ? '전체 개발 영역' : category}`;
      document.getElementById('caseEmpty').hidden = filtered.length > 0;
    }
    document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
      category = button.dataset.category;
      document.querySelectorAll('.filter').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      renderCases();
    }));
    search.addEventListener('input', renderCases);
    grid.addEventListener('click', event => {
      const button = event.target.closest('[data-detail]');
      if (!button) return;
      const item = byId(button.dataset.detail);
      document.getElementById('caseDialogContent').innerHTML = `<div class="case-label">${esc(item.category)} · ${esc(item.status)}</div><h2 id="caseDialogTitle">${esc(item.name)}</h2><p>${esc(item.description)}</p><div class="dialog-features">${item.features.map(feature=>`<span>${esc(feature)}</span>`).join('')}</div><div class="dialog-example"><small>가상 업무 예시</small><p>${esc(item.request)}</p><ol>${item.results.map(result=>`<li>${esc(result)}</li>`).join('')}</ol></div><p class="dialog-note">${esc(item.note)} 실제 고객 데이터와 고객 성과를 사용하지 않습니다.</p><div class="actions"><a class="button primary" href="demo.html?case=${item.id}">이 사례 체험하기 →</a><a class="button light" href="contact.html?case=${item.id}">도입 문의</a></div>`;
      showDialog(document.getElementById('caseDialog'));
    });
    renderCases();
  }

  const demo = document.getElementById('demoTitle');
  if (demo) {
    let selected = byId(new URLSearchParams(location.search).get('case'));
    let timer;
    const choose = document.getElementById('demoSelect');
    const run = document.getElementById('demoRun');
    document.getElementById('demoOptions').innerHTML = cases.map(item=>`<button type="button" class="case-option" data-select-case="${item.id}" aria-pressed="false">${esc(item.name)}<small>${esc(item.label)}</small></button>`).join('');
    choose.innerHTML = cases.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('');
    function selectCase(id) {
      clearTimeout(timer);
      selected = byId(id);
      choose.value = selected.id;
      document.querySelectorAll('[data-select-case]').forEach(button=>button.setAttribute('aria-pressed', String(button.dataset.selectCase === selected.id)));
      demo.textContent = selected.name;
      document.getElementById('demoDescription').textContent = selected.description;
      document.getElementById('demoState').textContent = selected.status;
      document.getElementById('demoRequest').value = selected.request;
      document.getElementById('demoCategory').textContent = selected.label;
      document.getElementById('demoResult').hidden = true;
      document.getElementById('demoPlaceholder').hidden = false;
      document.getElementById('demoProgress').textContent = '';
      run.disabled = false; run.textContent = '예시 결과 보기 →';
      const url = new URL(location.href); url.searchParams.set('case', selected.id); history.replaceState({},'',url);
    }
    document.getElementById('demoOptions').addEventListener('click', event=>{ const button=event.target.closest('[data-select-case]'); if(button)selectCase(button.dataset.selectCase); });
    choose.addEventListener('change', () => selectCase(choose.value));
    run.addEventListener('click', () => {
      run.disabled = true; run.textContent = '예시 화면 준비 중…';
      document.getElementById('demoProgress').textContent = '선택한 사례의 가상 결과를 보여드립니다.';
      timer = setTimeout(() => {
        document.getElementById('resultHeading').textContent = selected.preview;
        document.getElementById('resultItems').innerHTML = selected.results.map(text=>`<li><span class="check" aria-hidden="true">✓</span><span>${esc(text)}</span></li>`).join('');
        document.getElementById('resultNote').textContent = selected.note;
        document.getElementById('resultContact').href = `contact.html?case=${selected.id}`;
        document.getElementById('demoPlaceholder').hidden = true;
        document.getElementById('demoResult').hidden = false;
        document.getElementById('demoProgress').textContent = '가상 예시 결과를 표시했습니다.';
        run.disabled = false; run.textContent = '예시 결과 다시 보기 →';
      }, 450);
    });
    selectCase(selected.id);
  }

  const creationTabs = document.getElementById('creationTabs');
  if (creationTabs) {
    const creations = window.THEFA_CREATIONS || [];
    creationTabs.innerHTML = creations.map(item => `<button type="button" data-creation="${esc(item.id)}" aria-pressed="false">${esc(item.label)} <span aria-hidden="true">↗</span></button>`).join('');
    function selectCreation(id) {
      const selected = creations.find(item => item.id === id);
      if (!selected) return;
      creationTabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.creation === id)));
      document.getElementById('creationTitle').textContent = selected.label;
      document.getElementById('creationRequest').textContent = selected.request;
      document.getElementById('creationOutputs').innerHTML = selected.outputs.map(output => `<li>${esc(output)}</li>`).join('');
    }
    creationTabs.addEventListener('click', event => { const button = event.target.closest('[data-creation]'); if (button) selectCreation(button.dataset.creation); });
    selectCreation(creations[0]?.id);
  }

  const costForm = document.getElementById('costForm');
  if (costForm) {
    const ids = ['basePeople','baseMonths','corePeople','coreMonths','monthlyCost','toolCost','reviewCost'];
    const money = number => `${number.toLocaleString('ko-KR',{maximumFractionDigits:1})}만원`;
    function updateCost() {
      const fields = ids.map(id => document.getElementById(id));
      const status = document.getElementById('costStatus');
      if (fields.some(field => field.value.trim() === '' || !field.validity.valid || !Number.isFinite(Number(field.value)))) {
        ['baseTotal','coreTotal','savingTotal'].forEach(id => document.getElementById(id).textContent = '—');
        ['baseDetail','coreDetail','savingPercent'].forEach(id => document.getElementById(id).textContent = '');
        document.getElementById('savingLabel').textContent = '비용 비교';
        status.textContent = '인원·기간과 비용을 표시된 범위에 맞게 입력해 주세요.';
        return;
      }
      const [basePeople,baseMonths,corePeople,coreMonths,monthlyCost,toolCost,reviewCost] = fields.map(field => Number(field.value));
      const base = basePeople * baseMonths * monthlyCost;
      const core = corePeople * coreMonths * monthlyCost + toolCost + reviewCost;
      const difference = base - core;
      document.getElementById('baseTotal').textContent = money(base);
      document.getElementById('coreTotal').textContent = money(core);
      document.getElementById('baseDetail').textContent = `${basePeople}명 × ${baseMonths}개월 × ${money(monthlyCost)}`;
      document.getElementById('coreDetail').textContent = `${corePeople}명 × ${coreMonths}개월 × ${money(monthlyCost)} + 도구 ${money(toolCost)} + 추가 검수·운영 ${money(reviewCost)}`;
      document.getElementById('savingLabel').textContent = difference > 0 ? '가정상 줄어드는 비용' : difference < 0 ? '가정상 늘어나는 비용' : '가정상 비용 차이';
      document.getElementById('savingTotal').textContent = money(Math.abs(difference));
      document.getElementById('savingPercent').textContent = base > 0 ? `기존 비용 대비 ${Math.abs(difference / base * 100).toLocaleString('ko-KR',{maximumFractionDigits:1})}% ${difference > 0 ? '감소' : difference < 0 ? '증가' : '차이'}` : '기존 비용이 0원이므로 비율을 계산하지 않습니다.';
      status.textContent = '입력한 가정에 따른 계산입니다. 실제 참여 인원, 작업 기간, 품질과 절감 효과는 업무 범위와 검증 결과에 따라 달라집니다.';
    }
    costForm.addEventListener('input', updateCost);
    costForm.addEventListener('submit', event => event.preventDefault());
    updateCost();
  }

  const contact = document.getElementById('contactForm');
  if (contact) {
    const interest = document.getElementById('interest');
    cases.forEach(item => { const option=document.createElement('option'); option.value=item.id; option.textContent=item.name; interest.append(option); });
    const preset = new URLSearchParams(location.search).get('case');
    if (cases.some(item=>item.id===preset)) interest.value=preset;
    contact.addEventListener('submit', event => {
      event.preventDefault();
      const result = document.getElementById('contactStatus');
      result.hidden=false;
      result.textContent='입력 항목을 확인했습니다. 이 화면은 검토용 데모이며 문의를 전송하거나 저장하지 않습니다. 실제 문의는 thefa@thefa.kr로 보내실 수 있습니다.';
    });
    contact.addEventListener('reset',()=>{ document.getElementById('contactStatus').hidden=true; });
  }
})();
