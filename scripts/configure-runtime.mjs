/** Prepare/reconcile runtime settings without printing secret values.
 * Defaults to a plan. --apply writes Vercel config and a paired local worker
 * token file (gitignored), without deploying. Existing secrets aren't replaced. */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
const expected = 'prj_q3o6bBfw6lAoJvweykzF8Saar6ji';
const linked = JSON.parse(readFileSync('.vercel/project.json','utf8'));
if (linked.projectId !== expected) throw new Error('Wrong Vercel project link');
execFileSync('vercel',['project','inspect','--non-interactive'],{stdio:'inherit'});
const raw = JSON.parse(execFileSync('vercel',['env','ls','production','--json'],{encoding:'utf8'}));
const rows = Array.isArray(raw) ? raw : raw.envs || raw.environmentVariables || [];
const configured = new Set(rows.map((x) => x.key || x.name));
const defaults = { LEGAL_CONTACT_EMAIL:'legal@xark.io', MEMBER_MONTHLY_ALLOWANCE_USD:'1', SPEND_GUARD:'on', CSP_MODE:'report' };
const missing = Object.keys(defaults).filter((key) => !configured.has(key));
console.log({ project:'creativeintel', addConfig:missing, addBrowserToken:!configured.has('BROWSER_WORKER_TOKEN'), deploy:false });
if (!process.argv.includes('--apply')) process.exit(0);
mkdirSync('.vercel',{recursive:true});
const temp = '.vercel/runtime-value.tmp';
try {
  for (const key of missing) {
    writeFileSync(temp,defaults[key],{mode:0o600});
    execFileSync('vercel',['env','add',key,'production','--type','config','--non-interactive'],{input:readFileSync(temp),stdio:['pipe','inherit','inherit']});
  }
  if (!configured.has('BROWSER_WORKER_TOKEN')) {
    const tokenFile = '.vercel/browser-worker.env.local';
    if (existsSync(tokenFile)) throw new Error('Existing paired browser worker token file requires manual reconciliation');
    const token = randomBytes(32).toString('hex');
    writeFileSync(tokenFile,`BROWSER_WORKER_TOKEN=${token}\n`,{mode:0o600});
    execFileSync('vercel',['env','add','BROWSER_WORKER_TOKEN','production','--type','secret','--non-interactive'],{input:token,stdio:['pipe','inherit','inherit']});
    console.log('Paired browser worker credential saved to .vercel/browser-worker.env.local');
  }
} finally { if(existsSync(temp))unlinkSync(temp); }
