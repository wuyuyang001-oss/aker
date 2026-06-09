import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_SOURCE_BYTES = 600_000;
const MAX_REDIRECTS = 3;

function privateIp(address) {
  if (!isIP(address)) return true;
  if (address === '::1' || address === '0.0.0.0' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  if (address.startsWith('127.') || address.startsWith('10.') || address.startsWith('169.254.') || address.startsWith('192.168.')) return true;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

async function assertPublicUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持公开 HTTP/HTTPS 来源');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('不读取本机或内网地址');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error('不读取本机或内网地址');
  return url;
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SOURCE_BYTES) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlSummary(html) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const text = decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return { title, excerpt: text.slice(0, 3000) };
}

async function fetchSource(url, redirects = 0) {
  const target = await assertPublicUrl(url);
  const response = await fetch(target, {
    redirect: 'manual',
    headers: {
      accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
      'user-agent': 'Aker/0.4 source-reader',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    if (redirects >= MAX_REDIRECTS) throw new Error('来源重定向次数过多');
    return fetchSource(new URL(response.headers.get('location'), target).toString(), redirects + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) throw new Error(`暂不支持 ${type.split(';')[0] || '该'} 格式`);
  const body = await readLimited(response);
  const summary = /html|xhtml/i.test(type) ? htmlSummary(body) : { title: '', excerpt: body.replace(/\s+/g, ' ').trim().slice(0, 3000) };
  return { ...summary, finalUrl: target.toString() };
}

export async function enrichProjectSources(project) {
  project.sources ||= [];
  const pending = project.sources.filter((source) => source.status === 'provided').slice(0, 8);
  await Promise.all(pending.map(async (source) => {
    try {
      const result = await fetchSource(source.url);
      Object.assign(source, result, { status: 'ready', fetchedAt: new Date().toISOString(), error: null });
    } catch (error) {
      Object.assign(source, { status: 'failed', fetchedAt: new Date().toISOString(), error: String(error?.message || error).slice(0, 240) });
    }
  }));
  return project;
}
