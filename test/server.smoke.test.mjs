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
  assert.ok(health.connections?.cli?.some((item) => item.id === 'codex-cli'), 'health should expose detected CLI connections');

  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: '我们是否应该在两周内上线新功能？团队只有 2 名工程师。',
      mode: 'sim',
    }),
  });
  const { project } = await projectResponse.json();
  assert.equal(project.status, 'ready');
  assert.match(project.brief.constraints, /两周|2 名工程师/);

  const exploreResponse = await fetch(`${base}/api/projects/${project.id}/explore`, { method: 'POST' });
  const events = (await exploreResponse.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.type === 'event' && event.event.type === 'committee_update'), 'explore stream should expose ongoing committee review');
  const completedProject = events.find((event) => event.type === 'complete')?.project;
  assert.equal(completedProject?.status, 'complete');
  assert.match(completedProject?.decisionPackage || '', /## 建议与置信度/);

  const branchResponse = await fetch(`${base}/api/projects/${project.id}/branches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claim: '应先做小规模试点' }),
  });
  const { project: branch } = await branchResponse.json();
  assert.equal(branch.parentId, project.id);

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
