import { randomUUID } from 'node:crypto';
import * as z from 'zod/mini';
import { STORE_NAMES } from '../../src/db/migrations';
import { createRepositories, type BackupData } from '../../src/db/repositories';
import type { Grant } from './grants';
import {
  lacks,
  needs,
  Refusal,
  scopeName,
  type Args,
  type CallContext,
  type Env,
  type Outcome,
  type Tool,
  type ToolResult,
  type ToolServices,
} from './tools/kit';
import { readTools, spaceReadTools, spaceWriteTools, writeTools } from './tools/base';
import { operatorTools } from './tools/operator';
import { spaceOperatorTools } from './tools/space-operator';
import { lifeTools } from './tools/life';
import { metaTools } from './tools/meta';

export type { CallContext, ToolResult, ToolServices } from './tools/kit';

/*
 * The MCP tool set (ADR-059, v2.1 operator parity). Each tool names the
 * capabilities it needs; a grant sees and may call only the tools its
 * capabilities (and scope and private categories) allow. Refusals say what
 * was refused, why, and what would allow it. Every call is audited; every
 * successful write is also kept as a reviewable change in the AI area, with
 * an undo where LOWTIDE can put things back exactly.
 */

export const TOOLS: readonly Tool[] = [
  ...metaTools,
  ...readTools,
  ...spaceReadTools,
  ...writeTools,
  ...operatorTools,
  ...spaceWriteTools,
  ...spaceOperatorTools,
  ...lifeTools,
];

{
  const seen = new Set<string>();
  for (const t of TOOLS) {
    if (seen.has(t.name)) throw new Error(`Duplicate tool ${t.name}`);
    seen.add(t.name);
  }
}

/** Why a grant can't use a tool, or undefined when it can. */
export function refusalFor(grant: Grant, tool: Tool): string | undefined {
  for (const capability of needs(tool)) {
    if (!grant.capabilities.includes(capability)) return lacks(tool.action, capability);
  }
  if (tool.category) {
    if (grant.scope !== 'global') {
      return `Cannot ${tool.action}. Only a global connection can reach private life data.`;
    }
    if (!grant.sensitive.includes(tool.category)) {
      return `Cannot ${tool.action}. Grant lacks the private category ${tool.category}.`;
    }
  }
  return undefined;
}

/** Tools this grant may call. */
export function toolsFor(grant: Grant) {
  return TOOLS.filter((t) => refusalFor(grant, t) === undefined).map((t) => {
    const inputSchema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete inputSchema.$schema; // plain JSON Schema for every client
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      annotations: {
        readOnlyHint: !t.write,
        destructiveHint: false,
        idempotentHint: !t.write,
        openWorldHint: false,
      },
    };
  });
}

/** Thrown inside a dry run's transaction to roll it back with the result. */
class DryRun extends Error {
  constructor(readonly outcome: Outcome) {
    super('dry run');
  }
}

