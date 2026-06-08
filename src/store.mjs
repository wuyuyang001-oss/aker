// store.mjs — 极简持久化（JSON 文件），保存所有 run，供回放/评审。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 数据目录可被环境变量覆盖：Electron 打包后 app 目录只读，main 进程会指向系统 userData。
const DB_DIR = process.env.AKER_DATA_DIR || join(__dirname, '..', 'data');
const DB = join(DB_DIR, 'runs.json');

let cache = null;
function load() {
  if (cache) return cache;
  if (existsSync(DB)) {
    try {
      cache = JSON.parse(readFileSync(DB, 'utf8'));
    } catch (e) {
      // ST1：解析失败不再静默当空库（会让历史 run 无声消失）。
      // 先把坏文件备份成 .bak 并打错误日志，再退回空库，给人留追查 / 手工恢复的机会。
      try { copyFileSync(DB, DB + '.bak'); } catch { /* 备份失败也别阻塞启动 */ }
      console.error(`[store] 解析 ${DB} 失败：${e.message}；已备份为 ${DB}.bak，本次以空库启动。`);
      cache = { runs: [] };
    }
  } else cache = { runs: [] };
  return cache;
}
function persist() {
  mkdirSync(DB_DIR, { recursive: true });
  // ST1：原子写——先写临时文件再 rename（同分区 rename 原子），避免崩溃留下截断的半个 JSON。
  const tmp = DB + '.tmp';
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, DB);
}

export function saveRun(run) {
  const db = load();
  const idx = db.runs.findIndex((r) => r.id === run.id);
  if (idx >= 0) db.runs[idx] = run; else db.runs.unshift(run);
  persist();
  return run;
}
export function getRun(id) { return load().runs.find((r) => r.id === id) || null; }
export function listRuns() { return load().runs.map(({ id, task, createdAt, mode, agents }) => ({ id, task, createdAt, mode, agentCount: agents.length })); }

export function seedIfEmpty(runs) {
  const db = load();
  if (db.runs.length === 0) { db.runs = runs; persist(); }
}
