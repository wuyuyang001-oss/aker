const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const api = async (path, options = {}) => {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATE = {
  health: null,
  projects: [],
  project: null,
  connections: null,
  exploring: false,
};

const EVENT_META = {
  plan: ['计划', 'plan'],
  source_audit: ['证据', 'committee'],
  warning: ['提醒', 'warning'],
  agent_start: ['进行中', 'running'],
  agent_done: ['观点', 'done'],
  agent_error: ['失败', 'error'],
  committee_update: ['委员会', 'committee'],
  synthesis_start: ['综合', 'running'],
  complete: ['完成', 'done'],
  error: ['错误', 'error'],
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindStaticControls();
  const [health, projectData, connections] = await Promise.all([
    api('/api/health'),
    api('/api/projects').catch(() => ({ projects: [] })),
    api('/api/connections').catch(() => ({ cli: [], api: [], keychain: false })),
  ]);
  STATE.health = health;
  STATE.projects = projectData.projects || [];
  STATE.connections = connections;
  $('#projectMode').value = health.live ? 'live' : 'sim';
  renderConnectionStatus();
  renderProjectList();
  renderConnections();
  if (STATE.projects[0]) await openProject(STATE.projects[0].id);
}

function bindStaticControls() {
  $('#newProject').addEventListener('click', newProject);
  $('#sendMessage').addEventListener('click', submitMessage);
  $('#rerunProject').addEventListener('click', exploreCurrentProject);
  $('#openConnections').addEventListener('click', () => showView('connections'));
  $('#closeConnections').addEventListener('click', () => showView('project'));
  $('#saveBrief').addEventListener('click', saveBrief);
  $('#copyPackage').addEventListener('click', copyDecisionPackage);
  $('#projectMode').addEventListener('change', updateProjectMode);
  $('#messageInput').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submitMessage(); }
  });
  $$('.examples button').forEach((button) => button.addEventListener('click', () => {
    $('#messageInput').value = button.dataset.example;
    $('#messageInput').focus();
  }));
  $$('.inspector-tabs button').forEach((button) => button.addEventListener('click', () => activateInspector(button.dataset.inspector)));
  $('#decisionPackage').addEventListener('click', (event) => {
    const button = event.target.closest('[data-branch-claim]');
    if (button) createBranch(button.dataset.branchClaim);
  });
  $('#conversation').addEventListener('click', (event) => {
    if (event.target.closest('[data-open-package]')) activateInspector('package');
  });
}

function showView(name) {
  $('#projectView').classList.toggle('active', name === 'project');
  $('#connectionsView').classList.toggle('active', name === 'connections');
}

