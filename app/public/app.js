const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const model = {
  user: null,
  workspaces: [],
  records: { tasks: [], runs: [], workUnits: [], approvals: [], artifacts: [], qa: [], receipts: [] },
  connections: null,
  recordType: 'runs'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? esc(value) : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'REQUEST_FAILED'), { status: response.status, body });
  return body;
}
function emptyState(text = '아직 기록이 없습니다', detail = '실제 데이터가 생기면 여기에 표시됩니다.') {
  return `<div class="empty-state"><strong>${esc(text)}</strong><p>${esc(detail)}</p></div>`;
}

function currentWorkspace() { return model.workspaces[0] || null; }

function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#workspace-view').classList.add('hidden');
}

function showWorkspace() {
  $('#login-view').classList.add('hidden');
  $('#workspace-view').classList.remove('hidden');
  renderAll();
}

function applyBootstrap(data) {
  model.user = data.user;
  model.workspaces = data.workspaces || [];
  model.records = { ...model.records, ...(data.records || {}) };
  model.connections = data.connections || null;
}

async function bootstrap() {
  try {
    applyBootstrap(await api('/api/bootstrap'));
    showWorkspace();
  } catch (error) {
    if (error.status === 401) return showLogin();
    $('#login-message').textContent = '작업실 상태를 읽지 못했습니다.';
    showLogin();
  }
}
function renderMetrics() {
  $('#metric-tasks').textContent = model.records.tasks.length;
  $('#metric-runs').textContent = model.records.runs.length;
  $('#metric-approvals').textContent = model.records.approvals.filter(item => !item.decision).length;
  $('#metric-receipts').textContent = model.records.receipts.length;
}

function renderIdentity() {
  const workspace = currentWorkspace();
  $('#current-user').textContent = model.user?.email || '';
  $('#workspace-name').textContent = workspace?.name || 'Workspace';
  $('#settings-user').textContent = model.user?.email || '—';
  $('#settings-workspace').textContent = workspace?.name || '—';
  const pending = model.connections?.workUnitApi?.state !== 'READY';
  $('#home-connection').textContent = pending ? '연결 준비 중' : '연결됨';
  $('#connection-chip').textContent = pending ? '연결 준비 중' : '연결됨';
}

function renderTasks() {
  const list = $('#task-list');
  if (!model.records.tasks.length) {
    list.innerHTML = emptyState('저장된 작업이 없습니다', '새 작업을 만들면 서버에 실제로 저장됩니다.');
    return;
  }
  list.innerHTML = [...model.records.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(task => `
    <article class="list-card" data-task-id="${esc(task.id)}">
      <div class="list-card-head"><div><h3>${esc(task.title)}</h3><p>${esc(task.summary || '설명 없음')}</p></div><span class="badge">${esc(task.status)}</span></div>
      <div class="card-meta"><span>${fmt(task.updatedAt)}</span><span>${esc(task.id)}</span></div>
      <div class="card-actions">
        <button class="ghost task-state" data-next="${task.status === 'READY' ? 'DRAFT' : 'READY'}">${task.status === 'READY' ? '초안으로' : '실행 준비'}</button>
        <button class="run-button task-run">실행 요청</button>
      </div>
      <div class="inline-message" aria-live="polite"></div>
    </article>`).join('');
}
function genericCard(item, type) {
  const title = item.title || item.name || item.kind || item.id;
  const state = item.status || item.state || item.decision || type;
  return `<article class="list-card"><div class="list-card-head"><div><h3>${esc(title)}</h3><p>${esc(item.summary || item.message || '')}</p></div><span class="badge">${esc(state)}</span></div><div class="card-meta"><span>${fmt(item.updatedAt || item.createdAt || item.issuedAt)}</span><span>${esc(item.id || '')}</span></div></article>`;
}

function renderApprovals() {
  const list = $('#approval-list');
  if (!model.records.approvals.length) {
    list.innerHTML = emptyState('대기 중인 승인이 없습니다', '실제 실행기에서 승인 요청이 생기면 여기에 표시됩니다.');
    return;
  }
  list.innerHTML = model.records.approvals.map(item => genericCard(item, 'Approval')).join('');
}

function renderRecords() {
  const list = $('#record-list');
  const rows = model.records[model.recordType] || [];
  if (!rows.length) {
    list.innerHTML = emptyState(`${model.recordType} 기록이 없습니다`, '가짜 실행 기록은 만들지 않습니다.');
    return;
  }
  list.innerHTML = rows.map(item => genericCard(item, model.recordType)).join('');
}

function renderAll() {
  renderMetrics();
  renderIdentity();
  renderTasks();
  renderApprovals();
  renderRecords();
}

function navigate(route) {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.route === route));
  $$('.page').forEach(page => page.classList.toggle('active-page', page.dataset.page === route));
  history.replaceState(null, '', `#${route}`);
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-message').textContent = '';
  const email = $('#email').value;
  const accessCode = $('#access-code').value;
  try {
    await api('/api/session', { method: 'POST', body: JSON.stringify({ email, accessCode }) });
    applyBootstrap(await api('/api/bootstrap'));
    showWorkspace();
  } catch (error) {
    if (error.message === 'ACCESS_CODE_INVALID') $('#access-code-row').classList.remove('hidden');
    const messages = {
      ACCESS_CODE_INVALID: 'Preview access code를 확인해 주세요.',
      EMAIL_NOT_ALLOWED: '이 Preview에 허용되지 않은 이메일입니다.',
      EMAIL_INVALID: '이메일 형식을 확인해 주세요.'
    };
    $('#login-message').textContent = messages[error.message] || '로그인하지 못했습니다.';
  }
});

