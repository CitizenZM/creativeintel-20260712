/** Names only: never print configuration values or credentials. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const envArg = process.argv.find((x) => x.startsWith('--env-file='));
const env = { ...process.env, ...(envArg ? dotenv.parse(readFileSync(envArg.slice(11))) : {}) };
const sourceFiles = [];
function walk(dir) { for (const file of readdirSync(dir, { withFileTypes: true })) { if (file.name === 'generated' || file.name === 'node_modules') continue; const full = path.join(dir, file.name); if (file.isDirectory()) walk(full); else if (/\.[cm]?[jt]sx?$/.test(file.name) && !/\.test\./.test(file.name)) sourceFiles.push(full); } }
walk('src');walk('workers');
const used = new Set();
for (const file of sourceFiles) { for (const match of readFileSync(file, 'utf8').matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g)) used.add(match[1] || match[2]); }
const managed = /^(VERCEL(?:_|$)|NODE_ENV$|VITEST$|NEXT_RUNTIME$|CI$)/;
const missing = [...used].filter((name) => !env[name] || env[name] === '[SENSITIVE]').sort();
const defaults = { LEGAL_CONTACT_EMAIL: 'legal@xark.io', MEMBER_MONTHLY_ALLOWANCE_USD: '1', SPEND_GUARD: 'on', CSP_MODE: 'report' };
const required = env.VERCEL_ENV === 'preview'
  ? ['PREVIEW_DATABASE_URL', 'CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY']
  : ['APP_DATABASE_URL', 'CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CRON_SECRET', 'WORKER_TOKEN'];
console.log(JSON.stringify({ referencedNames: used.size, missingRequired: required.filter((k) => missing.includes(k) && !(k === 'APP_DATABASE_URL' && env.DATABASE_URL)), explicitDefaults: defaults, optionalUnset: missing.filter((k) => !required.includes(k) && !managed.test(k)), managedUnset: missing.filter((k) => managed.test(k)) }, null, 2));
if (process.argv.includes('--strict') && required.some((k) => missing.includes(k) && !(k === 'APP_DATABASE_URL' && env.DATABASE_URL))) process.exitCode = 1;
if (process.argv.includes('--update-example')) {
  const { appendFileSync } = await import('node:fs');
  const example = existsSync('.env.example') ? readFileSync('.env.example','utf8') : '';
  const existing = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const absent = [...used].filter((k) => !existing.has(k) && !managed.test(k)).sort();
  appendFileSync('.env.example', '\n# Optional feature switches / provider settings discovered from source.\n# Empty values use documented defaults or leave that integration disabled.\n'+absent.map((k) => `${k}=${defaults[k] || ''}`).join('\n')+'\n');
}
