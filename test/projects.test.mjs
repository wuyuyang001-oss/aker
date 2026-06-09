import assert from 'node:assert/strict';
import test from 'node:test';
import { appendProjectMessage, briefToTask, createProject, deriveBrief, extractSourceLinks, planProject } from '../src/projects.mjs';

test('deriveBrief turns a natural-language question into an editable working brief', () => {
  const brief = deriveBrief('我们是否应该在两周内上线新功能？团队只有 2 名工程师，不能新增预算。');
  assert.match(brief.decision, /是否应该/);
  assert.match(brief.constraints, /两周/);
  assert.match(brief.constraints, /不能新增预算/);
  assert.ok(brief.unknowns);
});

test('project conversation updates the working brief without requiring a form', () => {
  const project = createProject({ message: '是否应该上线新功能？', mode: 'sim' });
  appendProjectMessage(project, '成功标准是至少 5 名客户连续使用。');
  assert.match(project.brief.criteria, /5 名客户/);
  assert.equal(project.messages.at(-1).role, 'assistant');
});

test('planner automatically matches independent roles to available connections', () => {
  const project = createProject({ message: '是否应该上线新功能？', mode: 'live' });
  const plan = planProject(project, {
    liveAgents: [
      { framework: 'codex-cli', model: 'codex-default' },
      { framework: 'openai-agents', model: 'gpt-4.1-mini' },
    ],
  });
  assert.equal(plan.mode, 'live');
  assert.equal(plan.agents.length, 4);
  assert.equal(new Set(plan.agents.map((agent) => `${agent.framework}:${agent.model}`)).size, 2);
});

test('links pasted in conversation become numbered user-provided sources', () => {
  assert.deepEqual(extractSourceLinks('看 https://example.com/a 和 https://example.com/a。'), ['https://example.com/a']);
  const project = createProject({ message: '是否采用这个方案？参考 https://example.com/a。' });
  appendProjectMessage(project, '补充资料：https://example.org/report');
  assert.deepEqual(project.sources.map((source) => source.id), ['S1', 'S2']);
  assert.match(briefToTask(project.brief, project.sources), /\[S1\]/);
});
