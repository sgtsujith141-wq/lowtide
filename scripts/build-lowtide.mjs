#!/usr/bin/env node
/*
 * npm run build:lowtide (v2.3, ADR-073): builds an installable LOWTIDE
 * runtime and checks it before anyone installs it.
 *
 *   build/lowtide/<build>/
 *     frontend/                    the built app (served by the companion)
 *     companion/lowtide-companion.js   one self-contained file (Node built-ins only)
 *     mcp/lowtide-mcp.js           the stdio MCP bridge
 *     app/LOWTIDE.icns             the app icon (when macOS can draw it)
 *     runtime.json                 version, build, commit, Node it needs
 *
 * Checks: every bundle imports only node: built-ins and parses; the app has
 * its page and assets; the runtime starts from a temporary copy outside this
 * repository with a throwaway data folder and serves health, the app and
 * /mcp. Prints the build folder on the last line.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.error(...a);
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'inherit'] });
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const skipCompile = process.argv.includes('--skip-compile');

// 1. Compile
if (!skipCompile) {
  say('1. building the app (tsc -b, vite build) and the companion and bridge bundles');
  run('npm', ['run', '--silent', 'build']);
  run('npm', ['run', '--silent', 'companion:build']);
}

// 2. Assemble
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const commit = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const build = `${pkg.version}-${stamp}${commit ? `-${commit}` : ''}${dirty ? '-dirty' : ''}`;
const out = join(REPO, 'build', 'lowtide', build);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'companion'), { recursive: true });
mkdirSync(join(out, 'mcp'), { recursive: true });
mkdirSync(join(out, 'app'), { recursive: true });
cpSync(join(REPO, 'dist'), join(out, 'frontend'), { recursive: true });
for (const f of ['lowtide-companion.js', 'lowtide-companion.js.map']) {
  cpSync(join(REPO, 'companion', 'dist', f), join(out, 'companion', f));
}
cpSync(join(REPO, 'companion', 'dist', 'lowtide-mcp.js'), join(out, 'mcp', 'lowtide-mcp.js'));
const manifest = {
  version: pkg.version,
  build,
  ...(commit ? { commit } : {}),
  dirty,
  builtAt: new Date().toISOString(),
  node: pkg.engines?.node ?? '>=22.22.0',
};
writeFileSync(join(out, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);
say(`2. assembled ${out}`);

// The icon, drawn from the favicon by macOS (best effort: no icon is fine).
if (process.platform === 'darwin') {
  const work = mkdtempSync(join(tmpdir(), 'lowtide-icon-'));
  try {
    execFileSync(
      '/usr/bin/qlmanage',
      ['-t', '-s', '1024', '-o', work, join(REPO, 'public', 'favicon.svg')],
      {
        stdio: 'ignore',
      },
    );
    const png = join(work, 'favicon.svg.png');
    const set = join(work, 'LOWTIDE.iconset');
    mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = size * scale;
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        execFileSync(
          '/usr/bin/sips',
          ['-z', String(px), String(px), png, '--out', join(set, name)],
          {
            stdio: 'ignore',
          },
        );
      }
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', join(out, 'app', 'LOWTIDE.icns')]);
    say('   icon drawn from the favicon');
  } catch {
    say('   (no icon: macOS couldn’t draw the favicon; LOWTIDE.app uses the default icon)');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// 3. Validate
const fail = (message) => {
  say(`BUILD CHECK FAILED: ${message}`);
  process.exit(1);
};
for (const file of [
  join(out, 'companion', 'lowtide-companion.js'),
  join(out, 'mcp', 'lowtide-mcp.js'),
]) {
  const text = readFileSync(file, 'utf8');
  // Code lines only: comments (JSDoc mentions import('…') types) and generated-code
  // strings inside libraries aren't imports. An ES bundle can't require() at all
  // unless it builds a require, which it must not.
  if (/\bcreateRequire\b/.test(text)) fail(`${file} builds a require()`);
  const code = text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const specifiers = [
    ...code.matchAll(/^import\s[^'"]*?from\s*['"]([^'"]+)['"]/gm),
    ...code.matchAll(/^import\s*['"]([^'"]+)['"]/gm),
    ...code.matchAll(/(?<![\w.`"'])import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  const outside = [...new Set(specifiers)].filter((s) => !s.startsWith('node:'));
  if (outside.length) fail(`${file} imports ${outside.join(', ')}; it must be self-contained`);
  if (spawnSync(process.execPath, ['--check', file]).status !== 0) fail(`${file} doesn't parse`);
}
const page = readFileSync(join(out, 'frontend', 'index.html'), 'utf8');
for (const [, asset] of page.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
  if (!existsSync(join(out, 'frontend', asset))) fail(`index.html refers to missing ${asset}`);
}
if (!readdirSync(join(out, 'frontend', 'assets')).some((f) => f.endsWith('.js'))) {
  fail('the app has no scripts');
}
say('3. bundles are self-contained and parse; the app’s page and assets are there');

// 4. Smoke test: the runtime from a copy outside the repository, with throwaway data.
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const scratch = mkdtempSync(join(tmpdir(), 'lowtide-build-check-'));
const copy = join(scratch, 'runtime');
cpSync(out, copy, { recursive: true });
const child = spawn(
  process.execPath,
  [
    join(copy, 'companion', 'lowtide-companion.js'),
    '--data',
    join(scratch, 'data'),
    '--port',
    String(port),
  ],
  { cwd: scratch, stdio: 'ignore' },
);
const base = `http://127.0.0.1:${port}`;
try {
  let health;
  for (let i = 0; i < 120 && !health; i++) {
    await new Promise((r) => setTimeout(r, 100));
    health = await fetch(`${base}/api/health`).then(
      (r) => r.json(),
      () => undefined,
    );
  }
  if (!health) fail('the built companion didn’t start');
  if (health.version !== pkg.version) fail(`health says version ${health.version}`);
  if (health.status !== 'ok') fail(`health is ${health.status}: ${JSON.stringify(health.checks)}`);
  if (!health.checks.frontend.served) fail('the companion doesn’t serve the app');
  const app = await fetch(`${base}/projects`);
  if (app.status !== 200 || !(await app.text()).includes('lowtide-served-by')) {
    fail('the app isn’t served on a deep link');
  }
  if ((await fetch(`${base}/mcp`, { method: 'POST' })).status !== 401) {
    fail('/mcp doesn’t ask for a grant');
  }
  say(`4. the built runtime starts outside the repository and serves health, the app and /mcp`);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(REPO, 'build', 'lowtide', 'latest'), `${build}\n`);
console.log(out);
