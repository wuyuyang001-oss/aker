import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AKER_DATA_DIR || join(__dirname, '..', 'data');
const SETTINGS_FILE = join(DATA_DIR, 'connections.json');
const KEYCHAIN_SERVICE = 'com.aker.desktop.api';

const CLI_DEFS = [
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    command: 'codex',
    extraPaths: ['/Applications/Codex.app/Contents/Resources/codex', join(homedir(), '.local', 'bin', 'codex')],
    versionArgs: ['--version'],
    capabilities: ['web-search', 'read-only-tools', 'json-event-trace', 'judge'],
  },
  {
    id: 'claude-cli',
    label: 'Claude Code',
    command: 'claude',
    extraPaths: [join(homedir(), '.local', 'bin', 'claude')],
    versionArgs: ['--version'],
    capabilities: ['answer', 'limited-trace', 'judge'],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    command: 'gemini',
    extraPaths: [join(homedir(), '.local', 'bin', 'gemini')],
    versionArgs: ['--version'],
    capabilities: ['answer', 'limited-trace', 'judge'],
  },
  {
    id: 'aider',
    label: 'Aider',
    command: 'aider',
    extraPaths: [join(homedir(), '.local', 'bin', 'aider')],
    versionArgs: ['--version'],
    capabilities: ['coding-agent'],
  },
];

const API_DEFS = [
  { id: 'openai', label: 'OpenAI API', env: 'OPENAI_API_KEY', defaultModel: 'gpt-4.1-mini' },
  { id: 'anthropic', label: 'Anthropic API', env: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-6' },
];

function loadSettings() {
  try { return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')); } catch { return { apis: {} }; }
}

function saveSettings(settings) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, SETTINGS_FILE);
}

function findExecutable(def) {
  const candidates = [
    ...(process.env.PATH || '').split(delimiter).filter(Boolean).map((dir) => join(dir, def.command)),
    ...(def.extraPaths || []),
  ];
  return candidates.find((path) => existsSync(path)) || null;
}

function getVersion(path, args) {
  try { return execFileSync(path, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0]; }
  catch { return null; }
}

function keychainAvailable() {
  return process.platform === 'darwin' && existsSync('/usr/bin/security');
}

function keychainGet(provider) {
  if (!keychainAvailable()) return null;
  const result = spawnSync('/usr/bin/security', ['find-generic-password', '-a', provider, '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function keychainSet(provider, key) {
  if (!keychainAvailable()) throw new Error('当前系统不支持 macOS Keychain；请使用环境变量配置 API key');
  const result = spawnSync('/usr/bin/security', ['add-generic-password', '-U', '-a', provider, '-s', KEYCHAIN_SERVICE, '-w', key], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || '无法写入 macOS Keychain');
}

function keychainDelete(provider) {
  if (!keychainAvailable()) return;
  spawnSync('/usr/bin/security', ['delete-generic-password', '-a', provider, '-s', KEYCHAIN_SERVICE], { encoding: 'utf8' });
}

export function getApiKey(provider) {
  const def = API_DEFS.find((item) => item.id === provider);
  return (def?.env && process.env[def.env]) || keychainGet(provider) || null;
}

export function getApiModel(provider) {
  const settings = loadSettings();
  const def = API_DEFS.find((item) => item.id === provider);
  return settings.apis?.[provider]?.model || def?.defaultModel || '';
}

export function configureApi({ provider, key, model }) {
  const def = API_DEFS.find((item) => item.id === provider);
  if (!def) throw new Error(`不支持的 API provider：${provider}`);
  if (key) keychainSet(provider, String(key).trim());
  const settings = loadSettings();
  settings.apis ||= {};
  settings.apis[provider] = { ...(settings.apis[provider] || {}), model: String(model || def.defaultModel).trim(), updatedAt: new Date().toISOString() };
  saveSettings(settings);
  return listConnections();
}

export function removeApi(provider) {
  keychainDelete(provider);
  const settings = loadSettings();
  if (settings.apis) delete settings.apis[provider];
  saveSettings(settings);
  return listConnections();
}

export function listConnections() {
  const settings = loadSettings();
  const cli = CLI_DEFS.map((def) => {
    const path = findExecutable(def);
    return {
      id: def.id,
      type: 'cli',
      label: def.label,
      detected: !!path,
      path,
      version: path ? getVersion(path, def.versionArgs) : null,
      capabilities: def.capabilities,
      runnable: ['codex-cli', 'claude-cli', 'gemini-cli'].includes(def.id) && !!path,
      note: def.id === 'codex-cli' && path ? '已实现只读搜索与 JSONL Trace' : ['claude-cli', 'gemini-cli'].includes(def.id) && path ? '已实现只读回答适配器；搜索能力取决于通道配置' : path ? '已检测到；暂无通用任务适配器' : '未检测到',
    };
  });
  const api = API_DEFS.map((def) => {
    const configured = !!getApiKey(def.id);
    return {
      id: def.id,
      type: 'api',
      label: def.label,
      configured,
      model: settings.apis?.[def.id]?.model || def.defaultModel,
      secretStore: process.env[def.env] ? 'environment' : configured ? 'macOS Keychain' : null,
      runnable: configured,
      capabilities: ['answer', 'judge', 'no-built-in-search'],
      note: configured ? '已配置；实际调用仍取决于额度、权限与网络' : '未配置',
    };
  });
  return { cli, api, keychain: keychainAvailable() };
}

export async function testConnection(id) {
  const connections = listConnections();
  const cli = connections.cli.find((item) => item.id === id);
  if (cli) return { ok: cli.detected, id, message: cli.detected ? `${cli.label} ${cli.version || '已检测到'}` : `${cli.label} 未检测到` };
  const api = connections.api.find((item) => item.id === id);
  if (!api?.configured) return { ok: false, id, message: `${api?.label || id} 未配置` };

  const key = getApiKey(id);
  const url = id === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models';
  const headers = id === 'openai'
    ? { authorization: `Bearer ${key}` }
    : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    return { ok: response.ok, id, message: response.ok ? `${api.label} 连接正常` : `${api.label} 返回 HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, id, message: `${api.label} 连接失败：${String(error?.message || error)}` };
  }
}
