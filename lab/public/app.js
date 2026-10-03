'use strict';

const $ = selector => document.querySelector(selector);
const model = { state: null, selectedTaskId: null, view: 'home', connected: false, creating: false, pending: new Set(), receipts: new Map(), receiptLoading: null };
const viewNames = { home: '홈', projects: '프로젝트', resources: 'AI 팀 / 자원', approvals: '승인 필요', results: '결과물', memory: 'Memory', connections: 'Connections', usage: 'Usage' };
const statusNames = { VERIFIED: '시험 결과 검증됨', RUNNING: '실행 중', QUEUED: '실행 대기', CREATED: '목표 접수', PLANNED: '계획 준비', PAUSED: '일시 정지 · 이어서 실행 가능', WAITING_APPROVAL: '승인 대기', FAILED: '실패 · 이어서 실행 가능', FAILED_RETRYABLE: '실패 · 이어서 실행 가능', REJECTED: '승인 거절됨', SKIPPED: '실행 건너뜀', COMPLETED: '단계 수행됨', PENDING: '대기', PASSED: '검사 통과', PASS: '검사 통과', APPROVED: '시험 승인됨' };
const stageNames = { REQUEST: '목표 접수', GOAL: '목표 이해', PLAN: '계획', WORK_UNITS: '작업 나누기', RESOURCE_SELECTION: '자원 선택', EXECUTION: '실행', REVIEW: '검토', QA: '검사', ARTIFACT: '결과 파일', RECEIPT: '실행 영수증', VERIFIED: '결과 검증' };
const presets = { safe: 'THE FA Core 테스트 보고서를 만들어줘', research: 'THE FA Core 시장 리서치 흐름을 시험해줘', summary: '이 텍스트를 3줄로 요약해줘', approval: 'Production에 배포', failure: '실패한 작업을 기록한 지점부터 이어서 실행해줘', failover: '모의 제공자 장애 시 다른 제공자로 전환해줘' };
const scenarioModes = { safe: 'LOCAL', research: 'MOCK', summary: 'LOCAL', approval: 'MOCK', failure: 'LOCAL', failover: 'MOCK' };

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function fmt(value) { const date = new Date(value); return value && !Number.isNaN(date.valueOf()) ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '확인 기록 없음'; }
function badge(mode) { const validMode = ['REAL', 'LOCAL', 'MOCK', 'PLANNED', 'DISCONNECTED'].includes(String(mode).toUpperCase()) ? String(mode).toUpperCase() : 'DISCONNECTED'; return `<span class="badge ${validMode.toLowerCase()}">${validMode}</span>`; }
function status(statusValue) { return `<span class="status-pill ${esc(String(statusValue || '').toLowerCase())}">${esc(statusNames[statusValue] || statusValue || '상태 확인 중')}</span>`; }
function empty(title, description) { return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◇</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`; }
function selectedTask() { return model.state?.tasks.find(task => task.id === model.selectedTaskId); }
function taskTitle(taskId) { return model.state?.tasks.find(task => task.id === taskId)?.title || taskId; }
function resourceMode(resource) { return resource.status === 'CONNECTED' && resource.executionLocation === 'PC' ? 'LOCAL' : ['MOCK', 'PLANNED'].includes(resource.status) ? resource.status : 'DISCONNECTED'; }
function resourceName(resource) { return resource.model ? `${resource.provider} · ${resource.model}` : resource.provider || resource.id; }
function identifierPath(value) { return encodeURIComponent(String(value)); }
function scopeNote(task) {
  if (!task) return '로컬 시험 결과입니다. 실제 외부 업무 실행 여부는 별도로 확인해야 합니다.';
  if (task.scenario === 'approval') return '검증 범위: 모의 승인 절차와 로컬 시험 보고서. 실제 배포는 수행하지 않습니다. 승인 범위는 SANDBOX_SIMULATION_ONLY입니다.';
  if (task.scenario === 'summary' || task.qa?.scope === 'OUTPUT_EXISTS_AND_INTEGRITY_ONLY') return '검증 범위: 기존 Local AI의 응답 존재와 파일 무결성. 요약 내용의 의미 정확도는 아직 검증되지 않았습니다.';
  if (task.mode === 'MOCK' || ['research', 'failover'].includes(task.scenario)) return '검증 범위: 가상 제공자의 예시 출력과 파일 무결성. 실제 시장 조사와 유료 AI 실행은 수행하지 않습니다.';
  if (task.scenario === 'failure') return '검증 범위: 로컬 Worker 실패, 저장한 지점부터 재개, 시험 보고서와 파일 검사.';
  return '검증 범위: 이 PC의 시험 보고서 생성, 파일 검사, 실행 영수증. 입력한 목표의 실제 업무 수행은 별도로 검증해야 합니다.';
}
async function requestKey(request) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)));
  const signature = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  let previous;
  try { previous = JSON.parse(sessionStorage.getItem('core-lab-pending-request') || 'null'); } catch { previous = null; }
  if (previous?.signature === signature && typeof previous.key === 'string') return previous.key;
  const key = crypto.randomUUID();
  try { sessionStorage.setItem('core-lab-pending-request', JSON.stringify({ signature, key })); } catch { /* Browsers may block storage; double-click protection remains active. */ }
  return key;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || `요청에 실패했습니다 (${response.status})`);
  return body;
}
function showError(message) { const element = $('#global-error'); element.textContent = message; element.hidden = !message; }
function setConnection(connected, message) {
  model.connected = connected;
  $('#connection-status').textContent = message || (connected ? '로컬 서버 연결됨' : '연결 확인 필요');
  $('#connection-dot').className = `connection-dot ${connected ? 'ready' : 'offline'}`;
  $('#submit-goal').disabled = !connected || model.creating;
}
function switchView(view) {
  if (!viewNames[view]) return;
  model.view = view;
  document.querySelectorAll('.view').forEach(element => { element.hidden = element.id !== `${view}-view`; });
  document.querySelectorAll('.nav-item').forEach(element => { const active = element.dataset.view === view; element.classList.toggle('active', active); active ? element.setAttribute('aria-current', 'page') : element.removeAttribute('aria-current'); });
  $('#view-name').textContent = viewNames[view];
  history.replaceState(null, '', `#${view}`);
  $('#main').focus({ preventScroll: true });
}
function applyState(state) {
  if (!state || !Array.isArray(state.tasks)) { showError('로컬 서버 응답 형식을 확인할 수 없습니다.'); return; }
  model.state = { tasks: [], resources: [], approvals: [], artifacts: [], receipts: [], memory: [], usage: {}, pipeline: [], environment: {}, ...state };
  if (model.selectedTaskId && !selectedTask()) model.selectedTaskId = null;
  if (!model.selectedTaskId && state.tasks.length) model.selectedTaskId = state.tasks[state.tasks.length - 1].id;
  const active = document.activeElement;
  const focusedAction = active?.dataset?.action;
  const focusedId = active?.dataset?.id;
  renderAll();
  if (focusedAction && focusedId && !document.contains(active)) {
    const replacement = [...document.querySelectorAll('[data-action][data-id]')].find(element => element.dataset.action === focusedAction && element.dataset.id === focusedId);
    replacement?.focus({ preventScroll: true });
  }
}

