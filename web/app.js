// app.js — aker 前端 (vanilla, 无构建)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = (p, opts) => fetch(p, opts).then((r) => r.json());
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let STATE = { frameworks: [], traceMeta: {}, matrixCols: [], mode: 'sim', lastRun: null };

// 模型候选（演示用；Live 模式下按 key 真实可用）
const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-x', 'o-series', 'hermes-3', 'gemini-x'];
const DEFAULT_AGENTS = [
  { framework: 'claude-code', model: 'claude-opus-4-8' },
  { framework: 'codex-cli', model: 'gpt-x' },
  { framework: 'langgraph', model: 'o-series' },
];

// ───────── tabs ─────────
$$('#tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${b.dataset.tab}`));
  if (b.dataset.tab === 'committee' || b.dataset.tab === 'trace') refreshRunPickers();
}));

// ───────── init ─────────
(async function init() {
  const [health, fw] = await Promise.all([api('/api/health'), api('/api/frameworks')]);
  STATE.frameworks = fw.frameworks; STATE.traceMeta = fw.traceabilityMeta; STATE.matrixCols = fw.matrixColumns;
  $('#modedot').classList.toggle('on', health.live);
  $('#modetext').textContent = health.live ? 'Live 可用' : 'Sim 模式';
  $('#modepill').title = health.note;
  renderAgentRows(DEFAULT_AGENTS);
  renderFrameworks();
  bindRunControls();
  refreshRunPickers();
})();

