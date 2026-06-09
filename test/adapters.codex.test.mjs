import assert from 'node:assert/strict';
import test from 'node:test';
import { codexExecArgs, normalizeDeerFlowEvent, parseCodexEvents } from '../src/adapters.mjs';

test('parseCodexEvents extracts the final answer, usage, and real event steps', () => {
  const input = [
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'pwd', exit_code: 0 } }),
    JSON.stringify({ type: 'error', message: 'temporary reconnect' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'final answer' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }),
  ].join('\n');

  const parsed = parseCodexEvents(input, 1234);
  assert.equal(parsed.output, 'final answer');
  assert.deepEqual(parsed.usage, { input_tokens: 100, output_tokens: 20 });
  assert.deepEqual(parsed.steps.map((s) => s.type), ['plan', 'tool', 'error', 'message']);
  assert.deepEqual(parsed.errors, ['temporary reconnect']);
  assert.equal(parsed.steps.at(-1).tokens, 120);
  assert.equal(parsed.steps.at(-1).ms, 1234);
});

test('Codex search and source events become observable research traces', () => {
  const input = [
    JSON.stringify({ type: 'item.completed', item: { type: 'web_search', query: 'DeerFlow 2.0' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'citation', url: 'https://github.com/bytedance/deer-flow' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }),
  ].join('\n');
  const parsed = parseCodexEvents(input);
  assert.deepEqual(parsed.steps.map((step) => step.type), ['search', 'source', 'message']);
});

test('Codex research runner always enables search and read-only sandbox', () => {
  const args = codexExecArgs('codex-default', '/tmp/aker-test');
  assert.deepEqual(args.slice(0, 6), ['--search', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check']);
  assert.ok(!args.includes('workspace-write'));
});

test('DeerFlow SSE events map search, tools, subagents, sources, and errors', () => {
  const events = [
    normalizeDeerFlowEvent('search_started', { query: 'agent research' }, 0),
    normalizeDeerFlowEvent('tool_call', { name: 'web_search' }, 1),
    normalizeDeerFlowEvent('subagent_started', { name: 'researcher' }, 2),
    normalizeDeerFlowEvent('source', { url: 'https://example.com' }, 3),
    normalizeDeerFlowEvent('error', { message: '403' }, 4),
  ];
  assert.deepEqual(events.map((step) => step.type), ['search', 'tool', 'subagent', 'source', 'error']);
});
