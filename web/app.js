// app.js — aker 前端 (vanilla, 无构建)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = (p, opts) => fetch(p, opts).then((r) => r.json());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let STATE = { frameworks: [], traceMeta: {}, matrixCols: [], liveAgents: [], reviewRoles: [], mode: 'sim', lastRun: null };

// Sim 模式展示用候选；Live 模式候选完全由 /api/health 返回，保证选择后真的可运行。
const SIM_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-x', 'o-series', 'hermes-3', 'gemini-x'];
const DEFAULT_SIM_AGENTS = [
  { role: 'strategist', framework: 'claude-code', model: 'claude-opus-4-8' },
  { role: 'critic', framework: 'codex-cli', model: 'gpt-x' },
  { role: 'operator', framework: 'langgraph', model: 'o-series' },
  { role: 'researcher', framework: 'crewai', model: 'gemini-x' },
];

// ───────── tabs ─────────
function activateTab(b) {
  $$('#tabs button').forEach((x) => {
    const on = x === b;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
    x.tabIndex = on ? 0 : -1;
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${b.dataset.tab}`));
  if (b.dataset.tab === 'committee') { refreshRunPickers().then(() => { if ($('#reviewRun').value) doReview(); }); }
  else if (b.dataset.tab === 'trace') { refreshRunPickers(); }
}
$$('#tabs button').forEach((b) => {
  b.addEventListener('click', () => activateTab(b));
  // 键盘左右方向键在 tablist 内移动焦点（roving tabindex）
  b.addEventListener('keydown', (e) => {
    const tabs = $$('#tabs button');
    const i = tabs.indexOf(b);
    let ni = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ni = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ni = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') ni = 0;
    else if (e.key === 'End') ni = tabs.length - 1;
    if (ni >= 0) { e.preventDefault(); activateTab(tabs[ni]); tabs[ni].focus(); }
  });
});

// ───────── init ─────────
(async function init() {
  const [health, fw] = await Promise.all([api('/api/health'), api('/api/frameworks')]);
  STATE.frameworks = fw.frameworks; STATE.traceMeta = fw.traceabilityMeta; STATE.matrixCols = fw.matrixColumns;
  STATE.live = !!health.live;
  STATE.liveAgents = health.liveAgents || [];
  STATE.reviewRoles = health.reviewRoles || [
    { id: 'strategist', label: '策略评审' }, { id: 'critic', label: '反方评审' }, { id: 'operator', label: '执行评审' },
  ];
  STATE.mode = health.live ? 'live' : 'sim';
  $('#modedot').classList.toggle('on', health.live);
  $('#modetext').textContent = health.live ? 'Live 通道已检测' : '仅 Sim 演示';
  $('#modepill').title = health.note || '';
  $('#capabilityText').innerHTML = health.live
    ? `<b class="ok">已检测：</b>${esc(health.note)}。默认尝试真实判断；失败会明确报错，不会降级成模拟结果。`
    : `<b class="warn-text">尚无真实通道：</b>${esc(health.note)}。可先体验 Sim；要产生真实效果，请安装并登录 Codex CLI，或设置 OPENAI_API_KEY / ANTHROPIC_API_KEY 后重启。`;
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === STATE.mode));
  renderAgentRows(defaultAgentsForMode());
  renderFrameworks();
  bindRunControls();
  $('#loadExample').addEventListener('click', () => {
    $('#decision').value = '我们是否应该在未来两周上线面向现有客户的 AI 周报功能？';
    $('#context').value = '已有客户持续反馈周报整理耗时，但尚未验证他们是否愿意使用 AI 自动生成内容。';
    $('#constraints').value = '团队只有 2 名工程师，周期 2 周，不能新增付费基础设施；不能向客户展示未经确认的事实。';
    $('#criteria').value = '至少 5 名现有客户真实试用；其中 3 名愿意连续使用；人工校对时间低于 10 分钟。';
    $('#unknowns').value = '客户真实使用频率、可接受的错误率、是否愿意授权所需数据。';
    $('#decision').focus();
  });
  $('#committeeOut').innerHTML = '<div class="card empty">完成一次独立判断后，在这里生成建议、条件、反对意见与验证动作完整的决策包。</div>';
  $('#traceOut').innerHTML = '<div class="card empty">选择一次决策与两个视角，检查它们的过程支撑是否存在明显差异。</div>';
  // 无 key 时锁定 Sim：禁用 Live 按钮（U1 / H6 —— Pages 在线版永远走这里）
  if (!health.live) {
    const lb = $('#modeSeg [data-mode="live"]');
    if (lb) {
      lb.disabled = true;
      lb.setAttribute('aria-disabled', 'true');
      lb.title = '未检测到 ANTHROPIC_API_KEY / OPENAI_API_KEY，无法 Live（仅 Sim 模拟）';
    }
    STATE.mode = 'sim';
  }
  await refreshRunPickers();
})();

// ───────── 运行台 ─────────
function defaultAgentsForMode() {
  if (STATE.mode !== 'live' || !STATE.liveAgents.length) return DEFAULT_SIM_AGENTS.map((a) => ({ ...a }));
  const runner = STATE.liveAgents[0];
  return ['strategist', 'critic', 'operator', 'researcher'].map((role) => ({ role, framework: runner.framework, model: runner.model }));
}
function availableFrameworks() {
  if (STATE.mode !== 'live') return STATE.frameworks.map((f) => ({ id: f.id, label: f.name }));
  return [...new Map(STATE.liveAgents.map((a) => [a.framework, { id: a.framework, label: fwName(a.framework) }])).values()];
}
function fwOptions(sel) {
  return availableFrameworks().map((f) => `<option value="${esc(f.id)}" ${f.id === sel ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
}
function modelOptions(sel, framework) {
  const models = STATE.mode === 'live'
    ? STATE.liveAgents.filter((a) => a.framework === framework).map((a) => ({ id: a.model, label: a.label }))
    : SIM_MODELS.map((m) => ({ id: m, label: m }));
  return models.map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
}
function roleOptions(sel) {
  return STATE.reviewRoles.map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
}

function renderAgentRows(agents) {
  $('#agentRows').innerHTML = agents.map((a, i) => `
    <div class="agent-row" data-i="${i}">
      <select class="role" aria-label="第 ${i + 1} 个判断视角">${roleOptions(a.role)}</select>
      <select class="fw" aria-label="第 ${i + 1} 个视角的运行通道">${fwOptions(a.framework)}</select>
      <select class="ml" aria-label="第 ${i + 1} 个视角的模型">${modelOptions(a.model, a.framework)}</select>
      <button class="icon-btn rm" title="移除该视角" aria-label="移除第 ${i + 1} 个视角"><span aria-hidden="true">×</span></button>
    </div>`).join('');
  $$('#agentRows .fw').forEach((select) => select.addEventListener('change', (e) => {
    const row = e.target.closest('.agent-row');
    $('.ml', row).innerHTML = modelOptions('', e.target.value);
  }));
  $$('#agentRows .rm').forEach((btn) => btn.addEventListener('click', (e) => {
    const rows = collectAgents(); const i = +e.target.closest('.agent-row').dataset.i;
    rows.splice(i, 1); renderAgentRows(rows.length ? rows : defaultAgentsForMode().slice(0, 1));
  }));
}
function collectAgents() {
  return $$('#agentRows .agent-row').map((r) => ({ role: $('.role', r).value, framework: $('.fw', r).value, model: $('.ml', r).value }));
}
function bindRunControls() {
  $('#addAgent').addEventListener('click', () => {
    const rows = collectAgents();
    const runner = STATE.mode === 'live' ? STATE.liveAgents[0] : { framework: 'crewai', model: 'gemini-x' };
    const role = STATE.reviewRoles[rows.length % STATE.reviewRoles.length]?.id || 'researcher';
    renderAgentRows([...rows, { role, framework: runner.framework, model: runner.model }]);
  });
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return; // 无 key 时 Live 不可选（U1）
    $$('#modeSeg button').forEach((x) => x.classList.toggle('active', x === b)); STATE.mode = b.dataset.mode;
    renderAgentRows(defaultAgentsForMode());
  }));
  $('#runBtn').addEventListener('click', submitRun);
  $$('.brief-input').forEach((input) => input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitRun(); }
  }));
}

