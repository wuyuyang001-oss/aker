// seed.mjs — 用真实编排器跑一个示例 run 作为初始内容（不是硬编码假数据）
import { runParallel } from '../src/orchestrator.mjs';

export async function buildFixtures() {
  const run = await runParallel({
    task: '实现一个带缓存的并发安全计数器',
    mode: 'sim',
    agents: [
      { framework: 'claude-code', model: 'claude-opus-4-8' },
      { framework: 'codex-cli', model: 'gpt-x' },
      { framework: 'langgraph', model: 'o-series' },
      { framework: 'hermes', model: 'hermes-3' },
    ],
  });
  run.id = 'run_demo'; // 固定 id 便于直链
  run.createdAt = '2026-06-08T00:00:00.000Z';
  return [run];
}