function activateInspector(name) {
  $$('.inspector-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.inspector === name));
  $$('.inspector-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `inspector-${name}`));
}

function renderConnectionStatus() {
  const usable = [
    ...(STATE.connections?.cli || []).filter((item) => item.runnable),
    ...(STATE.connections?.api || []).filter((item) => item.runnable),
  ];
  $('#connectionCount').textContent = usable.length;
  $('#modeStatus').innerHTML = `<span class="dot ${usable.length ? 'on' : ''}"></span><span>${usable.length ? `${usable.length} 条通道可运行` : '仅 Sim 演示'}</span>`;
}

function renderProjectList() {
  $('#projectList').innerHTML = STATE.projects.length
    ? STATE.projects.map((project) => `
      <button class="project-item ${STATE.project?.id === project.id ? 'active' : ''}" data-project-id="${esc(project.id)}">
        <span class="project-state ${esc(project.status)}"></span>
        <span><b>${esc(project.title)}</b><small>${project.parentId ? '分支探究 · ' : ''}${formatDate(project.updatedAt || project.createdAt)}</small></span>
      </button>`).join('')
    : '<div class="empty-projects">还没有项目<br>从一个重要问题开始</div>';
  $$('#projectList [data-project-id]').forEach((button) => button.addEventListener('click', () => openProject(button.dataset.projectId)));
}

function newProject() {
  STATE.project = null;
  STATE.exploring = false;
  $('#projectTitle').textContent = '提出真正重要的问题';
  $('#projectSubtitle').textContent = 'Aker 会在探究过程中持续审查证据、分歧与下一步，而不是最后才做评审。';
  $('#conversation').innerHTML = welcomeHtml();
  bindExamples();
  $('#messageInput').value = '';
  $('#messageInput').placeholder = '提出一个重要问题，或继续补充信息…';
  $('#sendMessage').textContent = '开始探究';
  $('#rerunProject').hidden = true;
  renderBrief(null);
  renderSources([]);
  renderPackage(null);
  renderProjectList();
  showView('project');
  $('#messageInput').focus();
}

function welcomeHtml() {
  return `<div class="welcome">
    <div class="welcome-kicker">从一句话开始</div>
    <h3>你现在需要研究什么问题，或者做出什么决定？</h3>
    <p>不需要先填写表单。Aker 会自动整理目标、约束、成功标准和关键未知项，只在真正影响结论时追问。</p>
    <div class="examples">
      <button data-example="我们是否应该在未来两周上线面向现有客户的 AI 周报功能？团队只有 2 名工程师，不能新增付费基础设施。">是否应该上线一个尚未验证需求的新功能？</button>
      <button data-example="我们应该选择自建 AI 客服还是采购 SaaS？希望三个月内上线，最不能接受的是客户数据泄露。">自建还是采购 AI 客服？</button>
      <button data-example="请调研我们进入东南亚市场的可行性，并给出先进入哪个国家的建议。">应该先进入哪个新市场？</button>
    </div>
  </div>`;
}

function bindExamples() {
  $$('.examples button').forEach((button) => button.addEventListener('click', () => {
    $('#messageInput').value = button.dataset.example;
    $('#messageInput').focus();
  }));
}

async function openProject(id) {
  const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
  STATE.project = project;
  STATE.exploring = project.status === 'running';
  renderProject();
  renderProjectList();
  showView('project');
}

function renderProject() {
  const project = STATE.project;
  if (!project) return newProject();
  $('#projectTitle').textContent = project.title;
  $('#projectSubtitle').textContent = project.parentId
    ? '这是从已有结论创建的分支探究。它拥有独立上下文和决策包。'
    : '对话、执行过程与决策包都保存在这个项目中，可以持续补充和重新探究。';
  $('#projectMode').value = project.mode;
  $('#rerunProject').hidden = STATE.exploring;
  $('#sendMessage').textContent = '补充信息';
  $('#messageInput').placeholder = '继续补充约束、证据或追问…';
  $('#conversation').innerHTML = [
    ...(project.messages || []).map(messageHtml),
    timelineHtml(project.timeline || []),
    project.decisionPackage ? packageNoticeHtml(project) : '',
  ].join('');
  scrollConversation();
  renderBrief(project.brief);
  renderSources(project.sources || []);
  renderPackage(project.decisionPackage);
}

function messageHtml(message) {
  return `<article class="message ${esc(message.role)}">
    <div class="message-role">${message.role === 'user' ? '你' : 'Aker'}</div>
    <div class="message-body">${renderMarkdown(message.content)}</div>
  </article>`;
}

function timelineHtml(events) {
  if (!events.length) return '';
  return `<section class="timeline-block">
    <div class="timeline-head"><span>实时执行与持续评审</span><b>${events.length} 个事件</b></div>
    <div class="timeline" id="timeline">${events.map(eventHtml).join('')}</div>
  </section>`;
}

function eventHtml(event) {
  const [label, kind] = EVENT_META[event.type] || ['事件', ''];
  return `<div class="timeline-event ${kind}">
    <span class="event-dot"></span>
    <div><div class="event-title"><b>${esc(event.title)}</b><span>${label}</span></div>${event.detail ? `<p>${esc(event.detail)}</p>` : ''}</div>
    <time>${formatTime(event.at)}</time>
  </div>`;
}

function packageNoticeHtml(project) {
  return `<article class="message assistant package-notice">
    <div class="message-role">Aker</div>
    <div class="message-body"><h3>决策包已完成</h3><p>建议、最强反对意见、未解决的不确定性和最低成本验证已整理到右侧。点击任意要点可以创建分支探究。</p><button class="inline-action" data-open-package>查看决策包</button></div>
  </article>`;
}

async function submitMessage() {
  const input = $('#messageInput');
  const message = input.value.trim();
  if (!message || STATE.exploring) return;
  input.value = '';
  if (!STATE.project) {
    setComposerBusy(true, '正在建立决策项目…');
    try {
      const { project } = await api('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, mode: $('#projectMode').value }),
      });
      STATE.project = project;
      STATE.projects = (await api('/api/projects')).projects;
      renderProject();
      renderProjectList();
      await exploreCurrentProject();
    } catch (error) {
      showComposerError(error.message);
    } finally {
      if (!STATE.exploring) setComposerBusy(false);
    }
    return;
  }
  setComposerBusy(true, '正在更新工作简报…');
  try {
    const { project } = await api(`/api/projects/${encodeURIComponent(STATE.project.id)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    STATE.project = project;
    STATE.projects = (await api('/api/projects')).projects;
    renderProject();
    renderProjectList();
  } catch (error) {
    showComposerError(error.message);
  } finally {
    setComposerBusy(false);
  }
}

async function exploreCurrentProject() {
  if (!STATE.project || STATE.exploring) return;
  STATE.exploring = true;
  STATE.project.status = 'running';
  STATE.project.timeline = [];
  STATE.project.decisionPackage = null;
  renderProject();
  setComposerBusy(true, '探究进行中，可实时查看上方过程…');
  $('#rerunProject').hidden = true;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(STATE.project.id)}/explore`, { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) handleStreamEvent(JSON.parse(line));
      if (done) break;
    }
  } catch (error) {
    showComposerError(`探究失败：${error.message}`);
  } finally {
    STATE.exploring = false;
    setComposerBusy(false);
    $('#rerunProject').hidden = false;
    STATE.projects = (await api('/api/projects')).projects;
    renderProjectList();
  }
}

function handleStreamEvent(payload) {
  if (payload.type === 'event') {
    STATE.project.timeline ||= [];
    STATE.project.timeline.push(payload.event);
    const timeline = $('#timeline');
    if (timeline) timeline.insertAdjacentHTML('beforeend', eventHtml(payload.event));
    else {
      $('#conversation').insertAdjacentHTML('beforeend', timelineHtml([payload.event]));
    }
    scrollConversation();
  } else if (payload.type === 'complete') {
    STATE.project = payload.project;
    renderProject();
    activateInspector('package');
  } else if (payload.type === 'error') {
    STATE.project = payload.project || STATE.project;
    showComposerError(payload.error);
  }
}

function renderBrief(brief) {
  if (!brief) {
    $('#briefSummary').innerHTML = '提出问题后自动生成';
    $('#briefSummary').classList.add('empty-small');
    for (const id of ['briefDecision', 'briefContext', 'briefConstraints', 'briefCriteria', 'briefUnknowns', 'briefAssumptions']) $(`#${id}`).value = '';
    return;
  }
  $('#briefSummary').classList.remove('empty-small');
  const entries = [
    ['决策问题', brief.decision],
    ['已知背景', brief.context],
    ['约束', brief.constraints],
    ['成功标准', brief.criteria],
    ['关键未知项', brief.unknowns],
    ['默认假设', brief.assumptions],
  ];
  $('#briefSummary').innerHTML = entries.map(([label, value]) => `<div class="brief-item"><span>${label}</span><p>${esc(value || '尚未明确')}</p></div>`).join('');
  $('#briefDecision').value = brief.decision || '';
  $('#briefContext').value = brief.context || '';
  $('#briefConstraints').value = brief.constraints || '';
  $('#briefCriteria').value = brief.criteria || '';
  $('#briefUnknowns').value = brief.unknowns || '';
  $('#briefAssumptions').value = brief.assumptions || '';
}

async function saveBrief() {
  if (!STATE.project) return;
  const brief = {
    decision: $('#briefDecision').value.trim(),
    context: $('#briefContext').value.trim(),
    constraints: $('#briefConstraints').value.trim(),
    criteria: $('#briefCriteria').value.trim(),
    unknowns: $('#briefUnknowns').value.trim(),
    assumptions: $('#briefAssumptions').value.trim(),
  };
  const { project } = await api(`/api/projects/${encodeURIComponent(STATE.project.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief }),
  });
  STATE.project = project;
  renderBrief(project.brief);
  $('#briefEditor').open = false;
}

async function updateProjectMode() {
  if (!STATE.project) return;
  const { project } = await api(`/api/projects/${encodeURIComponent(STATE.project.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: $('#projectMode').value }),
  });
  STATE.project = project;
}