// ───────── 运行台 ─────────
function fwOptions(sel) { return STATE.frameworks.map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join(''); }
function modelOptions(sel) { return MODELS.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${m}</option>`).join(''); }

function renderAgentRows(agents) {
  $('#agentRows').innerHTML = agents.map((a, i) => `
    <div class="agent-row" data-i="${i}">
      <select class="fw">${fwOptions(a.framework)}</select>
      <select class="ml">${modelOptions(a.model)}</select>
      <button class="icon-btn rm" title="移除">×</button>
    </div>`).join('');
  $$('#agentRows .rm').forEach((btn) => btn.addEventListener('click', (e) => {
    const rows = collectAgents(); const i = +e.target.closest('.agent-row').dataset.i;
    rows.splice(i, 1); renderAgentRows(rows.length ? rows : DEFAULT_AGENTS.slice(0, 1));
  }));
}
function collectAgents() {
  return $$('#agentRows .agent-row').map((r) => ({ framework: $('.fw', r).value, model: $('.ml', r).value }));
}
function bindRunControls() {
  $('#addAgent').addEventListener('click', () => renderAgentRows([...collectAgents(), { framework: 'crewai', model: 'gemini-x' }]));
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    $$('#modeSeg button').forEach((x) => x.classList.toggle('active', x === b)); STATE.mode = b.dataset.mode;
  }));
  $('#runBtn').addEventListener('click', submitRun);
}

async function submitRun() {
  const task = $('#task').value.trim();
  const agents = collectAgents();
  if (!task || !agents.length) return;
  const btn = $('#runBtn'); btn.disabled = true; btn.textContent = '运行中…';
  $('#runStatus').innerHTML = `<div class="card"><div class="metrics"><span>并行派发 <b>${agents.length}</b> 个 agent · 模式 <b>${STATE.mode}</b></span></div></div>`;
  // 先渲染 running 占位卡
  $('#results').innerHTML = agents.map((a, i) => agentCardShell(a, i)).join('');
  try {
    const { run, error } = await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, agents, mode: STATE.mode }) });
    if (error) throw new Error(error);
    STATE.lastRun = run;
    $('#results').innerHTML = run.agents.map(agentCard).join('');
    $('#runStatus').innerHTML = `<div class="card"><div class="metrics"><span class="status done"></span><span>完成 · run <b>${run.id}</b> · 已存档，可在「评审会 / Trace」中调用</span></div></div>`;
    refreshRunPickers(run.id);
  } catch (e) {
    $('#runStatus').innerHTML = `<div class="card"><span style="color:var(--red)">运行失败：${esc(e.message)}</span></div>`;
  } finally { btn.disabled = false; btn.textContent = '▶ 并行运行'; }
}

function agentCardShell(a, i) {
  return `<div class="agent-card"><div class="head"><span class="status running"></span><span class="fw-tag">${esc(fwName(a.framework))}</span><span class="model">${esc(a.model)}</span></div><div class="out" style="color:var(--faint)">执行中…</div></div>`;
}
function agentCard(a) {
  const t = a.trace?.totals || {};
  const src = a.trace?.source;
  return `<div class="agent-card">
    <div class="head"><span class="status ${a.status}"></span><span class="fw-tag">${esc(fwName(a.framework))}</span><span class="model">${esc(a.model)}</span>${a.mode === 'live' ? '<span class="pill">live</span>' : ''}</div>
    ${a.note ? `<div class="cov" style="color:var(--amber)">${esc(a.note)}</div>` : ''}
    <div class="out">${esc(a.output || a.error || '')}</div>
    <div class="metrics">
      <span>步骤 <b>${t.steps || 0}</b></span>
      <span>工具 <b>${t.toolCalls || 0}</b></span>
      <span>token <b>${t.tokens || 0}</b></span>
      <span>耗时 <b>${t.wallMs || 0}</b>ms</span>
      ${src ? `<span title="${esc(src.how)}">trace: <b>${esc(STATE.traceMeta[src.traceability]?.label || src.traceability)}</b></span>` : ''}
    </div>
  </div>`;
}
function fwName(id) { return STATE.frameworks.find((f) => f.id === id)?.name || id; }

// ───────── run pickers (评审会 / trace 共用) ─────────
async function refreshRunPickers(selectId) {
  const { runs } = await api('/api/runs');
  const opts = runs.map((r) => `<option value="${r.id}">${esc(r.task.slice(0, 28))} · ${r.agentCount}agent</option>`).join('');
  for (const sel of ['#reviewRun', '#traceRun']) { const el = $(sel); if (el) { el.innerHTML = opts; if (selectId) el.value = selectId; } }
  onTraceRunChange();
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
  $('#committeeOut').innerHTML = '<div class="card empty">评审中…</div>';
  const { review, error } = await api('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, mode }) });
  if (error) { $('#committeeOut').innerHTML = `<div class="card empty">${esc(error)}</div>`; return; }
  renderReview(review, mode);
}
function renderReview(r, mode) {
  const list = mode === 'intersection' ? r.consensus : r.union;
  const listTitle = mode === 'intersection' ? `共识 / 交集 (${r.consensus.length})` : `全集 / 并集 (${r.union.length})`;
  const listHtml = list.length ? list.map((c) => `
    <div class="consensus-item">${esc(c.text)} <span class="cov">· ${c.coverage} agent${c.unique ? ' · 仅此一家' : ''}</span></div>`).join('')
    : '<div class="empty">无</div>';

  const divHtml = r.divergence.length ? r.divergence.map((d) => `<div class="div-item">${esc(d.text)} <span class="cov">· 来自 ${esc(d.by)}</span></div>`).join('') : '<div class="empty">无显著分歧</div>';

  const attrHtml = r.attribution.map((a) => `
    <div class="attr ${a.weight}"><span class="k">${esc(a.kind)}</span><span class="w">${a.weight}</span><div style="color:var(--muted);margin-top:3px">${esc(a.detail)}</div></div>`).join('');

  $('#committeeOut').innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <h2 class="section">${listTitle}</h2>
        <p class="section-hint">${mode === 'intersection' ? '多数 agent 一致认可的要点，可信度最高' : '去重后的全部要点，含仅单一 agent 提出的'}</p>
        ${listHtml}
      </div>
      <div class="card">
        <h2 class="section">分歧点 (${r.divergence.length})</h2>
        <p class="section-hint">仅单一 agent 提出 —— 可能是独到洞见，也可能是无依据发挥</p>
        ${divHtml}
      </div>
    </div>
    <div style="height:16px"></div>
    <div class="two-col">
      <div class="card">
        <h2 class="section">差异归因</h2>
        <p class="section-hint">结合 trace 解释「为什么会不同」</p>
        ${attrHtml}
      </div>
      <div class="card">
        <h2 class="section">更优解</h2>
        <p class="section-hint">评审会综合共识 + 高可信度独有洞见</p>
        <div class="markdown">${renderMarkdown(r.betterSolution.markdown)}</div>
      </div>
    </div>`;
}