function renderAll() {
  renderTasks(); renderTaskDetail(); renderResourceSummary(); renderResources(); renderApprovals(); renderArtifacts(); renderMemory(); renderConnections(); renderUsage(); renderProjects(); renderAdvanced();
}
function renderTasks() {
  const tasks = model.state.tasks.slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  $('#task-count').textContent = tasks.length ? `${tasks.length}개 작업` : '아직 작업 없음';
  $('#task-list').innerHTML = tasks.length ? tasks.map(task => {
    const index = model.state.pipeline.indexOf(task.currentStage);
    const progress = task.status === 'VERIFIED' ? 100 : Math.max(4, (index + 1) / Math.max(model.state.pipeline.length, 1) * 100);
    return `<button class="task-card ${task.id === model.selectedTaskId ? 'selected' : ''}" data-action="select-task" data-id="${esc(task.id)}" aria-pressed="${task.id === model.selectedTaskId}"><div class="task-card-top"><h3>${esc(task.title)}</h3>${status(task.status)}</div><div class="task-meta">${badge(task.mode)}<span>${esc(stageNames[task.currentStage] || task.currentStage)}</span><span>·</span><span>${esc(task.selectedResource?.provider || '자원 선택 대기')}</span><small>${fmt(task.updatedAt)}</small></div><div class="mini-progress" aria-hidden="true"><span style="width:${progress}%"></span></div></button>`;
  }).join('') : empty('목표가 실행의 시작입니다', '첫 지시를 맡기면 진행 과정과 결과가 이곳에 쌓입니다.');
}
function renderTaskDetail() {
  const task = selectedTask();
  $('#task-detail').hidden = !task;
  if (!task) return;
  const resource = task.selectedResource;
  const events = task.events || [];
  const recordedStages = new Set(events.map(event => event.stage));
  const artifact = model.state.artifacts.find(item => item.id === task.artifactId);
  const approval = model.state.approvals.find(item => item.taskId === task.id && item.status === 'PENDING');
  const checks = task.qa?.checks || [];
  const runningAction = model.pending.has(task.id);
  $('#task-detail').innerHTML = `<div class="detail-heading"><div><span class="eyebrow">YOUR CURRENT WORK</span><h2>${esc(task.title)}</h2><p class="detail-subtitle">${esc(task.id)} · ${fmt(task.createdAt)}</p></div>${status(task.status)}</div>${task.error ? `<div class="notice ${task.status === 'SKIPPED' ? '' : 'error'}">${esc(typeof task.error === 'object' ? task.error.message || JSON.stringify(task.error) : task.error)}</div>` : ''}${approval ? '<div class="notice">위험 작업을 감지하여 멈췄습니다. 승인해도 시험 결과만 기록하며 실제 Production은 변경하지 않습니다.</div>' : ''}<div class="pipeline" aria-label="실행 단계">${model.state.pipeline.map(stage => `<span class="pipeline-step ${stage === task.currentStage ? 'current' : recordedStages.has(stage) ? 'done' : ''}"${stage === task.currentStage ? ' aria-current="step"' : ''}>${esc(stageNames[stage] || stage)}</span>`).join('')}</div><div class="detail-actions">${['FAILED', 'FAILED_RETRYABLE', 'PAUSED'].includes(task.status) ? `<button class="button secondary" data-action="resume" data-id="${esc(task.id)}"${runningAction ? ' disabled' : ''}>${runningAction ? '이어서 실행 요청 중…' : '기록한 지점부터 이어서 실행'}</button>` : ''}${approval ? `<button class="button secondary" data-action="approve" data-id="${esc(task.id)}"${runningAction ? ' disabled' : ''}>시험 절차만 승인</button><button class="button danger" data-action="reject" data-id="${esc(task.id)}"${runningAction ? ' disabled' : ''}>승인 거절</button>` : ''}${artifact ? `<a class="button secondary" href="/api/artifacts/${identifierPath(artifact.id)}" download="${esc(artifact.name)}">결과 파일 다운로드 <span aria-hidden="true">↗</span></a>` : ''}${task.receiptId ? `<button class="button" data-action="receipt" data-id="${esc(task.id)}">실행 영수증 확인</button>` : ''}</div><div class="detail-columns"><section><h3>Core의 실행 계획</h3>${task.plan?.length ? `<ol class="plan-list">${task.plan.map(step => `<li>${esc(step.title)}</li>`).join('')}</ol>` : '<p class="subtle">계획을 준비하고 있습니다.</p>'}${resource ? `<div class="record-meta">${badge(resource.mode || task.mode)}<span>${esc(resource.provider)}${resource.model ? ` / ${esc(resource.model)}` : ''}</span><span>위치: ${esc(resource.executionLocation || '확인 중')}</span></div>` : ''}</section><section><h3>최근 실행 기록</h3>${events.length ? events.slice(-6).reverse().map(event => `<div class="execution-event"><strong>${esc(event.message)}</strong><time datetime="${esc(event.at)}">${fmt(event.at)}</time> · ${esc(stageNames[event.stage] || event.stage)} · ${esc(event.mode || task.mode)}</div>`).join('') : '<p class="subtle">아직 실행 기록이 없습니다.</p>'}</section></div><section class="detail-qa"><h3>결과 확인</h3>${checks.length ? checks.map(check => `<div class="qa-check ${check.passed ? '' : 'failed'}"><span aria-hidden="true">${check.passed ? '✓' : '×'}</span>${esc(check.name)} · ${check.passed ? '통과' : '통과하지 못함'}</div>`).join('') : '<p class="subtle">검사가 끝나면 확인 항목과 결과를 표시합니다.</p>'}${task.qa?.artifactSha256 ? `<div class="record-meta">SHA-256 <code>${esc(task.qa.artifactSha256)}</code></div>` : ''}</section>`;
  const scope = document.createElement('p');
  scope.className = 'notice';
  scope.textContent = scopeNote(task);
  $('#task-detail .detail-heading').after(scope);
}
function renderResourceSummary() {
  const connected = model.state.resources.filter(resource => resource.status === 'CONNECTED');
  const visible = connected.slice(0, 3);
  $('#resource-summary').innerHTML = visible.length ? visible.map(resource => `<div class="resource-summary-row"><span class="resource-summary-icon" aria-hidden="true">◇</span><div><strong>${esc(resourceName(resource))}</strong><small>${esc(resource.executionLocation)} · ${esc((resource.capabilities || []).slice(0, 2).join(', '))}</small></div>${badge(resourceMode(resource))}</div>`).join('') : '<p class="subtle">사용 가능함을 확인한 자원이 없습니다.</p>';
}
function resourceCard(resource) {
  return `<article class="resource-card"><div class="record-top"><h3>${esc(resourceName(resource))}</h3>${badge(resourceMode(resource))}</div><p>${esc((resource.capabilities || []).join(' · ') || '지원 기능 미확인')}</p><dl><dt>자원 ID</dt><dd><code>${esc(resource.id)}</code></dd><dt>사용 가능 여부</dt><dd>${esc({ available: '사용 가능함을 확인', unavailable: '현재 사용 불가', unverified: '확인하지 못함' }[resource.availability] || resource.availability)}</dd><dt>연결 방식</dt><dd>${esc(resource.connectionMode)}</dd><dt>비용 분류</dt><dd>${esc({ 'local-compute': 'PC의 로컬 연산', unverified: '측정되지 않음', none: '외부 비용 없음' }[resource.costClass] || resource.costClass)}</dd><dt>실행 위치</dt><dd>${esc(resource.executionLocation)}</dd><dt>마지막 확인</dt><dd>${fmt(resource.lastCheck)}</dd>${Array.isArray(resource.models) ? `<dt>확인한 기존 모델</dt><dd>${esc(resource.models.join(', ') || '사용 가능한 모델 없음')}</dd>` : ''}${resource.runtime ? `<dt>실행환경</dt><dd>${esc(resource.runtime)}</dd>` : ''}${resource.reason ? `<dt>확인 범위</dt><dd>${esc(resource.reason)}</dd>` : ''}</dl></article>`;
}
function renderResources() {
  const groups = [...new Set(model.state.resources.map(resource => resource.type))];
  $('#resource-groups').innerHTML = groups.length ? groups.map(group => `<section><div class="resource-group-heading"><h2>${esc(group)}</h2><span class="subtle">${model.state.resources.filter(resource => resource.type === group).length}개</span></div><div class="resource-grid">${model.state.resources.filter(resource => resource.type === group).map(resourceCard).join('')}</div></section>`).join('') : empty('자원 기록이 없습니다', '로컬 서버가 감지한 자원이 여기에 표시됩니다.');
}
function renderApprovals() {
  const pending = model.state.approvals.filter(approval => approval.status === 'PENDING');
  $('#approval-count').hidden = !pending.length;
  $('#approval-count').textContent = pending.length;
  $('#approval-list').innerHTML = model.state.approvals.length ? model.state.approvals.slice().reverse().map(approval => `<article class="record-card"><div class="record-top"><h2>${esc(approval.title || taskTitle(approval.taskId))}</h2>${status(approval.status)}</div><p>요청: ${esc(approval.requestedAction || '위험 작업의 시험 승인')}</p><p>승인 범위: <strong>로컬 시험 절차만</strong>. 실제 외부 행동은 수행하지 않습니다.</p><div class="record-meta">${badge('MOCK')}<span>${fmt(approval.createdAt)}</span><code>${esc(approval.scope)}</code></div>${approval.status === 'PENDING' ? `<div class="detail-actions"><button class="button secondary" data-action="approve" data-id="${esc(approval.taskId)}"${model.pending.has(approval.taskId) ? ' disabled' : ''}>시험 절차만 승인</button><button class="button danger" data-action="reject" data-id="${esc(approval.taskId)}"${model.pending.has(approval.taskId) ? ' disabled' : ''}>승인 거절</button></div>` : `<p class="subtle">${fmt(approval.decidedAt)} · ${approval.status === 'APPROVED' ? '시험 절차의 승인이 기록되었습니다.' : '거절 결정이 기록되었습니다.'}</p>`}</article>`).join('') : empty('현재 승인 요청이 없습니다', '중요한 작업은 실행 전에 승인을 기다립니다.');
}
function renderArtifacts() {
  $('#artifact-list').innerHTML = model.state.artifacts.length ? model.state.artifacts.slice().reverse().map(artifact => {
    const task = model.state.tasks.find(item => item.id === artifact.taskId);
    return `<article class="record-card"><div class="record-top"><h2>${esc(artifact.name)}</h2>${badge(artifact.mode)}</div><p>${esc(task?.title || artifact.taskId)}</p><div class="record-meta"><span>${fmt(artifact.createdAt)}</span><span>${Number(artifact.bytes).toLocaleString('ko-KR')} bytes</span><span>${task?.status === 'VERIFIED' ? 'QA와 실행 영수증 확인됨' : '검증 진행 상태를 확인하세요'}</span></div><div class="record-meta">파일 <code>${esc(artifact.relativePath)}</code></div><div class="record-meta">SHA-256 <code>${esc(artifact.sha256)}</code></div><div class="record-links"><a href="/api/artifacts/${identifierPath(artifact.id)}" download="${esc(artifact.name)}">실제 파일 다운로드 <span aria-hidden="true">↗</span></a><button class="text-button" data-action="select-task" data-id="${esc(artifact.taskId)}">작업과 QA 보기</button>${task?.receiptId ? `<button class="text-button" data-action="receipt" data-id="${esc(task.id)}">실행 영수증</button>` : ''}</div></article>`;
  }).join('') : empty('아직 결과 파일이 없습니다', '실행으로 실제 파일이 생성되면 다운로드할 수 있습니다.');
  const artifacts = model.state.artifacts.slice().reverse();
  document.querySelectorAll('#artifact-list .record-card').forEach((card, index) => {
    const task = model.state.tasks.find(item => item.id === artifacts[index].taskId);
    const scope = document.createElement('p');
    scope.className = 'card-footnote';
    scope.textContent = scopeNote(task);
    card.querySelector('.record-links').before(scope);
  });
}
function renderMemory() {
  $('#memory-list').innerHTML = model.state.memory.length ? model.state.memory.slice().reverse().map(memory => `<article class="record-card"><div class="record-top"><h2>${esc(memory.title)}</h2>${badge(memory.mode)}</div><p>${esc(memory.summary)}</p><div class="record-meta"><span>${fmt(memory.createdAt)}</span><span>저장된 로컬 결과 기록</span></div><button class="text-button" data-action="select-task" data-id="${esc(memory.taskId)}">관련 작업 이어보기 <span aria-hidden="true">↗</span></button></article>`).join('') : empty('첫 번째 기억을 기다립니다', '검증된 로컬 결과가 생기면 다음 작업에서 확인할 수 있습니다.');
}
function renderConnections() {
  const groups = [...new Set(model.state.resources.map(resource => resource.type))];
  $('#connection-list').innerHTML = groups.map(group => `<article class="record-card"><div class="record-top"><h2>${esc(group)}</h2><span class="subtle">상태 확인</span></div>${model.state.resources.filter(resource => resource.type === group).map(resource => `<div class="resource-summary-row"><div><strong>${esc(resourceName(resource))}</strong><small>${esc(resource.connectionMode)} · ${esc(resource.executionLocation)} · ${fmt(resource.lastCheck)}</small></div>${badge(resourceMode(resource))}</div>`).join('')}</article>`).join('') || empty('연결 상태 기록이 없습니다', '서버의 자원 감지가 끝나면 실제 상태를 표시합니다.');
}
function renderUsage() {
  const usage = model.state.usage || {};
  const cards = [['tasksCreated', '만든 작업', '이 로컬 작업실의 목표 접수'], ['artifactsVerified', '검증한 결과물', 'QA와 영수증으로 확인한 파일'], ['localAiCalls', 'Local AI 응답', '결과가 저장된 기존 PC 모델 요청'], ['mockRuns', '모의 작업', '유료 제공자를 호출하지 않은 시험'], ['externalCalls', '외부 API 호출', '실제 외부 AI / 서비스 호출']];
  $('#usage-grid').innerHTML = cards.map(([key, title, detail]) => `<article class="usage-card"><h2>${title}</h2><div class="usage-number">${Number.isFinite(usage[key]) ? usage[key].toLocaleString('ko-KR') : '—'}</div><p>${detail}</p></article>`).join('');
  const environment = model.state.environment || {};
  $('#environment-info').innerHTML = `<h2>현재 실행환경</h2><div class="environment-grid">${[['appMode', '앱 모드'], ['dataMode', '데이터'], ['executionMode', '실행'], ['providerMode', '자원 선택']].map(([key, label]) => `<p>${label}<strong>${esc(environment[key] || '확인되지 않음')}</strong></p>`).join('')}<p>Production 연결<strong>${environment.productionConnected === false ? '연결되지 않음' : '상태 확인 필요'}</strong></p><p>선택 권위<strong>${esc(environment.selectionAuthority || '확인되지 않음')}</strong></p><p>전사 Router 연결<strong>${environment.enterpriseRouterConnected === false ? '연결되지 않음' : '상태 확인 필요'}</strong></p></div>`;
}
function renderProjects() {
  const tasks = model.state.tasks;
  $('#project-list').innerHTML = `<article class="record-card"><div class="record-top"><h2>Core Local Lab</h2>${badge('LOCAL')}</div><p>이 PC에서 실행을 시험하는 독립 작업 공간입니다. 전사 프로젝트나 실제 회사 데이터에 연결되지 않았습니다.</p><div class="project-summary"><span><strong>${tasks.length}</strong> 작업</span><span><strong>${tasks.filter(task => task.status === 'VERIFIED').length}</strong> 결과 검증</span><span><strong>${model.state.approvals.filter(approval => approval.status === 'PENDING').length}</strong> 승인 대기</span></div><div class="project-actions"><button class="button secondary" data-view="home">새 목표 맡기기 <span aria-hidden="true">↗</span></button><button class="button" data-view="results">프로젝트 결과물</button></div></article>`;
}
async function renderAdvanced() {
  const task = selectedTask();
  const output = $('#record-output');
  if (!task) { output.textContent = '아직 선택한 작업이 없습니다.'; return; }
  const type = $('#record-type').value;
  if (type === 'receipt') {
    if (!task.receiptId) { output.textContent = '아직 실행 영수증이 생성되지 않았습니다.'; return; }
    const receiptId = task.receiptId;
    if (model.receipts.has(receiptId)) { output.textContent = JSON.stringify(model.receipts.get(receiptId), null, 2); return; }
    output.textContent = '실제 실행 영수증을 읽고 있습니다…';
    if (model.receiptLoading === receiptId) return;
    model.receiptLoading = receiptId;
    try {
      const response = await api(`/api/receipts/${identifierPath(receiptId)}`);
      model.receipts.set(receiptId, response.receipt);
      if (selectedTask()?.receiptId === receiptId && $('#record-type').value === 'receipt') output.textContent = JSON.stringify(response.receipt, null, 2);
    } catch (error) { if (selectedTask()?.receiptId === receiptId) output.textContent = `영수증을 읽지 못했습니다: ${error.message}`; }
    finally { model.receiptLoading = null; }
    return;
  }
  const value = type === 'workUnits' ? { workUnits: task.workUnits, checkpoint: task.checkpoint } : type === 'qa' ? { taskId: task.id, qa: task.qa || null, artifactId: task.artifactId || null } : { id: task.id, title: task.title, scenario: task.scenario, mode: task.mode, status: task.status, currentStage: task.currentStage, selectedResource: task.selectedResource, checkpoint: task.checkpoint, events: task.events };
  output.textContent = JSON.stringify(value, null, 2);
}
function setScenario(scenario, usePreset = false) {
  $('#scenario').value = scenario;
  const mode = scenarioModes[scenario] || 'LOCAL';
  $('#scenario-mode').className = `badge ${mode.toLowerCase()}`;
  $('#scenario-mode').textContent = mode;
  $('#summary-input-wrap').hidden = scenario !== 'summary';
  $('#summary-input').required = scenario === 'summary';
  if (usePreset) $('#goal-input').value = presets[scenario] || presets.safe;
}

