#!/usr/bin/env node
/*
 * End-to-end check of LOWTIDE with its companion, in a real browser.
 *
 *   npm run e2e:companion
 *
 * Builds the app and the companion, starts `vite preview` and the companion
 * with a THROWAWAY data folder and token, and drives a fresh headless
 * Chromium context through: creating a project in browser storage, pairing,
 * the required backup, the verified move, switching, giving an AI client
 * access, and a real MCP session over the stdio bridge (read a project,
 * request approval, read it back, resolve it, update the project) while the
 * open Project Room shows every change live. Then the audit, the synced
 * workspace, and Sleep Mode over a Dark theme. Everything is removed after.
 * No real LOWTIDE profile or data folder is ever touched.
 *
 * Needs `playwright-core` and a Playwright Chromium (`npx playwright install
 * chromium`). LOWTIDE doesn't depend on them: set PLAYWRIGHT_CORE to a
 * playwright-core folder if it isn't resolvable from here.
 * Ports: APP_PORT (4174) and COMPANION_PORT (47318).
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = Number(process.env.APP_PORT ?? 4174);
const COMPANION_PORT = Number(process.env.COMPANION_PORT ?? 47318);
const APP = `http://localhost:${APP_PORT}`;
const COMPANION = `http://127.0.0.1:${COMPANION_PORT}`;

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core'));
} catch {
  console.error(
    'playwright-core isn’t available. Install it (npx playwright install chromium) or set PLAYWRIGHT_CORE.',
  );
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'lowtide-e2e-'));
const dataDir = join(work, 'data');
const workspace = join(work, 'workspace');
const shots = process.env.E2E_SHOTS ?? join(work, 'shots');
mkdirSync(dataDir, { mode: 0o700 });
mkdirSync(shots, { recursive: true });
const ownerToken = randomBytes(32).toString('base64url');
writeFileSync(
  join(dataDir, 'companion.json'),
  JSON.stringify({
    port: COMPANION_PORT,
    allowedOrigins: [APP, `http://127.0.0.1:${APP_PORT}`],
    workspaceDir: workspace,
    ownerToken,
  }),
  { mode: 0o600 },
);

const children = [];
const steps = [];
const step = (name, detail = '') => {
  steps.push(name);
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
};

async function until(check, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

if (!process.argv.includes('--no-build')) {
  for (const script of ['build', 'companion:build']) {
    const built = spawnSync('npm', ['run', script], { cwd: REPO, stdio: 'ignore' });
    if (built.status !== 0) throw new Error(`npm run ${script} failed`);
  }
  step('built the app and the companion');
}

children.push(
  spawn(process.execPath, ['companion/dist/lowtide-companion.js', '--data', dataDir], {
    cwd: REPO,
    stdio: 'ignore',
  }),
);
children.push(
  spawn('npx', ['vite', 'preview', '--port', String(APP_PORT), '--strictPort'], {
    cwd: REPO,
    stdio: 'ignore',
  }),
);
await until(async () => (await fetch(`${COMPANION}/api/health`)).ok, 'the companion');
await until(async () => (await fetch(APP)).ok, 'vite preview');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
let bridge;

try {
  await page.goto(`${APP}/projects`);
  await page.getByRole('button', { name: 'New project' }).click();
  const form = page.getByRole('form', { name: 'New project' });
  await form.getByLabel('Name').fill('Engine');
  await form.getByLabel(/Objective/).fill('Ship the companion');
  await form.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('heading', { level: 1, name: 'Engine' }).waitFor();
  step('browser storage: a project created through the UI');

  await page.goto(`${APP}/settings#companion=${encodeURIComponent(COMPANION)}&token=${ownerToken}`);
  await page.getByRole('button', { name: 'Pair' }).waitFor();
  if ((await page.evaluate(() => window.location.hash)) !== '')
    throw new Error('token left in the address bar');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText(/Paired with the companion/).waitFor();
  step('paired from a pairing link; the token left the address bar');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download a backup' }).click(),
  ]);
  const backupPath = join(work, download.suggestedFilename());
  await download.saveAs(backupPath);
  await page.getByText(/Saved and checked/).waitFor();
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  step(
    'required backup downloaded and checked',
    `${download.suggestedFilename()}, schema ${backup.schemaVersion}`,
  );

  await page.getByRole('checkbox', { name: 'I have the backup file somewhere safe' }).check();
  await page.getByRole('button', { name: 'Move LOWTIDE into the companion' }).click();
  await page.getByRole('heading', { name: 'Moved and verified' }).waitFor({ timeout: 15000 });
  if (await page.getByRole('list', { name: 'Checks' }).getByText('(failed)').count())
    throw new Error('a migration check failed');
  await shot('01-migration-report');
  step('moved and verified: every check passed');

  await page.getByRole('button', { name: 'Switch to the companion' }).click();
  await page.waitForURL(`${APP}/settings`);
  await page.getByText('Connected', { exact: true }).waitFor({ timeout: 10000 });
  const kept = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  if (!kept.includes('lowtide')) throw new Error('IndexedDB is gone');
  step('switched to the companion; the browser’s IndexedDB is still there');

  await page.getByRole('radio', { name: /Dark/ }).check();

  await page.goto(`${APP}/ai`);
  await page.getByRole('button', { name: 'Give access' }).click();
  const grant = page.getByRole('form', { name: 'Give an AI client access' });
  // Custom access: one project, reading plus the changes this run makes.
  await grant.getByRole('radio', { name: /^Custom/ }).check();
  await grant.getByRole('radio', { name: 'One project' }).check();
  for (const permission of [
    'Edit projects (details, state, focus, pins)',
    'Blockers, waiting, parked ideas and approval requests',
    'Resolve approval requests',
    'Log AI sessions, notes and checkpoints',
  ]) {
    await grant.getByRole('checkbox', { name: permission }).check();
  }
  await grant.getByRole('button', { name: 'Create access' }).click();
  const token = await page.getByRole('textbox', { name: 'Token' }).inputValue();
  await page.getByRole('button', { name: 'Done, I’ve saved it' }).click();
  step('access given to Claude Code; its token shown once');

  await page.goto(`${APP}/projects/engine`);
  await page.getByRole('heading', { level: 1, name: 'Engine' }).waitFor();

  bridge = spawn(process.execPath, [join(REPO, 'companion/lowtide-mcp.ts'), '--url', COMPANION], {
    env: { ...process.env, LOWTIDE_TOKEN: token, NODE_NO_WARNINGS: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiting = new Map();
  createInterface({ input: bridge.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let n = 0;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => reject(new Error(`no reply to ${method}`)), 10000);
      waiting.set(id, (m) => (clearTimeout(timer), resolve(m)));
      bridge.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`,
      );
    });
  const tool = async (name, args = {}) => {
    const { result } = await rpc('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
    return JSON.parse(result.content[0].text);
  };
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'lowtide-e2e', version: '1.0' },
  });
  bridge.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );
  const tools = (await rpc('tools/list')).result.tools;
  step(
    'MCP session over the stdio bridge',
    `protocol ${init.result.protocolVersion}, ${tools.length} tools`,
  );

  const project = await tool('get_project');
  step('1. read the project', project.name);
  const requested = await tool('request_approval', {
    title: 'Ship the companion',
    body: 'All checks green.',
  });
  await page.getByText('Ship the companion', { exact: true }).first().waitFor({ timeout: 10000 });
  await shot('02-approval-live');
  step('2. requested approval; the open Project Room showed it live');
  const open = await tool('get_approval_requests');
  if (!open.some((a) => a.id === requested.id && a.status === 'open'))
    throw new Error('not read back');
  step('3. read it back');
  await tool('resolve_approval', { item: requested.id });
  await tool('update_project', { nextAction: 'Pair Claude Code for real' });
  step('4. resolved it and updated the next action');
  await page.getByText('Pair Claude Code for real').first().waitFor({ timeout: 10000 });
  // The room's activity leads each change with who made it.
  await page
    .getByRole('region', { name: 'Activity' })
    .getByText('Claude Code', { exact: true })
    .first()
    .waitFor({ timeout: 10000 });
  await shot('03-after-resolve');
  step('5. the Project Room followed live, attributed to Claude Code');
  await tool('log_ai_session', {
    summary: 'E2E: requested and resolved an approval.',
    result: 'Passed.',
  });

  await page.goto(`${APP}/ai`);
  await page
    .getByRole('region', { name: 'AI clients' })
    .getByText('Connected', { exact: true })
    .waitFor({ timeout: 10000 });
  await page
    .getByRole('list', { name: 'AI activity' })
    .getByText(/^Claude Code resolved an approval/)
    .waitFor({ timeout: 10000 });
  await shot('04-ai-area');
  step('the AI area shows Claude Code connected and what it did');

  bridge.stdin.end();
  await new Promise((r) => bridge.on('exit', r));

  const root = join(workspace, 'projects/engine');
  await until(
    async () =>
      readFileSync(join(root, 'PROJECT.md'), 'utf8').includes('Pair Claude Code for real'),
    'the workspace sync',
  );
  step('the workspace updated itself', readdirSync(root).join(', '));

  await page.goto(`${APP}/`);
  await page.getByRole('button', { name: 'Sleep Mode' }).click();
  await page.getByRole('dialog', { name: 'Off time' }).waitFor();
  const [theme, sleeping] = await page.evaluate(() => [
    document.documentElement.dataset.theme,
    !!document.querySelector('[data-mode="sleep"]'),
  ]);
  if (theme !== 'dark' || !sleeping) throw new Error('Sleep Mode changed the theme');
  step('Sleep Mode dims the Dark theme without changing it');
  await page.getByRole('button', { name: 'Wake up' }).click();

  if (consoleErrors.length) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
  console.log(`\nAll ${steps.length} steps passed. Screenshots: ${shots}`);
} catch (error) {
  await shot('failure').catch(() => undefined);
  console.error(`\n✗ ${error.message}\nScreenshots: ${shots}`);
  process.exitCode = 1;
} finally {
  if (bridge && bridge.exitCode === null) bridge.kill();
  await browser.close();
  for (const child of children) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (!process.env.E2E_SHOTS) rmSync(work, { recursive: true, force: true });
  else
    for (const f of [dataDir, workspace])
      if (existsSync(f)) rmSync(f, { recursive: true, force: true });
}