function composeDecisionBrief() {
  const sections = [
    ['决策问题', $('#decision').value.trim()],
    ['已知背景', $('#context').value.trim()],
    ['约束与不可接受结果', $('#constraints').value.trim()],
    ['成功标准', $('#criteria').value.trim()],
    ['关键未知项', $('#unknowns').value.trim()],
  ];
  return sections.filter(([, value]) => value).map(([title, value]) => `## ${title}\n${value}`).join('\n\n');
}

async function submitRun() {
  const decision = $('#decision').value.trim();
  const task = composeDecisionBrief();
  const agents = collectAgents();
  if (!decision) {
    $('#runStatus').innerHTML = '<div class="card warn" role="alert">请先写清楚要做的决定。一个好的问题通常可以用“是否应该……”或“应选择哪种方案……”表达。</div>';
    $('#decision').focus();
    return;
  }
  if (!agents.length) return;
  const btn = $('#runBtn'); btn.disabled = true; btn.textContent = '判断中…'; btn.setAttribute('aria-busy', 'true');
  // 先渲染 running 占位卡
  $('#results').innerHTML = agents.map((a, i) => agentCardShell(a, i)).join('');
  // 等待期计时指示（U4：真正逐个流式落地需后端 SSE，记入 CRITICISMS.md）
  const t0 = Date.now();
  const hint = STATE.mode === 'live' ? ' · Live 模式下单个 agent 可能需要数十秒' : '';
  const tick = () => {
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    $('#runStatus').innerHTML = `<div class="card"><div class="metrics"><span class="spin" aria-hidden="true"></span><span>独立判断中 <b>${s}s</b> · <b>${agents.length}</b> 个视角互不查看彼此答案 · 模式 <b>${esc(STATE.mode)}</b>${hint}</span></div></div>`;
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    const { run, error } = await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, agents, mode: STATE.mode }) });
    if (error) throw new Error(error);
    STATE.lastRun = run;
    $('#results').innerHTML = run.agents.map(agentCard).join('');
    clearInterval(timer);
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const done = run.agents.filter((a) => a.status === 'done').length;
    const failed = run.agents.length - done;
    const simNote = run.mode === 'sim' ? ' · <b>Sim 模拟数据</b>（非真实模型）' : ' · <b>真实运行</b>';
    const next = done >= 2 ? '<button class="btn sm" id="openCommittee">生成最终决策包</button>' : '';
    $('#runStatus').innerHTML = `<div class="card run-complete"><div class="metrics"><span class="status ${failed ? 'error' : 'done'}" role="img" aria-label="已完成"></span><span>完成 <b>${done}</b> 个独立视角${failed ? ` · 失败 <b>${failed}</b> 个` : ''} · 用时 <b>${dur}s</b>${simNote} · 已存档</span></div>${next}</div>`;
    $('#openCommittee')?.addEventListener('click', () => activateTab($('#tab-committee')));
    refreshRunPickers(run.id);
  } catch (e) {
    clearInterval(timer);
    $('#runStatus').innerHTML = `<div class="card warn" role="alert"><span style="color:var(--red)">运行失败：${esc(e.message)}</span></div>`;
  } finally { clearInterval(timer); btn.disabled = false; btn.textContent = '▶ 开始独立判断'; btn.removeAttribute('aria-busy'); }
}

