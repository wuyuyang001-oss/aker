// app.js — aker 前端 (vanilla, 无构建)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = (p, opts) => fetch(p, opts).then((r) => r.json());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let STATE = { frameworks: [], traceMeta: {}, matrixCols: [], mode: 'sim', lastRun: null };

// 模型候选（演示用；Live 模式下按 key 真实可用）
const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-x', 'o-series', 'hermes-3', 'gemini-x'];
const DEFAULT_AGENTS = [
  { framework: 'claude-code', model: 'claude-opus-4-8' },
  { framework: 'codex-cli', model: 'gpt-x' },
  { framework: 'langgraph', model: 'o-series' },
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
  $('#modedot').classList.toggle('on', health.live);
  $('#modetext').textContent = health.live ? 'Live 可用' : 'Sim 模式（无 API key）';
  $('#modepill').title = health.note || '';
  renderAgentRows(DEFAULT_AGENTS);
  renderFrameworks();
  bindRunControls();
  // 评审会 / Trace 首屏空态引导（U2）
  $('#committeeOut').innerHTML = '<div class="card empty">选择一个 run 并点击「评审」，查看交集/并集、差异归因与更优解。</div>';
  $('#traceOut').innerHTML = '<div class="card empty">选择一个 run 与两个 agent，点击「对比」，查看过程差异与效果评审。</div>';
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
function fwOptions(sel) { return STATE.frameworks.map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join(''); }
function modelOptions(sel) { return MODELS.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${m}</option>`).join(''); }

function renderAgentRows(agents) {
  $('#agentRows').innerHTML = agents.map((a, i) => `
    <div class="agent-row" data-i="${i}">
      <select class="fw" aria-label="第 ${i + 1} 个 agent 的框架">${fwOptions(a.framework)}</select>
      <select class="ml" aria-label="第 ${i + 1} 个 agent 的模型">${modelOptions(a.model)}</select>
      <button class="icon-btn rm" title="移除该 agent" aria-label="移除第 ${i + 1} 个 agent"><span aria-hidden="true">×</span></button>
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
    if (b.disabled) return; // 无 key 时 Live 不可选（U1）
    $$('#modeSeg button').forEach((x) => x.classList.toggle('active', x === b)); STATE.mode = b.dataset.mode;
  }));
  $('#runBtn').addEventListener('click', submitRun);
  // Cmd/Ctrl + Enter 提交（X8）
  $('#task').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitRun(); }
  });
}

