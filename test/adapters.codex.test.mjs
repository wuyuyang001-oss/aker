import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexEvents } from '../src/adapters.mjs';

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
  assert.deepEqual(parsed.steps.map((s) => s.type), ['think', 'tool', 'error', 'message']);
  assert.deepEqual(parsed.errors, ['temporary reconnect']);
  assert.equal(parsed.steps.at(-1).tokens, 120);
  assert.equal(parsed.steps.at(-1).ms, 1234);
});