$('#scenario').addEventListener('change', event => setScenario(event.target.value));
$('#record-type').addEventListener('change', renderAdvanced);
$('#goal-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (model.creating || !model.connected) return;
  const title = $('#goal-input').value.trim();
  const scenario = $('#scenario').value;
  const inputText = $('#summary-input').value.trim();
  const message = $('#form-message');
  if (!title) { message.textContent = '맡길 목표를 입력해주세요.'; message.className = 'form-message error'; $('#goal-input').focus(); return; }
  if (scenario === 'summary' && !inputText) { message.textContent = '요약할 원문을 입력해주세요.'; message.className = 'form-message error'; $('#summary-input').focus(); return; }
  model.creating = true;
  $('#submit-goal').disabled = true;
  $('#submit-goal').firstElementChild.textContent = '목표 접수 중…';
  message.textContent = '목표를 로컬 실행 엔진에 전달하고 있습니다.';
  message.className = 'form-message';
  showError('');
  try {
    const request = { title, scenario, inputText: scenario === 'summary' ? inputText : undefined };
    const response = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ ...request, idempotencyKey: await requestKey(request) }) });
    model.selectedTaskId = response.task.id;
    try { sessionStorage.removeItem('core-lab-pending-request'); } catch { /* Storage is optional. */ }
    message.textContent = `목표가 접수되었습니다. ${response.task.id}${response.reused ? ' · 기존 접수 재사용' : ''}`;
    $('#goal-input').value = '';
    if (model.state && !model.state.tasks.some(task => task.id === response.task.id)) model.state.tasks.push(response.task);
    if (model.state) renderAll();
    try { applyState(await api('/api/state')); }
    catch (error) { showError(`목표는 접수되었습니다. 최신 상태를 읽지 못했습니다: ${error.message}`); }
    $('#task-detail').scrollIntoView({ behavior: 'auto', block: 'nearest' });
  } catch (error) { message.className = 'form-message error'; message.textContent = `접수하지 못했습니다: ${error.message}`; }
  finally { model.creating = false; $('#submit-goal').disabled = !model.connected; $('#submit-goal').firstElementChild.textContent = 'Core에 맡기기'; }
});
document.addEventListener('click', async event => {
  const navigation = event.target.closest('[data-view]');
  if (navigation) { switchView(navigation.dataset.view); return; }
  const preset = event.target.closest('[data-preset]');
  if (preset) { setScenario(preset.dataset.preset, true); $('#goal-input').focus(); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (action === 'select-task' || action === 'receipt') {
    model.selectedTaskId = id;
    switchView('home');
    renderTasks(); renderTaskDetail();
    if (action === 'receipt') { $('#advanced').open = true; $('#record-type').value = 'receipt'; renderAdvanced(); $('#advanced').scrollIntoView({ behavior: 'auto', block: 'start' }); }
    else { renderAdvanced(); $('#task-detail').scrollIntoView({ behavior: 'auto', block: 'nearest' }); $('#task-detail').focus({ preventScroll: true }); }
    return;
  }
  if (!['resume', 'approve', 'reject'].includes(action) || model.pending.has(id)) return;
  model.pending.add(id);
  renderTaskDetail(); renderApprovals(); showError('');
  try {
    const path = action === 'resume' ? `/api/tasks/${identifierPath(id)}/resume` : `/api/tasks/${identifierPath(id)}/approval`;
    await api(path, { method: 'POST', body: JSON.stringify(action === 'resume' ? {} : { decision: action === 'approve' ? 'approve' : 'reject' }) });
    applyState(await api('/api/state'));
  } catch (error) { showError(`요청을 처리하지 못했습니다: ${error.message}`); }
  finally {
    model.pending.delete(id); renderTaskDetail(); renderApprovals();
    const nextButton = [...document.querySelectorAll('[data-action][data-id]')].find(element => element.dataset.action === action && element.dataset.id === id);
    if (nextButton) nextButton.focus({ preventScroll: true });
    else if (model.view === 'home') $('#task-detail').focus({ preventScroll: true });
    else $('#main').focus({ preventScroll: true });
  }
});

async function bootstrap() {
  try { applyState(await api('/api/state')); setConnection(true); }
  catch (error) { setConnection(false, '로컬 서버 연결 안 됨'); showError(`로컬 상태를 읽지 못했습니다. 서버 실행 상태를 확인해주세요. ${error.message}`); }
  const events = new EventSource('/api/events');
  events.addEventListener('state', event => {
    try { applyState(JSON.parse(event.data)); setConnection(true); showError(''); }
    catch { showError('서버의 상태 변경 기록을 읽지 못했습니다.'); }
  });
  events.onopen = () => { setConnection(true); showError(''); };
  events.onerror = () => setConnection(false, '연결 중단 · 자동 재연결 중');
  window.addEventListener('pagehide', () => events.close(), { once: true });
}
if (viewNames[location.hash.slice(1)]) switchView(location.hash.slice(1));
bootstrap();
