import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function prepare(path) {
  return read(path)
    .replace(/^import .*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/process\.env/g, '__ENV');
}

const modules = [
  prepare('src/frameworks.mjs'),
  prepare('src/trace.mjs'),
  prepare('src/adapters.mjs'),
  prepare('src/tasks.mjs'),
  prepare('src/evaluator.mjs'),
].join('\n\n');

const runtime = `
const __ENV = {};
const __KEY = 'aker.tasks.v05';
const __SIM_RUNNERS = [
  { id:'sim-research-a', label:'Sim Research A', type:'sim', framework:'sim-research', model:'sim-a', runnable:true, simulated:true, permission:'simulated-read-only', capabilities:{search:true,readOnlyTools:true,trace:true,sources:true,subagents:false,judge:true} },
  { id:'sim-research-b', label:'Sim Research B', type:'sim', framework:'sim-research', model:'sim-b', runnable:true, simulated:true, permission:'simulated-read-only', capabilities:{search:true,readOnlyTools:true,trace:true,sources:true,subagents:false,judge:true} },
  { id:'sim-judge', label:'Sim Judge', type:'sim', framework:'sim-judge', model:'sim-judge', runnable:true, simulated:true, permission:'simulated-read-only', capabilities:{search:true,readOnlyTools:true,trace:true,sources:true,subagents:false,judge:true} },
];
function listConnections(){return {cli:[],api:[],keychain:false}}
function getApiKey(){return null}
function getApiModel(provider){return provider==='anthropic'?'claude-sonnet-4-6':'gpt-4.1-mini'}
function listRunners(){return __SIM_RUNNERS}
function getRunner(id){return __SIM_RUNNERS.find(r=>r.id===id)||null}
function loadDb(){try{const db=JSON.parse(localStorage.getItem(__KEY))||{};db.tasks||=[];return db}catch{return {tasks:[]}}}
function saveDb(db){localStorage.setItem(__KEY,JSON.stringify(db))}
function saveTask(task){const db=loadDb();const i=db.tasks.findIndex(x=>x.id===task.id);if(i>=0)db.tasks[i]=task;else db.tasks.unshift(task);saveDb(db);return task}
function getTask(id){return loadDb().tasks.find(x=>x.id===id)||null}
function listTasks(){return loadDb().tasks.map(({id,title,status,mode,createdAt,updatedAt})=>({id,title,status,mode,createdAt,updatedAt,legacy:false}))}
async function route(method,urlString,payload){
  const p=new URL(urlString,location.origin).pathname;
  if(p==='/api/runners'&&method==='GET')return {status:200,body:{runners:listRunners()}};
  if(p==='/api/tasks'&&method==='GET')return {status:200,body:{tasks:listTasks()}};
  if(p==='/api/tasks'&&method==='POST'){const task=createTask({...payload,mode:'sim'});saveTask(task);return {status:201,body:{task}}}
  const m=p.match(/^\\/api\\/tasks\\/([^/]+)$/);
  if(m&&method==='GET'){const task=getTask(decodeURIComponent(m[1]));return task?{status:200,body:{task}}:{status:404,body:{error:'task 不存在'}}}
  if(m&&method==='PATCH'){const task=getTask(decodeURIComponent(m[1]));patchTask(task,{...payload,mode:'sim'});saveTask(task);return {status:200,body:{task}}}
  const run=p.match(/^\\/api\\/tasks\\/([^/]+)\\/run$/);
  if(run&&method==='POST'){const task=getTask(decodeURIComponent(run[1]));const stream=[];await runTask(task,{onEvent:async e=>{saveTask(task);stream.push(e)}});saveTask(task);stream.push({type:'complete',task});return {status:200,stream}}
  const evaluate=p.match(/^\\/api\\/tasks\\/([^/]+)\\/evaluate$/);
  if(evaluate&&method==='POST'){const task=getTask(decodeURIComponent(evaluate[1]));await evaluateTask(task);saveTask(task);return {status:200,body:{task}}}
  if(p==='/api/runners/import-github')return {status:400,body:{error:'Standalone Web Demo 仅提供 Sim Runner；请使用桌面版导入 Agent。'}};
  return {status:404,body:{error:'unknown api'}};
}
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{
  const url=typeof input==='string'?input:input.url;
  if(url&&url.includes('/api/')){
    let result;try{result=await route((init.method||'GET').toUpperCase(),url,init.body?JSON.parse(init.body):{})}catch(error){result={status:500,body:{error:String(error.message||error)}}}
    if(result.stream)return new Response(result.stream.map(x=>JSON.stringify(x)).join('\\n')+'\\n',{status:result.status,headers:{'content-type':'application/x-ndjson'}});
    return new Response(JSON.stringify(result.body),{status:result.status,headers:{'content-type':'application/json'}});
  }
  return originalFetch(input,init);
};
`;

const bundle = `${modules}\n${runtime}\n${read('web/app.js')}`;
try { new Function(bundle); } catch (error) { throw new Error(`standalone bundle syntax error: ${error.message}`); }

let html = read('web/index.html');
html = html.replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${read('web/styles.css')}\n</style>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${bundle}\n</script>`);
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist', 'aker.html'), html);
copyFileSync(join(ROOT, 'dist', 'aker.html'), join(ROOT, 'web', 'aker.html'));
copyFileSync(join(ROOT, 'dist', 'aker.html'), join(ROOT, 'docs', 'index.html'));
console.log('✔ standalone Sim-only demo built');
