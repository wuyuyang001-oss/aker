import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichProjectSources } from '../src/sources.mjs';

test('source reader refuses local and private-network URLs', async () => {
  const project = {
    sources: [{ id: 'S1', url: 'http://127.0.0.1:5178/private', title: 'local', excerpt: '', status: 'provided' }],
  };
  await enrichProjectSources(project);
  assert.equal(project.sources[0].status, 'failed');
  assert.match(project.sources[0].error, /本机|内网/);
});
