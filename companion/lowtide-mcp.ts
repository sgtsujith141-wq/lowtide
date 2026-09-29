#!/usr/bin/env node
/*
 * LOWTIDE companion, stage 1 (ADR-055): an MCP server over stdio that serves
 * an exported LOWTIDE workspace to an AI client.
 *
 *   node companion/lowtide-mcp.ts --workspace <folder> --project <slug>
 *   node companion/lowtide-mcp.ts --workspace <folder> --scope workspace
 *
 * Project scope is the default and is required unless you explicitly choose
 * the workspace scope. No network, no secrets, no access outside <folder>.
 */
import { serve } from './mcp.ts';
import { Workspace, type Scope } from './workspace.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = arg('workspace');
const project = arg('project');
const wide = arg('scope') === 'workspace';

if (!root || (!project && !wide)) {
  process.stderr.write(
    'Usage: lowtide-mcp --workspace <folder> (--project <slug> | --scope workspace)\n',
  );
  process.exit(2);
}

const scope: Scope = project ? { kind: 'project', slug: project } : { kind: 'workspace' };
try {
  const ws = new Workspace(root, scope);
  process.stderr.write(
    `LOWTIDE companion serving ${ws.root} (${scope.kind === 'project' ? `project ${scope.slug}` : 'workspace'})\n`,
  );
  serve(ws, process.stdin, process.stdout);
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
}
