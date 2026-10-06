'use strict';

const $ = selector => document.querySelector(selector);
const model = { state: null, selectedTaskId: null, view: 'home', connected: false, creating: false, pending: new Set(), receipts: new Map(), receiptLoading: null };
const transport = { timer: null, events: null, failures: 0, active: false, inFlight: false, errorVisible: false, sessionExpired: false };
const cloudHost = ['thefa-core-console.vercel.app', 'app.thefacore.com'].includes(location.hostname);
const viewNames = { home: '홈', projects: '프로젝트', resources: '실행 자원', ava: '나의 AVA', evidence: '작업 근거', setup: '로컬 설정 · 앱', approvals: '승인 필요', results: '결과물', memory: 'Memory', connections: 'Connections', usage: 'Usage' };
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
function taskTitle(taskId) { return model.state?.tasks.find(task => task.id === taskId)?.title || '작업'; }
function isCloud() { return model.state?.environment?.deploymentMode === 'private-beta' || model.state?.environment?.executionLocation === 'Cloud' || (!model.state && cloudHost); }
function isCoreMode() { return model.state?.environment?.executionMode === 'core'; }
function sandboxName() { return isCoreMode() ? 'THE FA Core' : isCloud() ? 'Cloud 샌드박스' : '로컬 시험 공간'; }
function resourceMode(resource) {
  if (resource.status === 'CONNECTED' && resource.executionLocation === 'Cloud') return 'REAL';
  return resource.status === 'CONNECTED' && resource.executionLocation === 'PC' ? 'LOCAL' : ['MOCK', 'PLANNED'].includes(resource.status) ? resource.status : 'DISCONNECTED';
}
function resourceName(resource) { return resource.model ? `${resource.provider} · ${resource.model}` : resource.provider || '실행 자원'; }
function identifierPath(value) { return encodeURIComponent(String(value)); }
function scopeNote(task) {
  if (isCoreMode()) return task ? '실제 THE FA Core 실행 기록입니다. terminal Receipt와 QA 근거가 확인된 상태만 완료로 봅니다.' : '실제 THE FA Core 실행 상태를 읽습니다.';
  if (!task) return `${sandboxName()}의 시험 결과입니다. 실제 업무 수행은 별도로 검증해야 합니다.`;
  if (task.scenario === 'approval') return `검증 범위: 모의 승인 절차와 ${sandboxName()}의 시험 보고서. 실제 배포는 수행하지 않습니다. 승인 범위는 시험 절차로 제한됩니다.`;
  if (task.scenario === 'summary' || task.qa?.scope === 'OUTPUT_EXISTS_AND_INTEGRITY_ONLY') return isCloud() ? '대표 PC의 Local AI와 연결되지 않았습니다. Cloud에서는 요약 실행을 건너뛰고 이유를 기록합니다.' : '검증 범위: 기존 Local AI의 응답 존재와 파일 무결성. 요약 내용의 의미 정확도는 아직 검증되지 않았습니다.';
  if (task.mode === 'MOCK' || ['research', 'failover'].includes(task.scenario)) return '검증 범위: 가상 제공자의 예시 출력과 파일 무결성. 실제 시장 조사와 유료 AI 실행은 수행하지 않습니다.';
  if (task.scenario === 'failure') return `검증 범위: ${sandboxName()} Worker 실패, 저장한 지점부터 재개, 시험 보고서와 파일 검사.`;
  return `검증 범위: ${isCloud() ? 'Cloud 샌드박스의' : '이 PC의'} 시험 보고서 생성, 파일 검사, 실행 영수증. 입력한 목표의 실제 업무 수행은 별도로 검증해야 합니다.`;
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
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...options, signal: options.signal || controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { expireSession(); throw Object.assign(new Error('세션이 만료되었습니다. 다시 로그인해주세요.'), { status: 401 }); }
    if (!response.ok) throw Object.assign(new Error(typeof body.error === 'string' ? body.error : body.error?.message || `요청에 실패했습니다 (${response.status})`), { status: response.status });
    return body;
  } finally { clearTimeout(deadline); }
}
function showError(message) { const element = $('#global-error'); element.textContent = message; element.hidden = !message; }
function setConnection(connected, message) {
  model.connected = connected;
  $('#connection-status').textContent = message || (connected ? (isCoreMode() ? 'THE FA Core 연결됨' : isCloud() ? 'Cloud 샌드박스 연결됨' : '로컬 서버 연결됨') : '연결 확인 필요');
  $('#connection-dot').className = `connection-dot ${connected ? 'ready' : 'offline'}`;
  $('#submit-goal').disabled = !connected || model.creating;
}
function renderRuntimeCopy() {
  const cloud = isCloud();
  const core = isCoreMode();
  document.body.classList.toggle('cloud-mode', cloud);
  document.title = core ? 'THE FA Core · Founder Live' : cloud ? 'THE FA Core · 초대 전용 Private Beta' : 'THE FA Core · Functional Console Lab';
  $('#workspace-kind').textContent = core ? 'FOUNDER LIVE · REAL CORE' : cloud ? 'INVITATION ONLY · PRIVATE BETA' : 'LOCAL WORKSPACE';
  $('#runtime-title').textContent = core ? 'Founder Live · 실제 THE FA Core' : cloud ? '초대 전용 Private Beta · 샌드박스 기능 시험' : 'Local Development Mode';
  $('#runtime-description').textContent = core ? '인증된 요청을 기존 Work Unit·Scheduler 실행 경로로 보내고 실제 terminal Receipt를 다시 읽습니다. Core 장애 시 Sandbox로 자동 전환하지 않습니다.' : cloud ? 'Cloud에서 시험 보고서를 생성합니다. 중앙 업무 실행과 실제 회사 운영 데이터는 연결되지 않았습니다.' : '이 PC의 기능 시험 공간입니다. 공개 서비스와 연결되지 않습니다.';
  $('#runtime-badge').className = `badge ${core || (cloud && model.state) ? 'real' : cloud ? 'planned' : 'local'}`;
  $('#runtime-badge').textContent = core ? 'REAL · CORE' : cloud ? (model.state ? 'REAL · SANDBOX' : 'CLOUD · 확인 중') : 'LOCAL';
  $('#session-controls').hidden = !cloud || !model.state;
  const email = model.state?.auth?.email || model.state?.user?.email || '';
  $('#session-email').textContent = maskEmail(email);
  $('#session-full-email').textContent = email;
  $('#session-email').title = '계정 상세 보기';
  $('#homepage-link').href = cloud ? 'https://thefacore.com/' : (location.port === '4180' ? 'http://127.0.0.1:4175/' : 'http://127.0.0.1:4174/');
  $('#homepage-link').innerHTML = `${cloud ? 'THE FA Core 홈페이지' : '홈페이지 로컬 Preview'} <span aria-hidden="true">↗</span>`;
  $('#goal-description').textContent = core ? '목표를 실제 THE FA Core에 전달합니다. 접수·실행·QA·terminal Receipt 상태를 이 Console에서 확인합니다.' : cloud ? '목표를 입력하고 Cloud 샌드박스에서 실행 흐름을 시험하세요. 일반 업무의 실제 수행은 아직 연결되지 않았습니다.' : '목표를 알려주세요. 계획부터 실행, 결과 확인까지 Core가 이어갑니다.';
  if (core && $('#scenario').value !== 'safe') $('#scenario').value = 'safe';
  const scenarioSelect = $('#scenario').closest('.scenario-select');
  if (scenarioSelect) scenarioSelect.hidden = core;
  $('#scenario option[value="safe"]').textContent = cloud ? 'Cloud 시험 보고서 만들기' : '로컬 보고서 만들기';
  $('#scenario option[value="summary"]').textContent = cloud ? 'PC Local AI · 미연결' : '기존 Local AI로 요약';
  $('#summary-input-wrap p').textContent = core ? '실제 Core 요청에서는 이 Sandbox 전용 입력을 사용하지 않습니다.' : cloud ? '대표 PC의 Local AI와 연결되지 않아 Cloud에서는 실행을 건너뛰고 이유만 기록합니다.' : '기존 Ollama 모델이 없으면 실행을 건너뛰고 이유를 기록합니다.';
  $('#summary-input').placeholder = cloud ? '미연결 처리와 영수증을 시험할 원문을 입력하세요.' : '이 PC에 이미 설치된 Local AI가 읽을 텍스트를 붙여 넣으세요.';
  $('[data-preset="summary"] .subtle').textContent = core ? 'SANDBOX ONLY' : cloud ? 'DISCONNECTED' : 'LOCAL AI';
  $('#projects-view .page-heading p').textContent = core ? '실제 THE FA Core로 접수한 작업과 terminal Receipt 상태를 확인합니다.' : cloud ? '초대 전용 Cloud 샌드박스의 목표와 시험 결과를 확인합니다.' : '이 로컬 작업실에서 수행한 목표와 결과를 함께 확인합니다.';
  $('#resources-view > .notice').textContent = core ? '실행 자원은 기존 THE FA Core·Router·Scheduler 권위에서 선택합니다. 이 사이트가 별도 Router나 Scheduler를 만들지 않습니다.' : cloud ? '자원 선택은 Cloud 샌드박스의 시험 규칙으로 수행합니다. 전사 THE FA Router V2와 대표 PC의 자원은 연결되지 않았습니다.' : '현재 자원 선택은 Lab의 로컬 시험 규칙으로 수행합니다. 전사 THE FA Router V2 연결은 아직 제공되지 않습니다.';
  $('#results-view .page-heading p').textContent = core ? '실제 Core 작업의 결과물과 QA·terminal Receipt 근거를 표시합니다.' : cloud ? 'Cloud 샌드박스에서 실제 생성한 시험 파일과 검증 기록입니다.' : '로컬 실행으로 생성된 파일과 검증 기록입니다.';
  $('#memory-view > .notice').textContent = core ? 'Company Memory를 이 화면이 직접 구현하거나 수정하지 않습니다. Core readback으로 제공된 기록만 표시합니다.' : cloud ? '이 Private Beta의 시험 결과 기록만 표시됩니다. 전사 Company Memory와 연결되어 있지 않습니다.' : '로컬 기록만 표시됩니다. 전사 Company Memory와 연결되어 있지 않습니다.';
  $('#connections-view > .notice').textContent = core ? '인증된 Console → server-only Core ingress만 사용합니다. 브라우저에서 PC·Secret·Provider로 직접 연결하지 않습니다.' : cloud ? '초대 계정 인증과 전용 시험 저장소를 사용합니다. 외부 업무 도구 연결 설정은 제공하지 않습니다.' : '이 시험 공간에서는 API Key, OAuth, 실제 계정 연결을 설정하지 않습니다.';
  $('#usage-view .page-heading p').textContent = core ? 'Core readback에서 확인된 사용 기록만 표시합니다.' : cloud ? 'Cloud 샌드박스에서 기록된 시험 사용량만 표시합니다.' : '로컬 실행 기록에서 확인되는 사용량만 표시합니다.';
  $('.main-footer > span').textContent = core ? 'THE FA Core · Founder Live V1' : cloud ? 'THE FA Core · 초대 전용 Private Beta' : 'THE FA Core · Functional Console Lab V2';
  $('.mode-guide dd').textContent = core ? '실제 Core 경로로 실행합니다. 장애 시 샌드박스로 몰래 전환하지 않고 오류를 표시합니다.' : cloud ? 'Cloud 샌드박스가 실제 보고서 파일을 생성·저장함. 실제 회사 업무와 외부 AI 실행은 연결되지 않았습니다.' : '실제 외부 시스템에서 수행됨. 이 Lab은 외부 실행을 제공하지 않습니다.';
  if (!model.state && cloud) $('#resource-summary p').textContent = core ? 'THE FA Core 상태를 확인하고 있습니다.' : 'Cloud 샌드박스의 자원 상태를 확인하고 있습니다.';
  setScenario($('#scenario').value);
}
function switchView(view) {
  if (!viewNames[view]) return;
  model.view = view;
  document.querySelectorAll('.view').forEach(element => { element.hidden = element.id !== `${view}-view`; });
  document.querySelectorAll('.nav-item').forEach(element => { const active = element.dataset.view === view; element.classList.toggle('active', active); active ? element.setAttribute('aria-current', 'page') : element.removeAttribute('aria-current'); });
  $('#view-name').textContent = viewNames[view];
  if (location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
  $('#main').focus({ preventScroll: true });
}
function applyState(state) {
  if (!state || !Array.isArray(state.tasks)) { showError('로컬 서버 응답 형식을 확인할 수 없습니다.'); return; }
  model.state = { tasks: [], resources: [], approvals: [], artifacts: [], receipts: [], memory: [], usage: {}, pipeline: [], environment: {}, ...state };
  renderRuntimeCopy();
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
  renderSetup(); renderEvidence(); renderTasks(); renderTaskDetail(); renderResourceSummary(); renderResources(); renderApprovals(); renderArtifacts(); renderMemory(); renderConnections(); renderUsage(); renderProjects(); renderAdvanced();
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
  $('#task-detail').innerHTML = `<div class="detail-heading"><div><span class="eyebrow">YOUR CURRENT WORK</span><h2>${esc(task.title)}</h2><p class="detail-subtitle">${esc(shortTask(task.id))} · ${fmt(task.createdAt)}</p></div>${status(task.status)}</div>${task.error ? `<div class="notice ${task.status === 'SKIPPED' ? '' : 'error'}">${esc(task.status === 'SKIPPED' ? '사용 가능한 연결이 없어 실행을 건너뛰었습니다. 상세 원인은 고급 실행 정보에서 확인할 수 있습니다.' : '시험 작업이 중단되었습니다. 상세 원인은 고급 실행 정보에서 확인하고, 기록한 지점부터 재개할 수 있습니다.')}</div>` : ''}${approval ? '<div class="notice">위험 작업을 감지하여 멈췄습니다. 승인해도 시험 결과만 기록하며 실제 Production은 변경하지 않습니다.</div>' : ''}<div class="pipeline" aria-label="실행 단계">${model.state.pipeline.map(stage => `<span class="pipeline-step ${stage === task.currentStage ? 'current' : recordedStages.has(stage) ? 'done' : ''}"${stage === task.currentStage ? ' aria-current="step"' : ''}>${esc(stageNames[stage] || stage)}</span>`).join('')}</div><div class="detail-actions">${['FAILED', 'FAILED_RETRYABLE', 'PAUSED'].includes(task.status) ? `<button class="button secondary" data-action="resume" data-id="${esc(task.id)}"${runningAction ? ' disabled' : ''}>${runningAction ? '이어서 실행 요청 중…' : '기록한 지점부터 이어서 실행'}</button>` : ''}${approval ? `<button class="button secondary" data-action="approve" data-id="${esc(task.id)}"${runningAction ? ' disabled' : ''}>시험 절차만 승인</button><button class="button danger" data-action="reject" data-id="${esc(task.id)}"${runningAction ? ' disabled' : ''}>승인 거절</button>` : ''}${artifact ? `<a class="button secondary" href="/api/artifacts/${identifierPath(artifact.id)}" download="${esc(artifact.name)}">결과 파일 다운로드 <span aria-hidden="true">↗</span></a>` : ''}${task.receiptId ? `<button class="button" data-action="receipt" data-id="${esc(task.id)}">실행 영수증 확인</button>` : ''}</div><div class="detail-columns"><section><h3>Core의 실행 계획</h3>${task.plan?.length ? `<ol class="plan-list">${task.plan.map(step => `<li>${esc(step.title)}</li>`).join('')}</ol>` : '<p class="subtle">계획을 준비하고 있습니다.</p>'}${resource ? `<div class="record-meta">${badge(resource.mode || task.mode)}<span>${esc(resource.provider)}${resource.model ? ` / ${esc(resource.model)}` : ''}</span><span>위치: ${esc(resource.executionLocation || '확인 중')}</span></div>` : ''}</section><section><h3>최근 실행 기록</h3>${events.length ? events.slice(-6).reverse().map(event => `<div class="execution-event"><strong>${esc(stageNames[event.stage] || '실행 기록')}</strong><time datetime="${esc(event.at)}">${fmt(event.at)}</time> · ${esc(stageNames[event.stage] || event.stage)} · ${esc(event.mode || task.mode)}</div>`).join('') : '<p class="subtle">아직 실행 기록이 없습니다.</p>'}</section></div><section class="detail-qa"><h3>결과 확인</h3>${checks.length ? checks.map(check => `<div class="qa-check ${check.passed ? '' : 'failed'}"><span aria-hidden="true">${check.passed ? '✓' : '×'}</span>결과 검사 · ${check.passed ? '통과' : '통과하지 못함'}</div>`).join('') : '<p class="subtle">검사가 끝나면 확인 항목과 결과를 표시합니다.</p>'}${task.qa?.artifactSha256 ? `<details><summary>고급 무결성 정보</summary><code>${esc(task.qa.artifactSha256)}</code></details>` : ''}</section>`;
  const scope = document.createElement('p');
  scope.className = 'notice';
  scope.textContent = scopeNote(task);
  $('#task-detail .detail-heading').after(scope);
}
function renderResourceSummary() {
  const connected = model.state.resources.filter(resource => resource.status === 'CONNECTED');
  const visible = connected.slice(0, 3);
  $('#resource-summary').innerHTML = visible.length ? visible.map(resource => `<div class="resource-summary-row"><span class="resource-summary-icon" aria-hidden="true">◇</span><div><strong>${esc(resourceName(resource))}</strong><small>${esc(resource.executionLocation)} · 시험 자원</small></div>${badge(resourceMode(resource))}</div>`).join('') : '<p class="subtle">사용 가능함을 확인한 자원이 없습니다.</p>';
}
function resourceCard(resource) {
 return `<article class="resource-card"><div class="record-top"><h3>${esc(resourceName(resource))}</h3>${badge(resourceMode(resource))}</div><p>AVA가 역할에 맞게 선택할 실행 자원입니다. 현재는 시험 공간의 연결 상태를 표시합니다.</p><p>실행 위치: ${esc(resource.executionLocation)} · 마지막 확인: ${fmt(resource.lastCheck)}</p><details><summary>고급 자원 정보</summary><pre>${esc(JSON.stringify(resource, null, 2))}</pre></details></article>`;
}
function renderResources() {
  const groups = [...new Set(model.state.resources.map(resource => resource.type))];
  $('#resource-groups').innerHTML = groups.length ? groups.map(group => `<section><div class="resource-group-heading"><h2>${esc(group)}</h2><span class="subtle">${model.state.resources.filter(resource => resource.type === group).length}개</span></div><div class="resource-grid">${model.state.resources.filter(resource => resource.type === group).map(resourceCard).join('')}</div></section>`).join('') : empty('자원 기록이 없습니다', '로컬 서버가 감지한 자원이 여기에 표시됩니다.');
}
function renderApprovals() {
  const pending = model.state.approvals.filter(approval => approval.status === 'PENDING');
  $('#approval-count').hidden = !pending.length;
  $('#approval-count').textContent = pending.length;
  $('#approval-list').innerHTML = model.state.approvals.length ? model.state.approvals.slice().reverse().map(approval => `<article class="record-card"><div class="record-top"><h2>${esc(approval.title || taskTitle(approval.taskId))}</h2>${status(approval.status)}</div><p>요청: ${esc(approval.requestedAction || '위험 작업의 시험 승인')}</p><p>승인 범위: <strong>${isCloud() ? 'Cloud 샌드박스 시험 절차만' : '로컬 시험 절차만'}</strong>. 실제 외부 업무와 배포는 수행하지 않습니다.</p><div class="record-meta">${badge('MOCK')}<span>${fmt(approval.createdAt)}</span><code>시험 절차 한정</code></div>${approval.status === 'PENDING' ? `<div class="detail-actions"><button class="button secondary" data-action="approve" data-id="${esc(approval.taskId)}"${model.pending.has(approval.taskId) ? ' disabled' : ''}>시험 절차만 승인</button><button class="button danger" data-action="reject" data-id="${esc(approval.taskId)}"${model.pending.has(approval.taskId) ? ' disabled' : ''}>승인 거절</button></div>` : `<p class="subtle">${fmt(approval.decidedAt)} · ${approval.status === 'APPROVED' ? '시험 절차의 승인이 기록되었습니다.' : '거절 결정이 기록되었습니다.'}</p>`}</article>`).join('') : empty('현재 승인 요청이 없습니다', '중요한 작업은 실행 전에 승인을 기다립니다.');
}
function renderArtifacts() {
  $('#artifact-list').innerHTML = model.state.artifacts.length ? model.state.artifacts.slice().reverse().map(artifact => {
    const task = model.state.tasks.find(item => item.id === artifact.taskId);
    return `<article class="record-card"><div class="record-top"><h2>${esc(shortTask(artifact.taskId))} · 결과 파일</h2>${badge(artifact.mode)}</div><p>${esc(task?.title || artifact.taskId)}</p><div class="record-meta"><span>${fmt(artifact.createdAt)}</span><span>${Number(artifact.bytes).toLocaleString('ko-KR')} bytes</span><span>${task?.status === 'VERIFIED' ? 'QA와 실행 영수증 확인됨' : '검증 진행 상태를 확인하세요'}</span></div><details><summary>고급 파일 정보</summary><p>${esc(artifact.name)}</p><p>${esc(artifact.relativePath)}</p><code>${esc(artifact.sha256)}</code></details><div class="record-links"><a href="/api/artifacts/${identifierPath(artifact.id)}" download="${esc(artifact.name)}">실제 파일 다운로드 <span aria-hidden="true">↗</span></a><button class="text-button" data-action="select-task" data-id="${esc(artifact.taskId)}">작업과 QA 보기</button>${task?.receiptId ? `<button class="text-button" data-action="receipt" data-id="${esc(task.id)}">실행 영수증</button>` : ''}</div></article>`;
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
  $('#memory-list').innerHTML = model.state.memory.length ? model.state.memory.slice().reverse().map(memory => `<article class="record-card"><div class="record-top"><h2>${esc(memory.title)}</h2>${badge(memory.mode)}</div><p>${esc(memory.summary)}</p><div class="record-meta"><span>${fmt(memory.createdAt)}</span><span>${isCloud() ? '저장된 Cloud 시험 결과 기록' : '저장된 로컬 결과 기록'}</span></div><button class="text-button" data-action="select-task" data-id="${esc(memory.taskId)}">관련 작업 이어보기 <span aria-hidden="true">↗</span></button></article>`).join('') : empty('첫 번째 기억을 기다립니다', '검증된 시험 결과가 생기면 다음 작업에서 확인할 수 있습니다.');
}
function renderConnections() {
  const groups = [...new Set(model.state.resources.map(resource => resource.type))];
  $('#connection-list').innerHTML = groups.map(group => `<article class="record-card"><div class="record-top"><h2>${esc(group)}</h2><span class="subtle">상태 확인</span></div>${model.state.resources.filter(resource => resource.type === group).map(resource => `<div class="resource-summary-row"><div><strong>${esc(resourceName(resource))}</strong><small>${esc(resource.executionLocation)} · ${fmt(resource.lastCheck)}</small></div>${badge(resourceMode(resource))}</div>`).join('')}</article>`).join('') || empty('연결 상태 기록이 없습니다', '서버의 자원 감지가 끝나면 실제 상태를 표시합니다.');
}
function renderUsage() {
  const usage = model.state.usage || {};
  const cloud = isCloud();
  const core = isCoreMode();
  const cards = [['tasksCreated', '만든 작업', `${sandboxName()}의 목표 접수`], ['artifactsVerified', '검증한 시험 결과물', 'QA와 영수증으로 확인한 파일'], ['localAiCalls', 'Local AI 응답', cloud ? '대표 PC Local AI 연결은 제공되지 않음' : '결과가 저장된 기존 PC 모델 요청'], ['mockRuns', '모의 작업', '유료 제공자를 호출하지 않은 시험'], ['externalCalls', '외부 AI / 업무 호출', cloud ? 'Cloud 시험 저장소 요청과 구분' : '실제 외부 AI / 서비스 호출']];
  $('#usage-grid').innerHTML = cards.map(([key, title, detail]) => `<article class="usage-card"><h2>${title}</h2><div class="usage-number">${Number.isFinite(usage[key]) ? usage[key].toLocaleString('ko-KR') : '—'}</div><p>${detail}</p></article>`).join('');
  const environment = model.state.environment || {};
  const production = environment.businessProductionConnected ?? environment.productionConnected;
  const fields = [['appMode', '앱 모드'], ['dataMode', '데이터'], ['executionMode', '실행'], ['providerMode', '자원 선택'], ['selectionAuthority', '선택 권위']];
  $('#environment-info').innerHTML = `<h2>현재 실행환경</h2><div class="environment-grid"><p>${core ? '실행 환경' : '시험 환경'}<strong>${core ? 'THE FA Core · 실제 실행' : cloud ? 'Cloud 샌드박스 · Demo' : '이 PC의 로컬 시험 공간'}</strong></p><p>실제 회사 운영 연결<strong>${production === false ? '연결되지 않음' : '상태 확인 필요'}</strong></p><p>전사 Router 연결<strong>${core ? (environment.enterpriseRouterConnected === true ? 'Core 경유 연결됨' : 'Core readback 확인 필요') : '연결되지 않음'}</strong></p>${cloud && !core ? `<p>Private Beta 시험 저장소<strong>${environment.privateBetaStorageConnected === true ? '연결됨 · 시험 전용' : '상태 확인 필요'}</strong></p>` : ''}${core ? `<p>Core ingress<strong>${environment.coreIngressConnected === true ? '연결됨 · fail-closed' : '연결 확인 필요'}</strong></p>` : ''}</div><details><summary>고급 실행환경 정보</summary><pre>${esc(JSON.stringify(environment, null, 2))}</pre></details>`;
}
function renderProjects() {
  const tasks = model.state.tasks;
  const cloud = isCloud();
  $('#project-list').innerHTML = `<article class="record-card"><div class="record-top"><h2>${isCoreMode() ? 'Founder Live · THE FA Core' : cloud ? 'Core Private Beta Sandbox' : 'Core Local Lab'}</h2>${badge(cloud ? 'REAL' : 'LOCAL')}</div><p>${isCoreMode() ? '인증된 요청을 기존 THE FA Core 실행계층에 전달하고 실제 상태·QA·terminal Receipt를 읽는 작업 공간입니다.' : cloud ? '초대 계정으로 Cloud에서 기능을 시험하는 독립 작업 공간입니다. 중앙 업무 실행과 실제 회사 운영 데이터는 연결되지 않았습니다.' : '이 PC에서 실행을 시험하는 독립 작업 공간입니다. 전사 프로젝트나 실제 회사 데이터에 연결되지 않았습니다.'}</p><div class="project-summary"><span><strong>${tasks.length}</strong> 작업</span><span><strong>${tasks.filter(task => task.status === 'VERIFIED').length}</strong> 시험 결과 검증</span><span><strong>${model.state.approvals.filter(approval => approval.status === 'PENDING').length}</strong> 승인 대기</span></div><div class="project-actions"><button class="button secondary" data-view="home">새 목표 맡기기 <span aria-hidden="true">↗</span></button><button class="button" data-view="results">프로젝트 결과물</button></div></article>`;
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
  const mode = isCloud() ? (scenario === 'summary' ? 'DISCONNECTED' : ['research', 'failover', 'approval'].includes(scenario) ? 'MOCK' : 'REAL') : scenarioModes[scenario] || 'LOCAL';
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
  message.textContent = `목표를 ${isCoreMode() ? '실제 THE FA Core' : isCloud() ? 'Cloud 샌드박스' : '로컬 실행 엔진'}에 전달하고 있습니다.`;
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
    renderEvidence(); renderTasks(); renderTaskDetail();
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

function stopTransport() {
  clearTimeout(transport.timer);
  transport.timer = null;
  transport.events?.close();
  transport.events = null;
  transport.active = false;
  transport.generation = (transport.generation || 0) + 1;
}
function expireSession() {
  if (transport.sessionExpired) return;
  transport.sessionExpired = true;
  stopTransport();
  setConnection(false, '세션 만료 · 다시 로그인 필요');
  showError('로그인 세션이 만료되었습니다. 다시 로그인 화면으로 이동합니다.');
  location.replace('/login.html?reason=session-expired');
}
function startPolling(initialFailures = 0) {
  stopTransport();
  if (transport.sessionExpired) return;
  transport.active = true;
  transport.inFlight = false;
  transport.failures = initialFailures;
  transport.errorVisible = initialFailures > 0;
  const generation = transport.generation;
  transport.timer = setTimeout(() => pollState(generation), 2000);
}
async function pollState(generation) {
  if (!transport.active || generation !== transport.generation || transport.inFlight) return;
  transport.inFlight = true;
  try {
    const state = await api('/api/state');
    if (generation !== transport.generation) return;
    applyState(state);
    setConnection(true);
    transport.failures = 0;
    if (transport.errorVisible) showError('');
    transport.errorVisible = false;
    $('#connection-retry').hidden = true;
  } catch (error) {
    if (error.status === 401 || generation !== transport.generation) return;
    transport.failures += 1;
    transport.errorVisible = true;
    setConnection(false, 'Cloud 연결 확인 필요');
    if (transport.failures >= 5) {
      transport.active = false;
      showError(`연결을 5회 확인하지 못해 자동 확인을 멈췄습니다. ${error.message}`);
      $('#connection-retry').hidden = false;
    } else showError(`Cloud 상태를 읽지 못했습니다. 잠시 후 다시 확인합니다 (${transport.failures}/5). ${error.message}`);
  } finally {
    if (generation === transport.generation) {
      transport.inFlight = false;
      if (transport.active) transport.timer = setTimeout(() => pollState(generation), Math.min(30000, 2000 * 2 ** transport.failures));
    }
  }
}
$('#connection-retry').addEventListener('click', bootstrap);
$('#logout').addEventListener('click', async () => {
  if ($('#logout').disabled) return;
  $('#logout').disabled = true;
  stopTransport();
  try { await api('/auth/logout', { method: 'POST', body: '{}' }); location.replace('/login.html'); }
  catch (error) {
    if (error.status === 401) return;
    showError(`로그아웃 요청을 확인하지 못했습니다. ${error.message}`);
    $('#logout').disabled = false;
    startPolling();
  }
});
window.addEventListener('pagehide', stopTransport);
window.addEventListener('pageshow', event => { if (event.persisted) bootstrap(); });
async function bootstrap() {
  stopTransport();
  $('#connection-retry').hidden = true;
  setConnection(false, '서버 연결 확인 중');
  try {
    applyState(await api('/api/state'));
    setConnection(true);
    showError('');
    if (isCloud() || model.state?.environment?.transport === 'polling') { startPolling(); return; }
  } catch (error) {
    if (error.status === 401 || transport.sessionExpired) return;
    setConnection(false, '서버 연결 안 됨');
    showError(`상태를 읽지 못했습니다. ${error.message}`);
    if (cloudHost || isCloud()) { startPolling(1); return; }
  }
  const events = new EventSource('/api/events');
  transport.events = events;
  events.addEventListener('state', event => {
    try { applyState(JSON.parse(event.data)); setConnection(true); showError(''); }
    catch { showError('서버의 상태 변경 기록을 읽지 못했습니다.'); }
  });
  events.onopen = () => { setConnection(true); showError(''); };
  events.onerror = () => setConnection(false, '연결 중단 · 자동 재연결 중');
}
if (viewNames[location.hash.slice(1)]) switchView(location.hash.slice(1));
if (cloudHost) renderRuntimeCopy();
bootstrap();

function maskEmail(email) { const [name, domain] = String(email || '').split('@'); return domain ? `${name.slice(0, 2)}***@${domain}` : '계정'; }
function shortTask(id) { const index = model.state?.tasks.findIndex(task => task.id === id) ?? -1; return index >= 0 ? `작업 #${index + 1}` : '작업'; }
const avaRoles = ['기획', '개발', '디자인', '사업', '검토'];
const avaSteps = [
 ['역할', '이 AVA가 맡을 역할', '기획'], ['기억 범위', '사용자가 선택할 자료 범위', '선택한 프로젝트 자료만'],
 ['목표와 선호', '달성할 목표와 일하는 방식', '근거를 먼저 확인하고 짧게 보고'], ['권한과 도구', '허용할 도구와 경계', '읽기와 초안 작성만'],
 ['실행 자원', '사용할 자원 후보', '연결된 자원 중 선택 · 현재 미연결'], ['예산', '예산 한도 후보', '외부 유료 호출 없음'],
 ['승인', '사람의 승인이 필요한 행동', '외부 전송·배포·권한 변경 전 승인'], ['첫 시험', '첫 시험의 목표와 검증 기준', '초안 작성 후 근거와 오류 확인'], ['AVA v1', '설정 검토', '']
];
const avaDraft = { step: 0, values: avaSteps.map(step => step[2]), candidate: null, message: '' };

function buildAvaCandidate(values, steps, generatedAt = new Date().toISOString()) {
 const configured = values.slice(0, 8).map(value => String(value ?? '').trim());
 if (configured.some(value => !value)) return { ok: false, error: '8개 설정을 모두 입력해 주세요.' };
 return {
  ok: true,
  candidate: {
   version: 'AVA_V1_CANDIDATE',
   status: 'CANDIDATE',
   generatedAt,
   settings: steps.slice(0, 8).map((step, index) => ({ label: step[0], value: configured[index] })),
   clientOnly: true,
   saved: false,
   executable: false
  }
 };
}

function renderAva() {
 $('#ava-team').innerHTML = avaRoles.map(role => `<article class="resource-card"><div class="record-top"><h2>${role} AVA</h2><span class="badge planned">PREVIEW</span></div><p>역할: ${role} 업무의 초안과 검토</p><p>기억: 사용자가 선택한 자료만</p><p>도구: 연결 전 · 권한: 읽기·초안 후보</p><p>예산: 설정 예정 · 최근 활동: 기록 없음</p><p>마지막 검증: 기록 없음</p><button class="button" data-ava-role="${role}">설정 흐름 살펴보기</button></article>`).join('');
 renderAvaWizard();
}

function renderAvaWizard() {
 const step = avaDraft.step;
 const definition = avaSteps[step];
 const candidate = avaDraft.candidate;
 const candidateHtml = candidate ? `<div class="record-card" id="ava-candidate"><div class="record-top"><h3>AVA v1 후보</h3><span class="badge planned">CANDIDATE</span></div><p>이 브라우저 화면에서만 만들어진 후보입니다. 서버에 저장되지 않습니다. 실행 권한이 없습니다.</p><dl>${candidate.settings.map(item => `<dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd>`).join('')}</dl><p class="subtle">생성 ${fmt(candidate.generatedAt)} · AI 호출 없음 · 외부 실행 없음</p></div>` : '';
 $('#ava-wizard').innerHTML = `<span class="eyebrow">AVA 생성 흐름 · PREVIEW · ${step + 1} / 9</span><h2>${definition[0]}</h2><p>후보 설정을 검토하는 화면입니다. 실제 저장·권한 부여·AI 실행은 하지 않습니다.</p>${step < 8 ? `<label for="ava-input">${definition[1]}</label><textarea id="ava-input" rows="3" maxlength="500">${esc(avaDraft.values[step])}</textarea>` : `<dl>${avaSteps.slice(0, 8).map((item, i) => `<dt>${item[0]}</dt><dd>${esc(avaDraft.values[i])}</dd>`).join('')}</dl><p class="notice">검증 전 AVA v1 후보를 이 화면 메모리에서만 만들어볼 수 있습니다. 새로고침하면 사라집니다.</p>`}${candidateHtml}<div class="detail-actions"><button class="button" data-ava-action="previous" ${step === 0 ? 'disabled' : ''}>이전</button>${step < 8 ? '<button class="button secondary" data-ava-action="next">다음</button>' : '<button class="button secondary" data-ava-action="create">AVA v1 후보 생성</button>'}<button class="button" data-ava-action="reset">입력 지우기</button></div>`;
 const liveStatus = $('#ava-live-status');
 liveStatus.textContent = avaDraft.message;
 liveStatus.classList.toggle('error', avaDraft.message === '8개 설정을 모두 입력해 주세요.');
}

function renderEvidence() {
 if (!model.state) return;
 $('#evidence-list').innerHTML = model.state.tasks.length ? model.state.tasks.slice().reverse().map(task => `<article class="record-card"><div class="record-top"><h2>${esc(shortTask(task.id))} · ${esc(task.title)}</h2>${status(task.status)}</div><p>${esc(scopeNote(task))}</p><ol>${(task.events || []).map(event => `<li>${esc(stageNames[event.stage] || '실행 기록')} · ${fmt(event.at)}</li>`).join('')}</ol><p>승인: ${task.approval ? '시험 절차에 대한 결정 기록 있음' : '별도 승인 요청 없음'} · QA: ${task.qa?.checks?.length && task.qa.checks.every(check => check.passed) ? '통과' : '고급 기록에서 확인'} · 영수증: ${task.receiptId ? '기록 있음' : '기록 없음'}</p><button class="button" data-action="select-task" data-id="${esc(task.id)}">작업과 결과 확인</button></article>`).join('') : empty('아직 작업 근거가 없습니다', '홈에서 시험 작업을 실행하면 기존 QA와 영수증을 함께 살펴볼 수 있습니다.');
}
document.addEventListener('click', event => {
 const role = event.target.closest('[data-ava-role]');
 const action = event.target.closest('[data-ava-action]');
 if (role) {
  avaDraft.step = 0;
  avaDraft.values[0] = role.dataset.avaRole;
  avaDraft.candidate = null;
  avaDraft.message = '';
  renderAvaWizard();
  $('#ava-wizard').scrollIntoView({ block: 'nearest' });
 }
 if (!action) return;
 if ($('#ava-input')) {
  const nextValue = $('#ava-input').value;
  if (avaDraft.values[avaDraft.step] !== nextValue) avaDraft.candidate = null;
  avaDraft.values[avaDraft.step] = nextValue;
 }
 avaDraft.message = '';
 if (action.dataset.avaAction === 'next') avaDraft.step = Math.min(8, avaDraft.step + 1);
 if (action.dataset.avaAction === 'previous') avaDraft.step = Math.max(0, avaDraft.step - 1);
 if (action.dataset.avaAction === 'create') {
  const built = buildAvaCandidate(avaDraft.values, avaSteps);
  if (!built.ok) avaDraft.message = built.error;
  else {
   avaDraft.candidate = built.candidate;
   avaDraft.message = 'AVA v1 후보를 이 화면에 만들었습니다. 저장·실행 권한은 부여되지 않았습니다.';
  }
 }
 if (action.dataset.avaAction === 'reset') {
  avaDraft.step = 0;
  avaDraft.values = avaSteps.map(() => '');
  avaDraft.candidate = null;
  avaDraft.message = '입력과 AVA 후보를 이 화면에서 지웠습니다.';
 }
 renderAvaWizard();
 $('#ava-wizard h2').setAttribute('tabindex', '-1');
 $('#ava-wizard h2').focus({ preventScroll: true });
});
renderAva();

window.addEventListener('popstate', () => switchView(viewNames[location.hash.slice(1)] ? location.hash.slice(1) : 'home'));

function renderSetup() {
 const installed = location.port === '4176';
 const download = $('#local-setup-download');
 download.hidden = installed;
 const cloud = isCloud();
 const localAi = model.state?.resources.find(resource => resource.provider === 'Ollama');
 const connected = localAi?.status === 'CONNECTED';
 $('#local-setup-status').innerHTML = `<h2>이 화면에서 확인한 상태</h2><p>현재 작업실: ${cloud ? 'Cloud 샌드박스 · PC 설정 상태 확인 불가' : installed ? '원클릭 패키지의 PC 작업실' : '로컬 검토용 작업실'}</p><p>Local AI: ${cloud ? 'PC 연결 미제공' : connected ? '기존 모델 연결 확인' : '사용 가능한 모델 연결을 확인하지 못함'}</p><p>중앙 Core·로그인 계정과 PC 연결: 아직 제공하지 않음</p><p>실제 AVA 생성·버전 저장: 준비 중</p>${installed ? '<p>현재 이 PC에서 패키지의 로컬 작업실을 실행하고 있습니다. 설치 결과는 패키지의 setup-result.json에서 확인하세요.</p>' : '<p>패키지 다운로드와 설치 완료는 다릅니다. 설치 프로그램이 실행환경을 확인한 뒤에만 완료를 표시합니다.</p>'}`;
}