function renderPackage(markdown) {
  const container = $('#decisionPackage');
  if (!markdown) {
    container.className = 'decision-content empty-small';
    container.innerHTML = '完成探究后生成';
    $('#copyPackage').hidden = true;
    return;
  }
  container.className = 'decision-content';
  container.innerHTML = renderMarkdown(markdown, true);
  $('#copyPackage').hidden = false;
}

function renderSources(sources) {
  const container = $('#sourceList');
  if (!sources?.length) {
    container.className = 'source-list empty-small';
    container.innerHTML = '在对话中粘贴公开网页链接，Aker 会自动整理';
    return;
  }
  container.className = 'source-list';
  container.innerHTML = sources.map((source) => {
    const state = source.status === 'ready' ? '已读取' : source.status === 'failed' ? '读取失败' : '已记录';
    return `<article class="source-card">
      <div class="source-head"><b>${esc(source.id)}</b><span class="${esc(source.status)}">${state}</span></div>
      <a href="${esc(source.finalUrl || source.url)}" target="_blank" rel="noreferrer">${esc(source.title || source.url)}</a>
      <p>${esc(source.excerpt ? `${source.excerpt.slice(0, 240)}${source.excerpt.length > 240 ? '…' : ''}` : source.error || 'Aker 已记录链接；当前没有可读取摘要。')}</p>
    </article>`;
  }).join('');
}