$('#logout').addEventListener('click', async () => {
  try { await api('/api/session', { method: 'DELETE' }); } catch {}
  model.user = null;
  showLogin();
});

$$('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.route)));

$('#toggle-task-form').addEventListener('click', () => $('#task-form').classList.toggle('hidden'));
$('#cancel-task').addEventListener('click', () => $('#task-form').classList.add('hidden'));
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const workspace = currentWorkspace();
  if (!workspace) return;
  $('#task-message').textContent = '';
  try {
    await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: $('#task-title').value, summary: $('#task-summary').value })
    });
    $('#task-form').reset();
    $('#task-form').classList.add('hidden');
    applyBootstrap(await api('/api/bootstrap'));
    renderAll();
  } catch {
    $('#task-message').textContent = '작업을 저장하지 못했습니다.';
  }
});

$('#task-list').addEventListener('click', async event => {
  const card = event.target.closest('[data-task-id]');
  if (!card) return;
  const workspace = currentWorkspace();
  const taskId = card.dataset.taskId;
  const message = card.querySelector('.inline-message');
  if (event.target.closest('.task-state')) {
    const status = event.target.closest('.task-state').dataset.next;
    await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    applyBootstrap(await api('/api/bootstrap'));
    renderAll();
  }
  if (event.target.closest('.task-run')) {
    message.textContent = '실행 연결 상태를 확인 중…';
    try {
      await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/tasks/${encodeURIComponent(taskId)}/execute`, {
        method: 'POST', body: JSON.stringify({})
      });
    } catch (error) {
      if (error.message === 'WORK_UNIT_CONNECTION_PENDING') {
        message.textContent = '연결 준비 중 · Run/WorkUnit은 생성되지 않았습니다.';
      } else {
        message.textContent = '실행 연결 상태를 확인하지 못했습니다.';
      }
    }
  }
});

$$('.record-tab').forEach(button => button.addEventListener('click', () => {
  model.recordType = button.dataset.record;
  $$('.record-tab').forEach(item => item.classList.toggle('active', item === button));
  renderRecords();
}));

const route = location.hash.replace('#', '');
if (['home', 'tasks', 'approvals', 'records', 'connections', 'settings'].includes(route)) navigate(route);
bootstrap();
