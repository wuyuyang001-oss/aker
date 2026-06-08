// committee.cluster.test.mjs — 回归测试：固定评审会聚类的当前行为边界
//
// 这些断言刻意把「当前（字面相似度）聚类」的行为钉死，包括它的已知缺陷：
//   - 逐字相同的要点会聚成共识（Sim 模板正是靠这点制造「看起来能用」的共识）；
//   - 中文同义改写因词面几乎不重叠而 **不会** 聚合，被误判为分歧。
// 缺陷断言（synonym 用例）写的是「当前行为」。未来若换成语义 embedding 聚类，
// 这条断言会失败 —— 那是预期的红灯，提示你把断言翻转过来。
//
// 跑法：node test/committee.cluster.test.mjs    （零依赖，node:assert）

import assert from 'node:assert/strict';
import { review, splitPoints } from '../src/committee.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

function agent(id, framework, model, output) {
  return { agentId: id, framework, model, status: 'done', output, trace: { steps: [] } };
}

console.log('committee 聚类回归测试');

// 1) splitPoints 签名与基本切分不变（硬性要求：签名稳定）
test('splitPoints 把多行/多句文本切成要点，过滤过短片段', () => {
  const pts = splitPoints('## 关键建议\n1. 先明确边界条件。\n2. 解耦核心逻辑与 I/O。\n短');
  assert.ok(pts.length >= 2, `期望 >=2 个要点，实得 ${pts.length}`);
  assert.ok(!pts.includes('## 关键建议'), 'Markdown 章节标题不应作为可聚类要点');
  // 列表前缀被剥掉
  assert.ok(!pts[0].startsWith('1.'), '应剥掉列表序号前缀');
  // 过短片段（< 4 字）被过滤
  assert.ok(!pts.includes('短'), '过短片段应被过滤');
});

// 2) 逐字相同的要点会聚成共识 —— Sim 模板「自证循环」的根因，钉死它
test('逐字相同的要点 → 聚成 1 条共识（Sim 模板共识由此而来）', () => {
  const shared = '先明确输入输出与边界条件，再动手实现。';
  const run = {
    agents: [
      agent('a1', 'claude-code', 'claude-opus-4-8', shared),
      agent('a2', 'codex-cli', 'gpt-x', shared),
      agent('a3', 'hermes', 'hermes-3', shared),
    ],
  };
  const r = review(run, 'intersection');
  assert.equal(r.consensus.length, 1, `期望 1 条共识，实得 ${r.consensus.length}`);
  assert.equal(r.consensus[0].coverage, 3, '该共识应被 3 个 agent 覆盖');
});

// 3) 中文同义改写 *不会* 聚合 —— 当前字面相似度聚类的已知缺陷，断言「当前行为」
//    若将来接入语义 embedding 聚类，本用例会失败，提示把期望翻转为 consensus>=1。
test('中文同义改写 → 当前不聚合（缺陷边界，换 embedding 后应翻转）', () => {
  const run = {
    agents: [
      agent('a1', 'claude-code', 'claude-opus-4-8', '应当优先保证系统的稳定性与可靠性。'),
      agent('a2', 'codex-cli', 'gpt-x', '务必把稳固耐用放在第一位来确保运行无虞。'),
    ],
  };
  const r = review(run, 'intersection');
  // 当前行为：两条同义句被判为各自独立 → 0 共识、2 分歧。
  assert.equal(r.consensus.length, 0, `当前字面聚类期望 0 共识，实得 ${r.consensus.length}`);
  assert.equal(r.counts.divergent, 2, `当前期望 2 条分歧，实得 ${r.counts.divergent}`);
});

// 4) review() 的返回形状契约稳定（硬性要求：/api/review 字段不变）
test('review() 返回 consensus/union/divergence/attribution/betterSolution', () => {
  const run = {
    agents: [
      agent('a1', 'claude-code', 'claude-opus-4-8', '解耦核心逻辑与 I/O，便于测试。'),
      agent('a2', 'codex-cli', 'gpt-x', '解耦核心逻辑与 I/O，便于测试。'),
    ],
  };
  const r = review(run, 'union');
  for (const k of ['consensus', 'union', 'divergence', 'attribution', 'betterSolution']) {
    assert.ok(k in r, `返回对象应含字段 ${k}`);
  }
  assert.equal(r.mode, 'union', 'mode 应原样回写');
  assert.ok(typeof r.betterSolution.markdown === 'string', 'betterSolution.markdown 应为字符串');
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : ''}`);