// ───────── Trace 对比 ─────────
$('#traceRun').addEventListener('change', onTraceRunChange);
$('#traceBtn').addEventListener('click', doTraceDiff);
async function onTraceRunChange() {
  const runId = $('#traceRun')?.value; if (!runId) return;
  const { run } = await api(`/api/runs/${encodeURIComponent(runId)}`);
  if (!run) return;
  const opts = run.agents.map((a) => `<option value="${a.agentId}">${esc(a.label)}</option>`).join('');
  $('#traceA').innerHTML = opts; $('#traceB').innerHTML = opts;
  if (run.agents[1]) $('#traceB').value = run.agents[1].agentId;
  STATE.traceRun = run;
}
async function doTraceDiff() {
  const runId = $('#traceRun').value, a = $('#traceA').value, b = $('#traceB').value;
  if (a === b) { $('#traceOut').innerHTML = '<div class="card empty">请选择两个不同的 agent</div>'; return; }
  const { diff, error } = await api(`/api/trace/diff?runId=${encodeURIComponent(runId)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  if (error) { $('#traceOut').innerHTML = `<div class="card empty">${esc(error)}</div>`; return; }
  const run = STATE.traceRun;
  const agA = run.agents.find((x) => x.agentId === a), agB = run.agents.find((x) => x.agentId === b);
  renderTrace(diff, agA, agB);
}
function deltaBox(label, v, unit = '', invert = false) {
  const cls = v === 0 ? '' : (v > 0 ? (invert ? 'neg' : 'pos') : (invert ? 'pos' : 'neg'));
  const sign = v > 0 ? '+' : '';
  return `<div class="delta"><span class="cov">${label} 差 (A−B)</span><b class="${cls}">${sign}${v}${unit}</b></div>`;
}
function renderTrace(diff, agA, agB) {
  const tools = diff.tools;
  $('#traceOut').innerHTML = `
    <div class="card">
      <h2 class="section">过程差异 · ${esc(diff.a.label)} vs ${esc(diff.b.label)}</h2>
      <div class="deltas">
        ${deltaBox('步骤', diff.deltas.steps)}
        ${deltaBox('工具调用', diff.deltas.toolCalls)}
        ${deltaBox('token', diff.deltas.tokens)}
        ${deltaBox('耗时', diff.deltas.wallMs, 'ms')}
      </div>
      <div class="metrics">
        <span>共用工具：<b>${tools.shared.join('、') || '无'}</b></span>
        <span style="color:var(--cyan)">仅 A：<b>${tools.onlyA.join('、') || '无'}</b></span>
        <span style="color:var(--amber)">仅 B：<b>${tools.onlyB.join('、') || '无'}</b></span>
      </div>
      <p class="section-hint" style="margin-top:10px">💡 效果评审提示：${traceInsight(diff)}</p>
    </div>
    <div style="height:16px"></div>
    <div class="trace-cmp">
      ${traceColumn(agA)}
      ${traceColumn(agB)}
    </div>`;
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
      <li><span class="ico ${s.type}">${stepIcon(s.type)}</span>
        <span class="lab">${esc(s.label)}${s.detail ? `<div class="cov">${esc(s.detail)}</div>` : ''}</span>
        <span class="meta">${s.tokens ? s.tokens + 't' : ''} ${s.ms ? s.ms + 'ms' : ''}</span></li>`).join('')}</ul>
  </div>`;
}
function stepIcon(t) { return { think: '🧠', tool: '🔧', observe: '👁', message: '✦', error: '!', handoff: '↔' }[t] || '·'; }

// ───────── 框架图鉴 ─────────
function renderFrameworks() {
  // 矩阵
  const cols = STATE.matrixCols;
  const head = `<thead><tr><th>框架</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const rows = STATE.frameworks.map((f) => `<tr>
    <td><b>${esc(f.name)}</b><div class="vendor">${esc(f.vendor)}</div></td>
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
  const lines = md.split('\n'); let html = '', inUl = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i style="color:var(--muted)">$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (const ln of lines) {
    if (/^### /.test(ln)) { if (inUl) { html += '</ul>'; inUl = false; } html += `<h3>${inline(ln.slice(4))}</h3>`; }
    else if (/^## /.test(ln)) { if (inUl) { html += '</ul>'; inUl = false; } html += `<h2>${inline(ln.slice(3))}</h2>`; }
    else if (/^> /.test(ln)) { if (inUl) { html += '</ul>'; inUl = false; } html += `<blockquote>${inline(ln.slice(2))}</blockquote>`; }
    else if (/^- /.test(ln)) { if (!inUl) { html += '<ul>'; inUl = true; } html += `<li>${inline(ln.slice(2))}</li>`; }
    else if (ln.trim() === '') { if (inUl) { html += '</ul>'; inUl = false; } }
    else { if (inUl) { html += '</ul>'; inUl = false; } html += `<p>${inline(ln)}</p>`; }
  }
  if (inUl) html += '</ul>';
  return html;
}
function highlightCode(code) {
  return esc(code).replace(/(#.*|\/\/.*)/g, '<span class="cm">$1</span>');
}
