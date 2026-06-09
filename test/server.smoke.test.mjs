import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('server supports the first-use Sim run and review flow', async (t) => {
  const port = 19000 + (process.pid % 1000);
  const dataDir = mkdtempSync(join(tmpdir(), 'aker-smoke-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), AKER_DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => {
    child.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(health?.ok, true, 'server should become healthy');
  assert.ok(Array.isArray(health.reviewRoles), 'health should expose reviewer roles');
  assert.ok(health.reviewRoles.some((role) => role.id === 'researcher'), 'health should expose an evidence perspective');
  assert.ok(Array.isArray(health.liveAgents), 'health should expose actual live runners');

  const runResponse = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: '## 决策问题\n是否应该在两周内上线功能？\n\n## 关键未知项\n用户是否会持续使用。',
      mode: 'sim',
      agents: [
        { role: 'strategist', framework: 'claude-code', model: 'claude-opus-4-8' },
        { role: 'critic', framework: 'codex-cli', model: 'gpt-x' },
      ],
    }),
  });
  const { run } = await runResponse.json();
  assert.equal(run.agents.length, 2);
  assert.equal(run.agents[0].role, 'strategist');

  const reviewResponse = await fetch(`${base}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: run.id, mode: 'intersection' }),
  });
  const payload = await reviewResponse.json();
  assert.ok(Array.isArray(payload.review.consensus));
  assert.equal(typeof payload.review.betterSolution.markdown, 'string');
  for (const heading of ['## 建议与置信度', '## 最强反对意见', '## 最低成本验证', '## 立即行动']) {
    assert.ok(payload.review.betterSolution.markdown.includes(heading), `decision package should include ${heading}`);
  }
});
