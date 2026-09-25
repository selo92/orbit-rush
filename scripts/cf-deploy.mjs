/**
 * Create D1 if needed, migrate, build, and deploy the Worker + static game.
 * Requires `npx wrangler login` or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'orbit-rush-scores';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function run(args, { capture = false } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });
  if (!capture && r.status !== 0) process.exit(r.status ?? 1);
  return r;
}

function npm(script) {
  const r = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(WRANGLER)) {
  fail('wrangler is not installed. Run npm install first.');
}

const who = run(['whoami'], { capture: true });
const whoText = `${who.stdout || ''}\n${who.stderr || ''}`;
if (who.status !== 0 || /not authenticated|not logged in/i.test(whoText)) {
  fail(
    [
      'Cloudflare is not logged in on this machine.',
      'Next step for the repo owner:',
      '  1. Create a free account at https://dash.cloudflare.com/sign-up',
      '  2. Workers & Pages → register a workers.dev subdomain if asked',
      '  3. From the repo: npx wrangler login',
      '  4. npm run deploy',
      'Or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (see DEPLOY.md).',
      '',
      (who.stderr || who.stdout || '').trim(),
    ].join('\n')
  );
}

npm('smoke');
npm('smoke:worker');
npm('build');

const listed = run(['d1', 'list', '--json'], { capture: true });
if (listed.status !== 0) {
  fail(`wrangler d1 list failed:\n${listed.stderr || listed.stdout}`);
}

let databases = [];
try {
  const raw = listed.stdout || '';
  try {
    databases = JSON.parse(raw);
  } catch {
    const start = raw.search(/[\[{]/);
    const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
    if (start === -1 || end <= start) throw new Error(raw.slice(0, 500));
    databases = JSON.parse(raw.slice(start, end + 1));
  }
} catch (err) {
  fail(`Could not parse wrangler d1 list output:\n${listed.stdout}\n${err.message}`);
}
if (!Array.isArray(databases)) databases = databases?.result || databases?.databases || [];

let db = databases.find((d) => d.name === DB_NAME || d.database_name === DB_NAME);
if (!db) {
  console.log(`Creating D1 database ${DB_NAME}…`);
  const created = run(['d1', 'create', DB_NAME], { capture: true });
  const blob = `${created.stdout || ''}\n${created.stderr || ''}`;
  if (created.status !== 0) fail(`wrangler d1 create failed:\n${blob}`);
  const uuid = blob.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!uuid) fail(`Could not read new database id:\n${blob}`);
  db = { uuid: uuid[0], name: DB_NAME };
}

const databaseId = db.uuid || db.database_id || db.id;
if (!databaseId) fail(`D1 database ${DB_NAME} has no id: ${JSON.stringify(db)}`);

const tomlPath = path.join(root, 'wrangler.toml');
const toml = fs.readFileSync(tomlPath, 'utf8');
const next = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`);
if (next === toml && !toml.includes(databaseId)) {
  fail('Could not update database_id in wrangler.toml');
}
if (next !== toml) {
  fs.writeFileSync(tomlPath, next);
  console.log(`Updated wrangler.toml database_id = ${databaseId}`);
}

run(['d1', 'migrations', 'apply', DB_NAME, '--remote'], {
  env: { ...process.env, CI: 'true' },
});

const deployed = run(['deploy'], { capture: true });
process.stdout.write(deployed.stdout || '');
process.stderr.write(deployed.stderr || '');
if (deployed.status !== 0) process.exit(deployed.status ?? 1);

const url = `${deployed.stdout || ''}\n${deployed.stderr || ''}`.match(/https:\/\/[^\s)]+\.workers\.dev/);
if (url) {
  console.log(`\nLive play URL: ${url[0]}`);
  console.log('Paste this URL into the README section "Spielen". Do not invent a different one.');
} else {
  console.log('\nDeploy finished. Copy the workers.dev URL from the Wrangler output into the README.');
}
