const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const api = async (path, options = {}) => {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
};

const STATE = { tasks: [], task: null, runners: [], running: false };
const TRACE_LABEL = {
  plan: '计划', search: '搜索', fetch: '读取', tool: '工具', observation: '观察',
  subagent: '子 Agent', source: '来源', message: '消息', error: '错误',
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindControls();
  const [{ tasks }, { runners }] = await Promise.all([
    api('/api/tasks').catch(() => ({ tasks: [] })),
    api('/api/runners').catch(() => ({ runners: [] })),
  ]);
  STATE.tasks = tasks;
  STATE.runners = runners;
  renderTaskList();
  renderModeStatus();
  renderRunnerConfig();
  if (tasks[0]) await openTask(tasks[0].id);
}

function bindControls() {
  $('#newTask').addEventListener('click', resetTask);
  $('#sendMessage').addEventListener('click', submitTask);
  $('#messageInput').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submitTask(); }
  });
  $('#taskMode').addEventListener('change', changeMode);
  $('#toggleInspector').addEventListener('click', () => {
    $('#workspace').classList.toggle('inspector-hidden');
    $('#toggleInspector').textContent = $('#workspace').classList.contains('inspector-hidden') ? '显示配置' : '隐藏配置';
  });
  $$('.examples button').forEach((button) => button.addEventListener('click', () => {
    $('#messageInput').value = button.dataset.example;
    $('#messageInput').focus();
  }));
  $$('.inspector-tabs button').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  $('#judgeSelect').addEventListener('change', saveRunnerSelection);
  $('#runnerList').addEventListener('change', saveRunnerSelection);
  $('#briefEditor').addEventListener('change', saveBrief);
  $('#rubricEditor').addEventListener('change', saveRubric);
  $('#importGithub').addEventListener('click', importGithub);
  $('#conversation').addEventListener('click', (event) => {
    if (event.target.closest('[data-run-task]')) runCurrentTask();
    if (event.target.closest('[data-evaluate-task]')) evaluateCurrentTask();
  });
}

