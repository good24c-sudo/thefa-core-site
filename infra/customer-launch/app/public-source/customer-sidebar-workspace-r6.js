
/* THE FA Core Customer R6 — R4 sidebar kept; in-chat workspaces; safe per-tab drafts.
 * No new AI, entitlement, billing, account, server or job rights.
 * Same-origin page documents are shown inside an isolated tool frame (no new browser tab).
 */
(() => {
  'use strict';
  const ROUTES = Object.freeze({
    '/world-original-v2': 'world',
    '/world-original-v2.html': 'world',
    '/studio': 'studio',
    '/studio.html': 'studio',
    '/paid-demo': 'workbench',
    '/paid-demo.html': 'workbench',
    '/broker-preview': 'pc',
    '/broker-preview/': 'pc',
    '/broker-preview/index.html': 'pc',
    '/about': 'about',
    '/about.html': 'about',
    '/plans': 'plans',
    '/plans.html': 'plans',
    '/install': 'install',
    '/install.html': 'install'
  });
  const TOOLS = Object.freeze({
    world: { name: 'THE FA World', file: '/world-original-v2.html', desc: '더파월드를 현재 작업공간 안에서 둘러봅니다.' },
    studio: { name: '제작 스튜디오', file: '/studio.html', desc: '발표자료와 이미지를 이 화면 안에서 구성합니다.' },
    workbench: { name: 'AI 업무실', file: '/paid-demo.html', desc: '기존 업무 제작 기능을 대화 옆에서 확인합니다.' },
    pc: { name: '내 PC 연결', file: '/broker-preview/index.html', desc: 'PC 연동 화면을 안전하게 확인합니다.' },
    about: { name: '서비스 소개', file: '/about.html', desc: '서비스 안내를 이 화면 안에서 확인합니다.' },
    plans: { name: '요금제', file: '/plans.html', desc: '요금제 안내와 실제 사용권을 구분합니다.' },
    install: { name: '설치 안내', file: '/install.html', desc: '기존 로컬 프로그램 설치 안내입니다.' }
  });
  const input = document.getElementById('chat-input');
  const app = document.getElementById('app');
  const main = document.getElementById('chat-main');
  const chat = document.getElementById('chat-panel');
  const workspace = document.querySelector('.workspace');
  const toolbar = document.querySelector('.topbar-left');
  if (!input || !main || !chat || !app || !toolbar || !workspace) return;

  const draftNamespace = 'thefa_r6_tab_draft_v1:';
  let draftKey = null;
  let panel = null;
  let viewSnapshot = null;
  let activeTool = null;
  let nextToken = 0;
  const frames = new Map();

  function getDraftKey() {
    const header = document.getElementById('conversation-header');
    const history = document.querySelector('.chat-flow')?.dataset.renderedConversationId || '';
    if (!header || header.hidden) return 'new';
    if (/^chat_[a-z0-9-]{1,70}$/i.test(history)) return history;
    return 'new';
  }
  function storageKey(key) { return draftNamespace + key; }
  function draftStatus(message, status) {
    const span = document.getElementById('r6-draft-state');
    if (!span) return;
    span.textContent = message;
    span.dataset.r6State = status || '';
  }
  function saveDraft(key = draftKey) {
    if (!key) return;
    try {
      const value = input.value.slice(0, input.maxLength > 0 ? Math.min(input.maxLength, 8000) : 8000);
      if (value) {
        sessionStorage.setItem(storageKey(key), value);
        draftStatus('이 탭에 입력 초안 보존 중 · 아직 전송되지 않음', 'saved');
      } else {
        sessionStorage.removeItem(storageKey(key));
        draftStatus('', '');
      }
    } catch {
      draftStatus('브라우저 임시 저장 불가 · 입력창을 유지하세요', 'error');
    }
  }
  function readDraft(key) {
    try { return sessionStorage.getItem(storageKey(key)) || ''; }
    catch { return ''; }
  }
  function restoreDraft(next) {
    if (draftKey === next) return;
    if (draftKey !== null) saveDraft(draftKey);
    draftKey = next;
    const value = readDraft(next);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    draftStatus(value ? '이 탭에 보존한 입력 초안을 복원했습니다 · 전송 전' : '', value ? 'saved' : '');
  }
  function maybeClearSent() {
    if (!input.value && draftKey) {
      try { sessionStorage.removeItem(storageKey(draftKey)); }
      catch {}
      draftStatus('', '');
    }
  }
  const stateText = document.createElement('small');
  stateText.id = 'r6-draft-state';
  stateText.className = 'r6-draft-state';
  stateText.setAttribute('role', 'status');
  stateText.setAttribute('aria-live', 'polite');
  const composer = document.querySelector('.composer-region');
  if (composer) composer.append(stateText);
  draftKey = getDraftKey();
  const previous = readDraft(draftKey);
  if (!input.value && previous) {
    input.value = previous;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    draftStatus('이 탭에 보존한 입력 초안을 복원했습니다 · 전송 전', 'saved');
  } else if (input.value) saveDraft();
  input.addEventListener('input', () => saveDraft());
  input.addEventListener('change', () => saveDraft());
  document.getElementById('chat-form')?.addEventListener('submit', () => saveDraft(), true);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-suggest]')) queueMicrotask(() => saveDraft());
    // Drafts are cleared only after a *successful* logout navigation,
    // not merely when the logout button is clicked (the request could fail).
  }, true);
  const flow = document.querySelector('.chat-flow');
  const header = document.getElementById('conversation-header');
  const watcher = new MutationObserver(() => {
    const key = getDraftKey();
    if (key !== draftKey) restoreDraft(key);
    else if (input.value === '') maybeClearSent();
  });
  if (flow) watcher.observe(flow, { attributes: true, attributeFilter: ['data-rendered-conversation-id'] });
  if (header) watcher.observe(header, { attributes: true, attributeFilter: ['hidden'] });
  const messages = document.getElementById('messages');
  if (messages) watcher.observe(messages, { childList: true });
  window.addEventListener('pagehide', () => {
    const logout = document.getElementById('account-logout');
    const confirmedLogoutNavigation = Boolean(logout?.disabled &&
      logout.textContent?.includes('로그아웃 중'));
    if (confirmedLogoutNavigation) {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key?.startsWith(draftNamespace)) sessionStorage.removeItem(key);
        }
      } catch {}
      return;
    }
    saveDraft();
  });
  window.addEventListener('pageshow', () => {
    if (!input.value) {
      const current = readDraft(getDraftKey());
      if (current) { input.value = current; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  });

  function setSidebar(open) {
    app.classList.toggle('r6-sidebar-collapsed', !open);
    const button = document.getElementById('r6-toggle-sidebar');
    if (button) {
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? '왼쪽 메뉴 숨기기' : '왼쪽 메뉴 펼치기');
      button.textContent = open ? '☰' : '▤';
      button.title = open ? '메뉴 숨기기 · 채팅 넓게' : '메뉴 다시 펼치기';
    }
    try { sessionStorage.setItem('thefa_r6_sidebar_v1', open ? 'expanded' : 'collapsed'); }
    catch {}
  }
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'r6-toggle-sidebar';
  toggle.setAttribute('aria-controls', 'sidebar');
  toggle.setAttribute('aria-expanded', 'true');
  toolbar.insertBefore(toggle, toolbar.firstChild);
  let savedSidebar = 'expanded';
  try { savedSidebar = sessionStorage.getItem('thefa_r6_sidebar_v1') || 'expanded'; }
  catch {}
  setSidebar(savedSidebar !== 'collapsed');
  toggle.addEventListener('click', () => setSidebar(app.classList.contains('r6-sidebar-collapsed')));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeTool) {
      event.preventDefault();
      leaveTool(true);
    }
  });

  function initPanel() {
    if (panel) return panel;
    panel = document.createElement('section');
    panel.className = 'r6-inline-pane';
    panel.id = 'r6-inline-pane';
    panel.hidden = true;
    panel.setAttribute('aria-label', '채팅 안에서 여는 더파코어 화면');
    const top = document.createElement('div');
    top.className = 'r6-pane-topbar';
    const back = document.createElement('button');
    back.type = 'button';
    back.id = 'r6-pane-back';
    back.className = 'r6-pane-close';
    back.textContent = '← 대화로';
    back.addEventListener('click', () => leaveTool(true));
    const heading = document.createElement('div');
    heading.className = 'r6-pane-heading';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'r6-pane-eyebrow';
    eyebrow.textContent = 'THE FA CORE · 같은 작업공간';
    const title = document.createElement('h2');
    title.className = 'r6-pane-title';
    title.id = 'r6-pane-title';
    const description = document.createElement('p');
    description.className = 'r6-pane-description';
    description.id = 'r6-pane-description';
    heading.append(eyebrow, title, description);
    const wide = document.createElement('button');
    wide.className = 'r6-pane-action';
    wide.type = 'button';
    wide.id = 'r6-pane-wide';
    wide.textContent = '화면 넓게';
    wide.addEventListener('click', () => setSidebar(false));
    top.append(back, heading, wide);
    const body = document.createElement('div');
    body.className = 'r6-frame-wrap';
    body.id = 'r6-frame-wrap';
    const loading = document.createElement('div');
    loading.id = 'r6-pane-loading';
    loading.className = 'r6-pane-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = '화면을 불러오고 있습니다.';
    body.append(loading);
    panel.append(top, body);
    chat.querySelector('.chat-flow').append(panel);
    return panel;
  }
  function showPanelShell(tool) {
    const item = TOOLS[tool];
    if (!item) return false;
    initPanel();
    if (!viewSnapshot) {
      viewSnapshot = Array.from(main.querySelectorAll(':scope > section.panel'), x => ({ x, hidden: x.hidden }));
    }
    for (const { x } of viewSnapshot) x.hidden = x !== chat;
    chat.hidden = false;
    chat.classList.add('r6-tool-active');
    panel.hidden = false;
    document.getElementById('r6-pane-title').textContent = item.name;
    document.getElementById('r6-pane-description').textContent = item.desc;
    for (const [key, frame] of frames) frame.hidden = key !== tool;
    activeTool = tool;
    const loading = document.getElementById('r6-pane-loading');
    loading.hidden = frames.has(tool);
    if (!loading.hidden) loading.textContent = '화면을 불러오고 있습니다.';
    return true;
  }
  async function openTool(tool, updateHistory = true) {
    const item = TOOLS[tool];
    if (!item) return;
    saveDraft();
    const token = ++nextToken;
    showPanelShell(tool);
    if (updateHistory) history.pushState({ thefaR6Pane: tool }, '', '#thefa-r6-' + tool);
    if (frames.has(tool)) return;
    const loading = document.getElementById('r6-pane-loading');
    try {
      const response = await fetch(item.file, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok || response.redirected) throw new Error('서버 화면 요청을 완료하지 못했습니다.');
      let html = await response.text();
      if (!/^\s*<!doctype html|^\s*<html/i.test(html.slice(0, 180))) throw new Error('화면 내용이 HTML이 아닙니다.');
      if (!/<head(?:\s|>)/i.test(html)) throw new Error('화면의 기본 문서 구조를 확인하지 못했습니다.');
      // Scoped first-party World layout correction; retain original map and scripts.
      // A same-origin stylesheet is allowed by the existing strict CSP.
      if (tool === 'world') {
        if (!/<\/head>/i.test(html)) throw new Error('더파월드 문서 헤더를 확인하지 못했습니다.');
        html = html.replace(/<\/head>/i,
          '<link rel="stylesheet" href="/customer-world-embedded-r7.css"></head>');
      }
      // Source documents use root-relative CSS/JS. Do not inject a BASE tag:
      // the customer's published CSP correctly requires base-uri 'none'.
      const frame = document.createElement('iframe');
      frame.className = 'r6-embedded-frame';
      frame.title = item.name + ' · 채팅 내부 화면';
      // The input document is fetched only from the hardcoded same-origin
      // first-party route allowlist. Preserve its existing app JS/CSS behavior
      // without changing global X-Frame-Options or CSP for actual URL frames.
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('aria-label', item.name);
      frame.hidden = activeTool !== tool;
      frame.srcdoc = html;
      frame.addEventListener('load', () => {
        if (activeTool === tool) loading.hidden = true;
        // First-party frame links return to the parent workspace instead of
        // embedding a second copy of the entire customer app in this iframe.
        let inner;
        try { inner = frame.contentDocument; } catch { return; }
        if (!inner || inner.documentElement.dataset.r7NavHooked === 'true') return;
        inner.documentElement.dataset.r7NavHooked = 'true';
        inner.addEventListener('click', event => {
          const link = event.target.closest?.('a[href]');
          if (!link || link.hasAttribute('download') || link.target === '_blank' ||
              event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          const href = link.getAttribute('href') || '';
          if (!href || href.startsWith('#')) return;
          let next;
          try { next = new URL(href, location.origin); } catch { return; }
          if (next.origin !== location.origin) return;
          if (next.pathname === '/' || next.pathname === '/index.html' ||
              next.pathname === '/chat.html') {
            event.preventDefault();
            leaveTool(true);
            return;
          }
          const nextTool = ROUTES[next.pathname];
          if (nextTool) {
            event.preventDefault();
            openTool(nextTool);
          }
        }, true);
      });
      frames.set(tool, frame);
      document.getElementById('r6-frame-wrap').append(frame);
      if (token === nextToken && activeTool === tool) loading.hidden = true;
    } catch (error) {
      if (token !== nextToken || activeTool !== tool) return;
      loading.hidden = false;
      loading.textContent = item.name + ' 화면을 불러오지 못했습니다. 채팅과 작성 중인 글은 보존됩니다.';
    }
  }
  function closeTool() {
    if (!panel || !activeTool) return;
    ++nextToken;
    panel.hidden = true;
    chat.classList.remove('r6-tool-active');
    for (const frame of frames.values()) frame.hidden = true;
    if (viewSnapshot) {
      for (const { x, hidden } of viewSnapshot) x.hidden = hidden;
      viewSnapshot = null;
    }
    activeTool = null;
  }
  function leaveTool(useBack) {
    if (!activeTool) return;
    if (useBack && history.state?.thefaR6Pane) {
      history.back();
    } else {
      closeTool();
      if (history.state?.thefaR6Pane) history.replaceState(null, '', location.pathname + location.search);
    }
  }
  window.addEventListener('popstate', event => {
    const key = event.state?.thefaR6Pane;
    if (key && TOOLS[key]) openTool(key, false);
    else closeTool();
  });

  document.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    let uri;
    try { uri = new URL(link.href, location.href); } catch { return; }
    if (uri.origin !== location.origin) return;
    const tool = ROUTES[uri.pathname];
    if (!tool) return;
    event.preventDefault();
    event.stopPropagation();
    openTool(tool);
    const appSidebar = document.getElementById('app');
    if (appSidebar) appSidebar.classList.remove('menu-open');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.hidden = true;
  }, true);
  document.addEventListener('click', event => {
    if (!activeTool) return;
    if (event.target.closest('[data-open-chat], [data-open-project], [data-section], #new-chat, #project-new-chat, #open-settings')) {
      leaveTool(false);
    }
  }, true);
})();