async function copyDecisionPackage() {
  if (!STATE.project?.decisionPackage) return;
  await navigator.clipboard.writeText(STATE.project.decisionPackage);
  const button = $('#copyPackage');
  button.textContent = '已复制';
  setTimeout(() => { button.textContent = '复制决策包'; }, 1200);
}

async function createBranch(claim) {
  if (!STATE.project) return;
  const { project } = await api(`/api/projects/${encodeURIComponent(STATE.project.id)}/branches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claim, prompt: `请挑战并进一步验证这个主张：${claim}` }),
  });
  STATE.projects = (await api('/api/projects')).projects;
  STATE.project = project;
  renderProject();
  renderProjectList();
  activateInspector('brief');
  await exploreCurrentProject();
}

function renderConnections() {
  const cli = STATE.connections?.cli || [];
  const apis = STATE.connections?.api || [];
  $('#cliConnections').innerHTML = cli.map((item) => connectionCard(item)).join('');
  $('#apiConnections').innerHTML = apis.map((item) => apiCard(item)).join('');
  $$('[data-test-connection]').forEach((button) => button.addEventListener('click', () => testConnection(button.dataset.testConnection, button)));
  $$('[data-save-api]').forEach((button) => button.addEventListener('click', () => saveApi(button.dataset.saveApi, button)));
  $$('[data-remove-api]').forEach((button) => button.addEventListener('click', () => removeApi(button.dataset.removeApi)));
}

function connectionCard(item) {
  const state = item.runnable ? '可运行' : item.detected ? '已检测' : '未安装';
  return `<article class="connection-card">
    <div class="connection-top"><span class="connection-icon">⌘</span><div><h4>${esc(item.label)}</h4><p>${esc(item.note)}</p></div><span class="connection-state ${item.runnable ? 'ready' : ''}">${state}</span></div>
    <div class="capabilities">${(item.capabilities || []).map((cap) => `<span>${esc(cap)}</span>`).join('')}</div>
    <div class="connection-path">${esc(item.version || '')}<br>${esc(item.path || '未找到可执行文件')}</div>
    <button class="ghost-btn wide" data-test-connection="${esc(item.id)}">测试检测</button>
  </article>`;
}

function apiCard(item) {
  return `<article class="connection-card">
    <div class="connection-top"><span class="connection-icon">API</span><div><h4>${esc(item.label)}</h4><p>${esc(item.note)}</p></div><span class="connection-state ${item.configured ? 'ready' : ''}">${item.configured ? '已配置' : '未配置'}</span></div>
    <label class="connection-field">模型<input data-api-model="${esc(item.id)}" value="${esc(item.model)}"></label>
    <label class="connection-field">API Key<input data-api-key="${esc(item.id)}" type="password" placeholder="${item.configured ? `已存储于 ${esc(item.secretStore)}` : '输入后保存到 macOS Keychain'}"></label>
    <div class="connection-actions">
      <button class="primary-btn" data-save-api="${esc(item.id)}">保存</button>
      <button class="ghost-btn" data-test-connection="${esc(item.id)}">测试连接</button>
      ${item.configured && item.secretStore !== 'environment' ? `<button class="text-btn danger" data-remove-api="${esc(item.id)}">移除</button>` : ''}
    </div>
  </article>`;
}

async function saveApi(provider, button) {
  button.disabled = true;
  try {
    STATE.connections = await api('/api/connections/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        model: $(`[data-api-model="${provider}"]`).value,
        key: $(`[data-api-key="${provider}"]`).value,
      }),
    });
    STATE.health = await api('/api/health');
    renderConnections();
    renderConnectionStatus();
  } finally { button.disabled = false; }
}

async function removeApi(provider) {
  STATE.connections = await api('/api/connections/api', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  STATE.health = await api('/api/health');
  renderConnections();
  renderConnectionStatus();
}

async function testConnection(id, button) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    const result = await api('/api/connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    button.textContent = result.ok ? '连接正常' : result.message;
  } catch (error) {
    button.textContent = error.message;
  }
  setTimeout(() => { button.textContent = old; button.disabled = false; }, 2200);
}

function setComposerBusy(busy, hint) {
  STATE.exploring = busy && STATE.exploring;
  $('#sendMessage').disabled = busy;
  $('#messageInput').disabled = busy;
  if (hint) $('#composerHint').textContent = hint;
  else $('#composerHint').textContent = 'Aker 会使用合理假设继续，并明确标注未知项';
}

function showComposerError(message) {
  $('#conversation').insertAdjacentHTML('beforeend', `<div class="inline-error">${esc(message)}</div>`);
  scrollConversation();
}

function scrollConversation() {
  const conversation = $('#conversation');
  requestAnimationFrame(() => { conversation.scrollTop = conversation.scrollHeight; });
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function renderMarkdown(markdown = '', branchable = false) {
  const lines = String(markdown).split('\n');
  let html = '';
  let list = null;
  const inline = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    if (/^### /.test(line)) { closeList(); html += `<h4>${inline(line.slice(4))}</h4>`; }
    else if (/^## /.test(line)) { closeList(); html += `<h3>${inline(line.slice(3))}</h3>`; }
    else if (/^> /.test(line)) { closeList(); html += `<blockquote>${inline(line.slice(2))}</blockquote>`; }
    else if (/^- /.test(line)) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      const claim = line.slice(2);
      html += `<li>${inline(claim)}${branchable ? `<button class="branch-button" data-branch-claim="${esc(claim)}">分支探究</button>` : ''}</li>`;
    } else if (/^\d+\.\s/.test(line)) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`;
    } else if (!line.trim()) closeList();
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}