function activateTab(name) {
  $$('.inspector-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${name}`));
}

function renderModeStatus() {
  const live = STATE.runners.filter((runner) => runner.runnable && runner.type !== 'sim').length;
  $('#modeStatus').innerHTML = `<span class="dot ${live ? 'on' : ''}"></span><span>${live ? `${live} 个真实 Runner 可用` : '当前仅 Sim 演示'}</span>`;
}

function renderTaskList() {
  $('#taskList').innerHTML = STATE.tasks.length ? STATE.tasks.map((task) => `
    <button class="task-item ${STATE.task?.id === task.id ? 'active' : ''}" data-task-id="${esc(task.id)}">
      <span class="task-state ${esc(task.status)}"></span>
      <span><b>${esc(task.title)}</b><small>${task.legacy ? 'v0.4 历史 · ' : ''}${formatDate(task.updatedAt || task.createdAt)}</small></span>
    </button>`).join('') : '<div class="empty-list">还没有任务<br>从一个开放问题开始</div>';
  $$('#taskList [data-task-id]').forEach((button) => button.addEventListener('click', () => openTask(button.dataset.taskId)));
}

function resetTask() {
  STATE.task = null;
  STATE.running = false;
  $('#taskTitle').textContent = '比较多个 Agent，得到证据支持度更高的答案';
  $('#taskSubtitle').textContent = '同一任务、同一证据要求、同一只读权限；执行过程与评审依据都可见。';
  $('#conversation').innerHTML = welcomeHtml();
  bindExamples();
  $('#messageInput').value = '';
  $('#messageInput').disabled = false;
  $('#sendMessage').textContent = '创建任务';
  $('#sendMessage').disabled = false;
  $('#briefEditor').className = 'empty';
  $('#briefEditor').innerHTML = '创建任务后显示';
  $('#rubricEditor').className = 'rubric-list empty';
  $('#rubricEditor').innerHTML = '创建任务后显示';
  renderRunnerConfig();
  renderTaskList();
}

function welcomeHtml() {
  return `<div class="welcome"><div class="welcome-kicker">从一个开放任务开始</div><h3>让不同 Agent 独立研究，再由 Judge 评审和融合</h3><p>适合调研、分析、方案设计等没有明确 GT、但可以用证据提高可靠性的任务。</p><div class="examples"><button data-example="调研 DeerFlow 2.0 与 Codex CLI 在深度研究任务上的关键差异，给出带来源的完整比较。">对比两个 Agent 框架</button><button data-example="调研 2026 年主流开源深度研究 Agent 的产品能力、技术架构与局限，附完整来源。">做一份时效性行业调研</button><button data-example="分析一个本地优先、多 Agent 答案融合产品应如何设计评审机制。">比较开放方案</button></div></div>`;
}

function bindExamples() {
  $$('.examples button').forEach((button) => button.addEventListener('click', () => {
    $('#messageInput').value = button.dataset.example;
    $('#messageInput').focus();
  }));
}

async function submitTask() {
  const message = $('#messageInput').value.trim();
  if (!message || STATE.running) return;
  setBusy(true, '正在生成任务简报…');
  try {
    const { task } = await api('/api/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, mode: $('#taskMode').value }),
    });
    STATE.task = task;
    STATE.tasks = (await api('/api/tasks')).tasks;
    $('#messageInput').value = '';
    renderTask();
    renderTaskList();
    activateTab('runners');
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function openTask(id) {
  const { task } = await api(`/api/tasks/${encodeURIComponent(id)}`);
  STATE.task = task;
  STATE.running = task.status === 'running';
  renderTask();
  renderTaskList();
}

function renderTask() {
  const task = STATE.task;
  if (!task) return resetTask();
  $('#taskTitle').textContent = task.title;
  $('#taskSubtitle').textContent = task.legacy ? 'v0.4 历史项目只读展示，原始数据不会被修改。' : evidenceText(task);
  $('#taskMode').value = task.mode || 'live';
  $('#taskMode').disabled = !!task.legacy;
  $('#sendMessage').textContent = '创建新任务';
  $('#conversation').innerHTML = taskHtml(task);
  renderBrief(task);
  renderRunnerConfig();
  renderRubric(task);
  scrollConversation();
}

function evidenceText(task) {
  return task.brief?.evidencePolicy === 'required'
    ? '证据策略：必须检索。无搜索、读取或来源 Trace 的回答会被标记未完成，并排除出事实融合。'
    : '证据策略：优先。所有 Agent 仍受只读权限边界约束。';
}

function taskHtml(task) {
  const intro = `<article class="message user"><div class="avatar">你</div><div class="bubble"><h3>${esc(task.brief?.objective || task.title)}</h3><p>${esc(task.brief?.deliverable || '')}</p><div class="policy ${task.brief?.evidencePolicy === 'required' ? 'required' : ''}">${esc(evidenceText(task))}</div></div></article>`;
  if (task.legacy) return `${intro}${task.finalAnswer ? resultHtml(task) : '<div class="empty-stage">该历史项目没有可展示的决策包。</div>'}`;
  const controls = task.status === 'ready' || task.status === 'failed'
    ? `<div class="stage-action"><button class="primary-btn" data-run-task>${task.status === 'failed' ? '重新运行 Agent' : '开始并行运行'}</button><span>先在右侧选择 Runner 与 Judge</span></div>`
    : '';
  const runs = task.runs?.length ? runBoardHtml(task.runs) : '';
  const evaluate = task.status === 'awaiting-evaluation' ? '<div class="stage-action"><button class="primary-btn" data-evaluate-task>让 Judge 评审并融合</button><span>只有满足证据要求的回答进入事实融合</span></div>' : '';
  const result = task.finalAnswer ? resultHtml(task) : '';
  return `${intro}${controls}${runs}${evaluate}${result}`;
}

function runBoardHtml(runs) {
  return `<section class="run-board"><div class="section-head"><div><span>PARALLEL RUNS</span><h3>Agent 独立执行与行动链路</h3></div><b>${runs.length} 个 Agent</b></div><div class="agent-grid">${runs.map(runCardHtml).join('')}</div></section>`;
}

function runCardHtml(run) {
  const totals = run.trace?.totals || {};
  const state = run.status === 'done' ? (run.research?.complete ? 'eligible' : 'incomplete') : run.status;
  const trace = run.trace?.steps || [];
  return `<article class="agent-card ${esc(state)}" id="run-${esc(run.id)}">
    <div class="agent-top"><div><span>${esc(run.framework)} · ${esc(run.model)}</span><h4>${esc(run.label)}</h4></div><b>${statusLabel(run)}</b></div>
    <div class="metrics"><span>${totals.searches || 0} 搜索</span><span>${totals.sources || 0} 来源</span><span>${totals.toolCalls || 0} 工具</span><span>${totals.errors || 0} 错误</span></div>
    ${run.research?.reason ? `<div class="incomplete-note">${esc(run.research.reason)}</div>` : ''}
    ${run.error ? `<div class="run-error">${esc(run.error)}</div>` : ''}
    <details class="trace-panel" ${run.status === 'running' ? 'open' : ''}><summary>行动链路 <em>${trace.length} 事件</em></summary><div class="trace-list">${trace.map(traceHtml).join('') || '<div class="empty-trace">等待事件…</div>'}</div></details>
    ${run.output ? `<details class="answer-panel"><summary>查看完整回答</summary><div class="markdown">${renderMarkdown(run.output)}</div></details>` : ''}
  </article>`;
}

function statusLabel(run) {
  if (run.status === 'running') return '运行中';
  if (run.status === 'capability-limited') return '能力不足';
  if (run.status === 'error') return '失败';
  if (run.research?.complete) return '可进入融合';
  if (run.status === 'done') return '未完成调研';
  return run.status;
}

function traceHtml(step) {
  const content = step.query || step.url || step.detail || '';
  return `<div class="trace-row ${esc(step.type)}"><i>${esc(TRACE_LABEL[step.type] || step.type)}</i><div><b>${esc(step.label)}</b>${content ? `<p>${esc(content)}</p>` : ''}</div></div>`;
}

function resultHtml(task) {
  const cards = task.scorecards || [];
  return `<section class="result-block"><div class="section-head"><div><span>JUDGE RESULT</span><h3>证据加权融合结果</h3></div><b>${cards.filter((card) => card.eligibleForFusion).length} 个回答进入融合</b></div>
    ${task.evaluation?.warnings?.length ? `<div class="warnings">${task.evaluation.warnings.map((item) => `<p>${esc(item)}</p>`).join('')}</div>` : ''}
    ${cards.length ? `<div class="scoreboard">${cards.map((card, index) => `<div class="score-row"><strong>${index + 1}</strong><div><b>${esc(card.label)}</b><span>${card.eligibleForFusion ? '进入事实融合' : esc(card.incompleteReason || '仅展示')}</span></div><em>${card.total}</em></div>`).join('')}</div>` : ''}
    <div class="final-answer markdown">${renderMarkdown(task.finalAnswer)}</div>
  </section>`;
}

function renderBrief(task) {
  if (!task || task.legacy) {
    $('#briefEditor').className = 'empty';
    $('#briefEditor').innerHTML = task?.legacy ? '历史任务只读' : '创建任务后显示';
    return;
  }
  const fields = [['objective', '任务目标'], ['deliverable', '期望交付物'], ['scope', '范围'], ['constraints', '约束'], ['freshness', '时效性']];
  $('#briefEditor').className = 'brief-editor';
  $('#briefEditor').innerHTML = fields.map(([key, label]) => `<label class="field">${label}<textarea data-brief="${key}">${esc(task.brief?.[key] || '')}</textarea></label>`).join('') + `<label class="field">证据策略<select data-brief="evidencePolicy"><option value="required" ${task.brief?.evidencePolicy === 'required' ? 'selected' : ''}>required · 必须搜索与引用来源</option><option value="preferred" ${task.brief?.evidencePolicy === 'preferred' ? 'selected' : ''}>preferred · 优先使用证据</option></select></label>`;
}

function renderRunnerConfig() {
  const task = STATE.task;
  const mode = task?.mode || $('#taskMode').value;
  const visible = STATE.runners.filter((runner) => mode === 'sim' ? runner.type === 'sim' : runner.type !== 'sim');
  $('#runnerList').innerHTML = visible.map((runner) => `
    <label class="runner-option ${runner.runnable ? '' : 'disabled'}">
      <input type="checkbox" data-runner-id="${esc(runner.id)}" ${task?.selectedRunnerIds?.includes(runner.id) ? 'checked' : ''} ${!runner.runnable || task?.legacy ? 'disabled' : ''}>
      <span><b>${esc(runner.label)}</b><small>${esc(runner.note || runner.permission || '')}</small><em>${capabilityTags(runner)}</em></span>
    </label>`).join('');
  const judges = visible.filter((runner) => runner.runnable && runner.capabilities?.judge);
  $('#judgeSelect').innerHTML = `<option value="">选择独立 Judge</option>${judges.map((runner) => `<option value="${esc(runner.id)}" ${task?.judgeRunnerId === runner.id ? 'selected' : ''}>${esc(runner.label)}</option>`).join('')}`;
  $('#judgeSelect').disabled = !task || !!task.legacy;
}

function capabilityTags(runner) {
  const caps = runner.capabilities || {};
  return [caps.search ? '可搜索' : '无搜索', caps.trace ? 'Trace' : '仅结果', caps.subagents ? '子 Agent' : '', runner.simulated ? '模拟' : ''].filter(Boolean).map((item) => `<i>${item}</i>`).join('');
}

function renderRubric(task) {
  if (!task || task.legacy) {
    $('#rubricEditor').className = 'rubric-list empty';
    $('#rubricEditor').innerHTML = task?.legacy ? '历史任务只读' : '创建任务后显示';
    return;
  }
  $('#rubricEditor').className = 'rubric-list';
  $('#rubricEditor').innerHTML = task.rubric.map((item) => `<label><span>${esc(item.label)}</span><input type="number" min="0" max="100" data-rubric="${esc(item.id)}" value="${Number(item.weight)}"><em>%</em></label>`).join('');
}

async function saveBrief() {
  if (!STATE.task || STATE.task.legacy) return;
  const brief = { ...STATE.task.brief };
  $$('[data-brief]').forEach((field) => { brief[field.dataset.brief] = field.value.trim(); });
  await patchCurrent({ brief });
}

async function saveRunnerSelection() {
  if (!STATE.task || STATE.task.legacy) return;
  const selectedRunnerIds = $$('[data-runner-id]:checked').map((input) => input.dataset.runnerId).slice(0, 4);
  const judgeRunnerId = $('#judgeSelect').value;
  await patchCurrent({ selectedRunnerIds, judgeRunnerId });
}

async function saveRubric() {
  if (!STATE.task || STATE.task.legacy) return;
  const rubric = STATE.task.rubric.map((item) => ({ ...item, weight: Number($(`[data-rubric="${item.id}"]`).value || 0) }));
  await patchCurrent({ rubric });
}

async function changeMode() {
  if (!STATE.task) { renderRunnerConfig(); return; }
  await patchCurrent({ mode: $('#taskMode').value, selectedRunnerIds: [], judgeRunnerId: '' });
  renderRunnerConfig();
}

async function patchCurrent(update) {
  const { task } = await api(`/api/tasks/${encodeURIComponent(STATE.task.id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update),
  });
  STATE.task = task;
  STATE.tasks = (await api('/api/tasks')).tasks;
  renderTaskList();
}

async function runCurrentTask() {
  if (!STATE.task || STATE.running) return;
  if (!STATE.task.selectedRunnerIds?.length) { activateTab('runners'); return showError('请先选择至少一个可运行 Agent。'); }
  STATE.running = true;
  STATE.task.status = 'running';
  STATE.task.runs = [];
  renderTask();
  setBusy(true, 'Agent 正在并行执行；行动链路会实时出现…');
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(STATE.task.id)}/run`, { method: 'POST' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) handleRunEvent(JSON.parse(line));
      if (done) break;
    }
  } catch (error) {
    showError(error.message);
  } finally {
    STATE.running = false;
    setBusy(false);
    STATE.tasks = (await api('/api/tasks')).tasks;
    renderTaskList();
  }
}

function handleRunEvent(event) {
  if (event.type === 'agent_start') {
    STATE.task.runs.push(event.run);
    renderTask();
  } else if (event.type === 'agent_trace') {
    const run = STATE.task.runs.find((item) => item.id === event.runId);
    if (run) {
      run.trace ||= { steps: [] };
      run.trace.steps.push(event.step);
      renderTask();
    }
  } else if (event.type === 'agent_done' || event.type === 'agent_error') {
    const index = STATE.task.runs.findIndex((item) => item.id === event.runId);
    if (index >= 0) STATE.task.runs[index] = event.run;
    renderTask();
  } else if (event.type === 'complete') {
    STATE.task = event.task;
    renderTask();
  } else if (event.type === 'error') {
    STATE.task = event.task || STATE.task;
    showError(event.error);
  }
}

async function evaluateCurrentTask() {
  if (!STATE.task || STATE.running) return;
  setBusy(true, 'Judge 正在评审与融合…');
  try {
    const { task } = await api(`/api/tasks/${encodeURIComponent(STATE.task.id)}/evaluate`, { method: 'POST' });
    STATE.task = task;
    renderTask();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function importGithub() {
  const button = $('#importGithub');
  button.disabled = true;
  $('#importStatus').textContent = '正在读取适配器清单…';
  try {
    const result = await api('/api/runners/import-github', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: $('#githubUrl').value.trim(), endpoint: $('#gatewayUrl').value.trim() }),
    });
    $('#importStatus').textContent = `${result.message}${result.confirmationRequired ? ' 已列出命令，但尚未执行。' : ''}`;
    STATE.runners = (await api('/api/runners')).runners;
    renderRunnerConfig();
    renderModeStatus();
  } catch (error) {
    $('#importStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function setBusy(busy, hint) {
  $('#sendMessage').disabled = busy;
  $('#messageInput').disabled = busy;
  $('#composerHint').textContent = hint || 'Aker 会自动生成任务简报与证据策略，不要求先填表';
}

function showError(message) {
  $('#conversation').insertAdjacentHTML('beforeend', `<div class="inline-error">${esc(message)}</div>`);
  scrollConversation();
}

function scrollConversation() {
  const container = $('#conversation');
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value)) : '';
}

function renderMarkdown(markdown = '') {
  const inline = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of String(markdown).split('\n')) {
    if (/^### /.test(line)) { close(); html += `<h4>${inline(line.slice(4))}</h4>`; }
    else if (/^## /.test(line)) { close(); html += `<h3>${inline(line.slice(3))}</h3>`; }
    else if (/^> /.test(line)) { close(); html += `<blockquote>${inline(line.slice(2))}</blockquote>`; }
    else if (/^- /.test(line)) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(line.slice(2))}</li>`; }
    else if (/^\d+\.\s/.test(line)) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`; }
    else if (!line.trim()) close();
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}
