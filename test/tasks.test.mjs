import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTask, createTask, researchCompletion, taskPrompt } from '../src/tasks.mjs';
import { evaluateTask } from '../src/evaluator.mjs';
import { validateAgentManifest } from '../src/runners.mjs';
import { makeStep } from '../src/trace.mjs';

test('research and freshness tasks automatically require evidence', () => {
  assert.equal(classifyTask('调研最新的开源 Agent').evidencePolicy, 'required');
  assert.equal(classifyTask('分析一个抽象产品构想').evidencePolicy, 'preferred');
  const task = createTask({ message: '调研 DeerFlow 2.0 的最新能力', mode: 'sim' });
  assert.equal(task.brief.evidencePolicy, 'required');
  assert.match(taskPrompt(task), /必须实际搜索或读取来源/);
  assert.doesNotMatch(taskPrompt(task), /不要.*调用工具/);
});

test('research answer without search or sources is incomplete and excluded from fusion', async () => {
  const task = createTask({ message: '调研最新的研究 Agent', mode: 'sim' });
  task.runs = [
    {
      runnerId: 'no-search',
      label: 'No Search',
      status: 'done',
      output: 'A confident answer with no evidence.',
      trace: { steps: [makeStep(0, 'message', 'answer')] },
    },
    {
      runnerId: 'with-search',
      label: 'With Search',
      status: 'done',
      output: 'A sourced answer.',
      trace: { steps: [makeStep(0, 'search', 'search'), makeStep(1, 'source', 'source', { url: 'https://example.com' })] },
    },
  ];
  assert.equal(researchCompletion(task.runs[0], task).complete, false);
  assert.equal(researchCompletion(task.runs[1], task).complete, true);
  task.judgeRunnerId = null;
  await evaluateTask(task);
  assert.deepEqual(task.evaluation.eligibleRunnerIds, ['with-search']);
  assert.match(task.finalAnswer, /No Search：0|No Search/);
  assert.match(task.finalAnswer, /https:\/\/example.com/);
});

test('GitHub agent manifest rejects invalid transports and accepts LangGraph SSE', () => {
  assert.throws(() => validateAgentManifest({ id: 'bad', capabilities: {} }), /transport.type/);
  assert.equal(validateAgentManifest({
    id: 'good',
    transport: { type: 'langgraph-sse' },
    capabilities: { search: true },
  }).id, 'good');
});