const STATUS_LABEL = { running: '执行中', done: '已完成', error: '失败' };
function statusDot(s) { return `<span class="status ${esc(s)}" role="img" aria-label="${esc(STATUS_LABEL[s] || s)}"></span>`; }

function agentCardShell(a, i) {
  return `<div class="agent-card"><div class="head">${statusDot('running')}<span class="fw-tag">${esc(fwName(a.framework))}</span><span class="model">${esc(a.model)}</span></div><div class="out" style="color:var(--faint)">执行中…</div></div>`;
}
function agentCard(a) {
  const t = a.trace?.totals || {};
  const src = a.trace?.source;
  const isSim = a.mode === 'sim';
  const isError = a.status === 'error';
  // Sim 一律强制标记「模拟数据」，指标加 ~ 前缀 + 弱化 + title。
  const modePill = isError
    ? '<span class="pill failed">LIVE FAILED · 未降级</span>'
    : isSim
    ? '<span class="pill sim" title="本卡所有指标为模板生成的模拟值，非真实测量">SIMULATED · 模拟数据</span>'
    : '<span class="pill" title="真实调用模型">live</span>';
  const mcls = isSim ? 'metric-sim' : '';
  const mtitle = isSim ? ' title="模拟值，非真实测量"' : '';
  const pfx = isSim ? '~' : '';
  // 兼容旧 run 中的 note，显示为卡片级告警横幅。
  const banner = a.note ? `<div class="card-banner warn" role="note">${esc(a.note)}</div>` : '';
  return `<div class="agent-card${isSim ? ' is-sim' : ''}">
    ${banner}
    <div class="head">${statusDot(a.status)}<span class="role-tag">${esc(roleName(a.role))}</span><span class="fw-tag">${esc(fwName(a.framework))}</span><span class="model">${esc(a.model)}</span>${modePill}</div>
    <div class="out">${esc(a.output || a.error || '')}</div>
    <div class="metrics ${mcls}"${mtitle}>
      <span>步骤 <b>${pfx}${t.steps || 0}</b></span>
      <span>工具 <b>${pfx}${t.toolCalls || 0}</b></span>
      <span>token <b>${pfx}${t.tokens || 0}</b></span>
      <span>耗时 <b>${pfx}${t.wallMs || 0}</b>ms</span>
      ${src ? `<span title="${esc(src.how)}${isSim ? '（模拟 trace）' : ''}">trace: <b>${esc(STATE.traceMeta[src.traceability]?.label || src.traceability)}${isSim ? '（模拟）' : ''}</b></span>` : ''}
    </div>
  </div>`;
}
function fwName(id) { return STATE.frameworks.find((f) => f.id === id)?.name || id; }
function roleName(id) { return STATE.reviewRoles.find((r) => r.id === id)?.label || id || '独立评审'; }