/** Runs one tool call for a grant, and audits it whatever happens. */
export async function callTool(
  services: ToolServices,
  ctx: CallContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const { grant } = ctx;
  const tool = TOOLS.find((t) => t.name === name);
  const at = services.now();
  const audit = (
    result: 'ok' | 'refused' | 'error',
    extra: Partial<Outcome> & { message?: string } = {},
  ) =>
    services.grants.audit({
      grantId: grant.id,
      client: grant.label,
      clientKind: grant.clientKind,
      scope: scopeName(grant),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      operation: name.slice(0, 100),
      ...(extra.entityType ? { entityType: extra.entityType } : {}),
      ...(extra.entityId ? { entityId: extra.entityId } : {}),
      ...(extra.before ? { before: extra.before.slice(0, 500) } : {}),
      ...(extra.after ? { after: extra.after.slice(0, 500) } : {}),
      result,
      ...(extra.message ? { message: extra.message.slice(0, 500) } : {}),
    });
  const fail = (message: string): ToolResult => ({
    content: [{ type: 'text', text: message }],
    isError: true,
  });

  if (!tool) {
    const message = `Unknown tool ${name}. get_lowtide_capabilities lists what this connection can do.`;
    audit('refused', { message });
    return fail(message);
  }
  const refusal = refusalFor(grant, tool);
  if (refusal) {
    audit('refused', { message: refusal });
    return fail(refusal);
  }
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const message = `Invalid arguments: ${parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`)
      .join('; ')}`;
    audit('refused', { message });
    return fail(message);
  }
  const args = parsed.data as Args;
  const dryRun = tool.write && tool.dryRun === true && args.dryRun === true;

  let snapshot: Promise<BackupData> | undefined;
  const env: Env = {
    ...services,
    ctx,
    at,
    dryRun,
    data: () => (snapshot ??= readAll(services)),
    repos: () =>
      createRepositories(services.store, {
        clock: services.now,
        watch: services.store.watch,
        source: 'ai-client',
        actor: grant.label,
      }),
    can: (capability, category) =>
      grant.capabilities.includes(capability) &&
      (!category || (grant.scope === 'global' && grant.sensitive.includes(category))),
    atomic: (work) =>
      services.store.transaction(
        'rw',
        STORE_NAMES.map((n) => services.store[n]),
        work,
      ),
    require: (capability, action, category) => {
      if (!grant.capabilities.includes(capability)) throw new Refusal(lacks(action, capability));
      if (category && !(grant.scope === 'global' && grant.sensitive.includes(category))) {
        throw new Refusal(`Cannot ${action}. Grant lacks the private category ${category}.`);
      }
    },
  };
  try {
    let outcome: Outcome;
    if (dryRun) {
      const { store } = services;
      try {
        await store.transaction(
          'rw',
          STORE_NAMES.map((n) => store[n]),
          async () => {
            throw new DryRun(await tool.run(env, args));
          },
        );
        throw new Error('A dry run must roll back');
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
        outcome = error.outcome;
      }
      audit('ok', { ...outcome, after: `dry run: ${outcome.after ?? ''}` });
      return reply({
        dryRun: true,
        note: 'Nothing was changed. Run again without dryRun to do this.',
        wouldDo: (outcome.changes ?? []).map((c) => c.summary),
        result: outcome.value,
      });
    }
    const big = tool.checkpointAt !== undefined && countItems(args) >= tool.checkpointAt;
    if (big && services.checkpoints) {
      await services.checkpoints.create(`Before ${grant.label} ${tool.name}`, grant.label, true);
    }
    outcome = await tool.run(env, args);
    audit('ok', outcome);
    if (tool.write) {
      const batchId = (outcome.changes?.length ?? 0) > 1 ? randomUUID() : undefined;
      for (const change of outcome.changes ?? []) {
        services.grants.recordChange({
          grantId: grant.id,
          client: grant.label,
          tool: tool.name,
          summary: change.summary,
          ...(change.entityType ? { entityType: change.entityType } : {}),
          ...(change.entityId ? { entityId: change.entityId } : {}),
          ...(batchId ? { batchId } : {}),
          ...(change.undo ? { inverse: change.undo } : {}),
          ...(change.guard ? { guard: change.guard } : {}),
        });
      }
    }
    return reply(outcome.value);
  } catch (error) {
    const refused = error instanceof Refusal;
    const message = refused
      ? (error as Error).message
      : error instanceof Error && /Error$/.test(error.name) && error.name !== 'Error'
        ? error.message
        : 'Something went wrong in LOWTIDE';
    audit(refused ? 'refused' : 'error', { message });
    return fail(message);
  }
}

function reply(value: unknown): ToolResult {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

/** How many things a bulk call touches (its longest list argument). */
function countItems(args: Args): number {
  return Math.max(0, ...Object.values(args).map((v) => (Array.isArray(v) ? v.length : 0)));
}

async function readAll(services: ToolServices): Promise<BackupData> {
  const repos = createRepositories(services.store, { watch: services.store.watch });
  return (await repos.backup.exportBackup()).data;
}