async function submitRun() {
  const task = $('#task').value.trim();
  const agents = collectAgents();
  if (!task || !agents.length) return;
  const btn = $('#runBtn'); btn.disabled = true; btn.textContent = '运行中…'; btn.setAttribute('aria-busy', 'true');
  // 先渲染 running 占位卡
  $('#results').innerHTML = agents.map((a, i) => agentCardShell(a, i)).join('');
  // 等待期计时指示（U4：真正逐个流式落地需后端 SSE，记入 CRITICISMS.md）
  const t0 = Date.now();
  const hint = STATE.mode === 'live' ? ' · Live 模式下单个 agent 可能需要数十秒' : '';
  const tick = () => {
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    $('#runStatus').innerHTML = `<div class="card"><div class="metrics"><span class="spin" aria-hidden="true"></span><span>并行运行中 <b>${s}s</b> · 派发 <b>${agents.length}</b> 个 agent · 模式 <b>${esc(STATE.mode)}</b>${hint}</span></div></div>`;
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
    const simNote = run.mode === 'sim' ? ' · <b>Sim 模拟数据</b>（非真实模型）' : '';
    $('#runStatus').innerHTML = `<div class="card"><div class="metrics"><span class="status done" role="img" aria-label="已完成"></span><span>完成 · 用时 <b>${dur}s</b> · run <b>${esc(run.id)}</b>${simNote} · 已存档，可在「评审会 / Trace」中调用</span></div></div>`;
    refreshRunPickers(run.id);
  } catch (e) {
    clearInterval(timer);
    $('#runStatus').innerHTML = `<div class="card warn" role="alert"><span style="color:var(--red)">运行失败：${esc(e.message)}</span></div>`;
  } finally { clearInterval(timer); btn.disabled = false; btn.textContent = '▶ 并行运行'; btn.removeAttribute('aria-busy'); }
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
  // H1/H7：sim（含 Live 降级回退）一律强制标记「模拟数据」，指标加 ~ 前缀 + 弱化 + title
  const modePill = isSim
    ? '<span class="pill sim" title="本卡所有指标为模板生成的模拟值，非真实测量">SIMULATED · 模拟数据</span>'
    : '<span class="pill" title="真实调用模型">live</span>';
  const mcls = isSim ? 'metric-sim' : '';
  const mtitle = isSim ? ' title="模拟值，非真实测量"' : '';
  const pfx = isSim ? '~' : '';
  // H7：降级 note 从一行小字升级为卡片级告警横幅
  const banner = a.note ? `<div class="card-banner warn" role="note">${esc(a.note)}</div>` : '';
  return `<div class="agent-card${isSim ? ' is-sim' : ''}">
    ${banner}
    <div class="head">${statusDot(a.status)}<span class="fw-tag">${esc(fwName(a.framework))}</span><span class="model">${esc(a.model)}</span>${modePill}</div>
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

// ───────── run pickers (评审会 / trace 共用) ─────────
async function refreshRunPickers(selectId) {
  const { runs } = await api('/api/runs');
  const opts = runs.map((r) => {
    const tag = r.mode === 'sim' ? ' · [Sim]' : ' · [Live]';
    return `<option value="${esc(r.id)}">${esc(r.task.slice(0, 28))} · ${r.agentCount}agent${tag}</option>`;
  }).join('');
  for (const sel of ['#reviewRun', '#traceRun']) { const el = $(sel); if (el) { el.innerHTML = opts; if (selectId) el.value = selectId; } }
  await onTraceRunChange();
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
  // 取回完整 run，判断是否含模拟 / 降级 agent —— 用于「基于模拟 trace」告警（H4/H5）
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
  const listTitle = mode === 'intersection' ? `共识 / 交集 (${r.consensus.length})` : `全集 / 并集 (${r.union.length})`;
  const listHtml = list.length ? list.map((c) => `
    <div class="consensus-item">${esc(c.text)} <span class="cov">· ${c.coverage} agent${c.unique ? ' · 仅此一家' : ''}</span></div>`).join('')
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
    ? '仅单一 agent 提出 —— Sim 模式下这些来自模板的固定差异化句式（既非洞见也非幻觉）'
    : '仅单一 agent 提出 —— 可能是独到洞见，也可能是无依据发挥';
  const attrHint = isSim
    ? '结合 trace 解释「为什么会不同」（注意：基于模拟 trace，仅示意算法形态）'
    : '结合 trace 解释「为什么会不同」';

  // U3：更优解 Markdown 存入全局，供「复制」按钮取用
  STATE.betterMd = r.betterSolution.markdown;

  $('#committeeOut').innerHTML = `
    ${simBanner}
    <div class="two-col">
      <div class="card">
        <h2 class="section">${esc(listTitle)}</h2>
        <p class="section-hint">${mode === 'intersection' ? '多数 agent 一致认可的要点，可信度最高' : '去重后的全部要点，含仅单一 agent 提出的'}</p>
        ${listHtml}
      </div>
      <div class="card">
        <h2 class="section">分歧点 (${r.divergence.length})</h2>
        <p class="section-hint">${divHint}</p>
        ${divHtml}
      </div>
    </div>
    <div style="height:16px"></div>
    <div class="two-col">
      <div class="card">
        <h2 class="section">差异归因</h2>
        <p class="section-hint">${attrHint}</p>
        ${attrHtml}
      </div>
      <div class="card">
        <div class="section-head"><h2 class="section">更优解</h2><button class="btn sm copy" id="copyBetter">复制 Markdown</button></div>
        <p class="section-hint">评审会综合共识 + 高可信度独有洞见</p>
        <div class="markdown">${renderMarkdown(r.betterSolution.markdown)}</div>
      </div>
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