// ───────── run pickers (评审会 / trace 共用) ─────────
async function refreshRunPickers(selectId) {
  const { runs } = await api('/api/runs');
  const opts = runs.map((r) => {
    const tag = r.mode === 'sim' ? ' · [Sim]' : ' · [Live]';
    return `<option value="${esc(r.id)}">${esc(decisionTitle(r.task).slice(0, 38))} · ${r.agentCount}视角${tag}</option>`;
  }).join('');
  for (const sel of ['#reviewRun', '#traceRun']) { const el = $(sel); if (el) { el.innerHTML = opts; if (selectId) el.value = selectId; } }
  await onTraceRunChange();
}

function decisionTitle(task = '') {
  const match = task.match(/## 决策问题\s*\n([^\n]+)/);
  return match?.[1]?.trim() || task.replace(/^#+\s*/gm, '').trim();
}

// ───────── 评审会 ─────────
$('#reviewBtn').addEventListener('click', doReview);
$$('#reviewMode button').forEach((b) => b.addEventListener('click', () => {
  $$('#reviewMode button').forEach((x) => x.classList.toggle('active', x === b)); doReview();
}));
async function doReview() {
  const runId = $('#reviewRun').value;
  const mode = $('#reviewMode button.active').dataset.mode;
  if (!runId) return;
  $('#committeeOut').innerHTML = '<div class="card empty">正在综合决策包…</div>';
  // 取回完整 run，判断是否含模拟 agent —— 用于「基于模拟 trace」告警。
  const [{ run }, { review, error }] = await Promise.all([
    api(`/api/runs/${encodeURIComponent(runId)}`),
    api('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, mode }) }),
  ]);
  if (error) { $('#committeeOut').innerHTML = `<div class="card empty" role="alert">${esc(error)}</div>`; return; }
  const simmy = !run || run.mode === 'sim' || (run.agents || []).some((a) => a.mode === 'sim');
  renderReview(review, mode, simmy);
}
function renderReview(r, mode, isSim) {
  const list = mode === 'intersection' ? r.consensus : r.union;
  const listTitle = mode === 'intersection' ? `共同主张 (${r.consensus.length})` : `全部观点 (${r.union.length})`;
  const listHtml = list.length ? list.map((c) => `
    <div class="consensus-item">${esc(c.text)} <span class="cov">· ${c.coverage} 个视角${c.unique ? ' · 仅此视角提出' : ''}</span></div>`).join('')
    : '<div class="empty">无</div>';

  const divHtml = r.divergence.length ? r.divergence.map((d) => `<div class="div-item">${esc(d.text)} <span class="cov">· 来自 ${esc(d.by)}</span></div>`).join('') : '<div class="empty">无显著分歧</div>';

  const attrHtml = r.attribution.map((a) => `
    <div class="attr ${esc(a.weight)}"><span class="k">${esc(a.kind)}</span><span class="w">${esc(a.weight)}</span><div style="color:var(--muted);margin-top:3px">${esc(a.detail)}</div></div>`).join('');

  // H4：基于模拟 trace 的免责告警
  const simBanner = isSim
    ? `<div class="card warn" role="note"><b>本次评审基于模拟 trace。</b>步骤/工具/token 等数字由模板生成，归因仅演示算法形态，<b>不代表真实模型行为</b>。接入 API key 后切换 Live 才会基于真实执行 trace 评审。</div><div style="height:16px"></div>`
    : '';
  // H5：sim 下分歧来自固定模板差异化句式，不存在「幻觉」，故切换中性文案
  const divHint = isSim
    ? '仅单一视角提出；Sim 模式下这些来自固定模板，只用于演示流程'
    : '仅单一视角提出；它可能是关键少数意见，也可能缺乏依据，不能因人数少而直接丢弃';
  const attrHint = isSim
    ? '结合 trace 解释「为什么会不同」（注意：基于模拟 trace，仅示意算法形态）'
    : '结合 trace 解释「为什么会不同」';

  // U3：更优解 Markdown 存入全局，供「复制」按钮取用
  STATE.betterMd = r.betterSolution.markdown;
  const synth = r.betterSolution.synthesis;
  const synthHint = synth?.mode === 'live'
    ? `由真实评审团主席综合 · ${esc(synth.channel)}`
    : synth?.mode === 'error'
      ? `真实综合失败：${esc(synth.error)}；当前显示规则式综合`
      : '规则式综合；Live run 会调用真实评审团主席';

  $('#committeeOut').innerHTML = `
    ${simBanner}
    <div class="card decision-package">
      <div class="section-head"><h2 class="section">最终决策包</h2><button class="btn sm copy" id="copyBetter">复制 Markdown</button></div>
      <p class="section-hint">${synthHint}</p>
      <div class="markdown">${renderMarkdown(r.betterSolution.markdown)}</div>
    </div>
    <div style="height:16px"></div>
    <div class="two-col">
      <div class="card">
        <h2 class="section">${esc(listTitle)}</h2>
        <p class="section-hint">${mode === 'intersection' ? '多个视角都提出的主张；共同出现不等于事实正确' : '去重后的全部观点，包含少数但可能关键的意见'}</p>
        ${listHtml}
      </div>
      <div class="card">
        <h2 class="section">少数观点与盲区 (${r.divergence.length})</h2>
        <p class="section-hint">${divHint}</p>
        ${divHtml}
      </div>
    </div>
    <div style="height:16px"></div>
    <div class="card">
      <h2 class="section">为什么视角会不同</h2>
      <p class="section-hint">${attrHint}</p>
      ${attrHtml}
    </div>`;
  const cb = $('#copyBetter');
  if (cb) cb.addEventListener('click', () => copyToClipboard(STATE.betterMd, cb));
}

// U3：零依赖复制（带按钮反馈）
function copyToClipboard(text, btn) {
  const done = () => { const old = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = old; }, 1400); };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  document.body.removeChild(ta);
}

// ───────── Trace 对比 ─────────
$('#traceRun').addEventListener('change', onTraceRunChange);
$('#traceA').addEventListener('change', validateTracePair);
$('#traceB').addEventListener('change', validateTracePair);
$('#traceBtn').addEventListener('click', doTraceDiff);
async function onTraceRunChange() {
  const runId = $('#traceRun')?.value; if (!runId) return;
  const { run } = await api(`/api/runs/${encodeURIComponent(runId)}`);
  if (!run) return;
  // U5：option 文案补 framework × model，便于辨认
  const opts = run.agents.map((a) => `<option value="${esc(a.agentId)}">${esc(a.label || (fwName(a.framework) + ' · ' + a.model))} · ${esc(fwName(a.framework))}×${esc(a.model)}</option>`).join('');
  $('#traceA').innerHTML = opts; $('#traceB').innerHTML = opts;
  if (run.agents[1]) $('#traceB').value = run.agents[1].agentId;
  STATE.traceRun = run;
  // U5：单 agent run 无法对比 → 禁用按钮并就地提示
  const single = run.agents.length < 2;
  if (single) {
    $('#traceOut').innerHTML = '<div class="card empty">该 run 只有 1 个 agent，Trace 对比需要 ≥ 2 个 agent。请回运行台加一个 agent 重跑。</div>';
  }
  validateTracePair();
}
function validateTracePair() {
  const run = STATE.traceRun;
  const btn = $('#traceBtn');
  const a = $('#traceA').value, b = $('#traceB').value;
  const bad = !run || run.agents.length < 2 || !a || a === b;
  btn.disabled = bad;
  btn.title = (run && run.agents.length < 2) ? '需要 ≥ 2 个 agent' : (a && a === b ? '请选择两个不同的 agent' : '');
}
async function doTraceDiff() {
  const runId = $('#traceRun').value, a = $('#traceA').value, b = $('#traceB').value;
  if (a === b) { $('#traceOut').innerHTML = '<div class="card empty" role="alert">请选择两个不同的 agent</div>'; return; }
  const { diff, error } = await api(`/api/trace/diff?runId=${encodeURIComponent(runId)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  if (error) { $('#traceOut').innerHTML = `<div class="card empty" role="alert">${esc(error)}</div>`; return; }
  const run = STATE.traceRun;
  const agA = run.agents.find((x) => x.agentId === a), agB = run.agents.find((x) => x.agentId === b);
  const isSim = run.mode === 'sim' || [agA, agB].some((x) => x?.mode === 'sim');
  renderTrace(diff, agA, agB, isSim);
}
function deltaBox(label, v, unit = '', invert = false) {
  const cls = v === 0 ? '' : (v > 0 ? (invert ? 'neg' : 'pos') : (invert ? 'pos' : 'neg'));
  const sign = v > 0 ? '+' : '';
  return `<div class="delta"><span class="cov">${label} 差 (A−B)</span><b class="${cls}">${sign}${v}${unit}</b></div>`;
}
function renderTrace(diff, agA, agB, isSim) {
  const tools = diff.tools;
  const simBanner = isSim
    ? `<div class="card warn" role="note"><b>以下 trace 为模拟数据。</b>步骤、工具、token、耗时均由模板生成，对比仅演示「效果评审」的算法形态，<b>不代表真实模型行为</b>。</div><div style="height:16px"></div>`
    : '';
  // U3：把 trace 结论拼成可复制文本
  const copyText = buildTraceMarkdown(diff, isSim);
  STATE.traceMd = copyText;
  $('#traceOut').innerHTML = `
    ${simBanner}
    <div class="card">
      <div class="section-head"><h2 class="section">过程差异 · ${esc(diff.a.label)} vs ${esc(diff.b.label)}</h2><button class="btn sm copy" id="copyTrace">复制结论</button></div>
      <div class="deltas">
        ${deltaBox('步骤', diff.deltas.steps)}
        ${deltaBox('工具调用', diff.deltas.toolCalls)}
        ${deltaBox('token', diff.deltas.tokens)}
        ${deltaBox('耗时', diff.deltas.wallMs, 'ms')}
      </div>
      <div class="metrics">
        <span>共用工具：<b>${esc(tools.shared.join('、') || '无')}</b></span>
        <span style="color:var(--cyan)">仅 A：<b>${esc(tools.onlyA.join('、') || '无')}</b></span>
        <span style="color:var(--amber)">仅 B：<b>${esc(tools.onlyB.join('、') || '无')}</b></span>
      </div>
      <p class="section-hint" style="margin-top:10px"><span aria-hidden="true">💡</span> 效果评审提示：${esc(traceInsight(diff))}</p>
    </div>
    <div style="height:16px"></div>
    <div class="trace-cmp">
      ${traceColumn(agA)}
      ${traceColumn(agB)}
    </div>`;
  const ct = $('#copyTrace');
  if (ct) ct.addEventListener('click', () => copyToClipboard(STATE.traceMd, ct));
}
function buildTraceMarkdown(diff, isSim) {
  const L = [];
  L.push(`# Trace 对比：${diff.a.label} vs ${diff.b.label}`);
  if (isSim) L.push('> ⚠️ 模拟数据，非真实模型行为。');
  L.push('');
  L.push('## 过程差异 (A − B)');
  L.push(`- 步骤：${diff.deltas.steps}`);
  L.push(`- 工具调用：${diff.deltas.toolCalls}`);
  L.push(`- token：${diff.deltas.tokens}`);
  L.push(`- 耗时：${diff.deltas.wallMs}ms`);
  L.push('');
  L.push('## 工具集');
  L.push(`- 共用：${diff.tools.shared.join('、') || '无'}`);
  L.push(`- 仅 A：${diff.tools.onlyA.join('、') || '无'}`);
  L.push(`- 仅 B：${diff.tools.onlyB.join('、') || '无'}`);
  L.push('');
  L.push('## 效果评审提示');
  L.push(traceInsight(diff));
  return L.join('\n');
}
function traceInsight(diff) {
  const out = [];
  if (diff.tools.onlyA.length || diff.tools.onlyB.length) out.push('两者调用的工具集不同，事实来源就不同——结论分歧大概率源于此，应信「有据可查」的一方。');
  if (Math.abs(diff.deltas.steps) >= 2) out.push(`步骤数差 ${Math.abs(diff.deltas.steps)}，步数多的一方更可能做了自我验证（更稳但更贵）。`);
  if (Math.abs(diff.deltas.tokens) >= 200) out.push(`token 差 ${Math.abs(diff.deltas.tokens)}，注意性价比。`);
  return out.join(' ') || '两者过程相近，差异更可能来自模型本身而非执行路径。';
}
function traceColumn(a) {
  const steps = a.trace?.steps || [];
  const src = a.trace?.source;
  return `<div class="card">
    <div class="head" style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span class="fw-tag">${esc(fwName(a.framework))}</span><span class="model">${esc(a.model)}</span></div>
    ${src ? `<span class="trace-badge" style="background:${STATE.traceMeta[src.traceability]?.color}">trace: ${esc(STATE.traceMeta[src.traceability]?.label)}</span><div class="cov" style="margin-top:4px">${esc(src.how)}</div>` : ''}
    <ul class="tl">${steps.map((s) => `
      <li><span class="ico ${esc(s.type)}" role="img" aria-label="${esc(STEP_LABEL[s.type] || s.type)}"><span aria-hidden="true">${stepIcon(s.type)}</span></span>
        <span class="lab">${esc(s.label)}${s.detail ? `<div class="cov">${esc(s.detail)}</div>` : ''}</span>
        <span class="meta">${s.tokens ? esc(s.tokens + 't') : ''} ${s.ms ? esc(s.ms + 'ms') : ''}</span></li>`).join('')}</ul>
  </div>`;
}
const STEP_LABEL = { think: '思考', tool: '工具调用', observe: '观察', message: '消息', error: '错误', handoff: '交接' };
function stepIcon(t) { return { think: '🧠', tool: '🔧', observe: '👁', message: '✦', error: '!', handoff: '↔' }[t] || '·'; }

// ───────── 框架图鉴 ─────────
function renderFrameworks() {
  // 矩阵
  const cols = STATE.matrixCols;
  const head = `<thead><tr><th scope="col">框架</th>${cols.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const rows = STATE.frameworks.map((f) => `<tr>
    <th scope="row" style="font-weight:inherit"><b>${esc(f.name)}</b><div class="vendor">${esc(f.vendor)}</div></th>
    ${cols.map((c) => {
      if (c.key === 'traceability') { const m = STATE.traceMeta[f.traceability]; return `<td><span class="trace-badge" style="background:${m.color}">${esc(m.label)}</span></td>`; }
      return `<td>${esc(f[c.key])}</td>`;
    }).join('')}
  </tr>`).join('');
  $('#matrix').innerHTML = head + `<tbody>${rows}</tbody>`;

  // 卡片
  $('#fwGrid').innerHTML = STATE.frameworks.map((f) => {
    const m = STATE.traceMeta[f.traceability];
    return `<div class="fw-card">
      <div class="title"><b>${esc(f.name)}</b><span class="vendor">${esc(f.vendor)} · ${esc(f.kind)}</span></div>
      <span class="trace-badge" style="background:${m.color};align-self:flex-start">trace 可得性：${esc(m.label)}</span>
      <div class="cov">${esc(f.traceNote)}</div>
      <div class="kv">
        <span class="k">范式</span><span>${esc(f.paradigm)}</span>
        <span class="k">多 agent</span><span>${esc(f.multiAgent)}</span>
        <span class="k">状态</span><span>${esc(f.state)}</span>
        <span class="k">工具调用</span><span>${esc(f.toolCalling)}</span>
        <span class="k">语言</span><span>${esc(f.language.join(' / '))}</span>
      </div>
      <div>
        <div class="cov" style="color:var(--green)">✓ ${f.strengths.map(esc).join(' · ')}</div>
        <div class="cov" style="color:var(--red)">△ ${f.weaknesses.map(esc).join(' · ')}</div>
      </div>
      <pre class="code">${highlightCode(f.code)}</pre>
    </div>`;
  }).join('');
}

// ───────── tiny markdown + code highlight ─────────
function renderMarkdown(md) {
  const lines = md.split('\n'); let html = '', list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i style="color:var(--muted)">$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\|.*\|$/.test(ln) && /^\|?[\s:|-]+\|?$/.test(lines[i + 1] || '') && cells(lines[i + 1]).every((x) => /^:?-{3,}:?$/.test(x))) {
      closeList();
      const head = cells(ln);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      i--;
      html += `<div class="md-table-wrap"><table><thead><tr>${head.map((x) => `<th>${inline(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((x) => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (/^### /.test(ln)) { closeList(); html += `<h3>${inline(ln.slice(4))}</h3>`; }
    else if (/^## /.test(ln)) { closeList(); html += `<h2>${inline(ln.slice(3))}</h2>`; }
    else if (/^> /.test(ln)) { closeList(); html += `<blockquote>${inline(ln.slice(2))}</blockquote>`; }
    else if (/^- /.test(ln)) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(ln.slice(2))}</li>`; }
    else if (/^\d+\.\s/.test(ln)) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(ln.replace(/^\d+\.\s+/, ''))}</li>`; }
    else if (ln.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${inline(ln)}</p>`; }
  }
  closeList();
  return html;
}
function highlightCode(code) {
  return esc(code).replace(/(#.*|\/\/.*)/g, '<span class="cm">$1</span>');
}
