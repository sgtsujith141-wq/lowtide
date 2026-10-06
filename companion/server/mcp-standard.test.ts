// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITIES, PRESET } from '../../src/db/companion/wire';
import { SCHEMA_VERSION } from '../../src/db/schema';
import { LOWTIDE_VERSION } from '../../src/lib/version';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';
import { TOOLS } from './tools';
import { ADDITIVE_WRITES, CHANGING_WRITES, IDEMPOTENT_WRITES } from './tools/annotations';

/*
 * v2.3 (ADR-074): LOWTIDE as a standard MCP server. Truthful annotations,
 * strict schemas, descriptions that name what a tool needs, concise
 * self-description and one version everywhere.
 */

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

async function full() {
  const t = await startTestCompanion();
  running.push(t);
  const client = await mcpClient(
    t.companion.url,
    await t.grant({
      scope: 'global',
      access: 'write',
      capabilities: PRESET.full.capabilities,
      sensitive: PRESET.full.sensitive,
      preset: 'full',
      label: 'Claude',
      clientKind: 'claude',
    }),
  );
  return { t, client };
}

type Listed = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: string; additionalProperties?: boolean };
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

describe('tool annotations (ADR-074)', () => {
  it('classifies every write tool exactly once, and names only real tools', () => {
    const writes = TOOLS.filter((t) => t.write).map((t) => t.name);
    for (const name of writes) {
      expect(ADDITIVE_WRITES.has(name) !== CHANGING_WRITES.has(name), name).toBe(true);
    }
    const all = new Set(TOOLS.map((t) => t.name));
    const named = [...ADDITIVE_WRITES, ...CHANGING_WRITES, ...IDEMPOTENT_WRITES];
    expect(named.filter((n) => !all.has(n) || !writes.includes(n))).toEqual([]);
  });

  it('lists truthful hints, strict schemas and what each tool needs', async () => {
    const { client } = await full();
    const tools = (await client.request('tools/list')).result!.tools as Listed[];
    const by = new Map(tools.map((x) => [x.name, x]));
    expect(by.get('get_project')!.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(by.get('archive_project')!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(by.get('create_project')!.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(by.get('append_space_blocks')!.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(by.get('write_space_page')!.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: false,
    });
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(tool.title.length, tool.name).toBeGreaterThan(3);
      expect(tool.annotations.title).toBe(tool.title);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      expect(tool.description.length, tool.name).toBeGreaterThan(30);
    }
    expect(by.get('create_project')!.description).toMatch(/Needs projects\.create\.$/);
    expect(by.get('capture_inbox')!.description).toMatch(/Needs life\.write and private inbox\.$/);
  });
});

describe('self-description (ADR-074)', () => {
  it('says which LOWTIDE, schema and server it is, who is connected and what it may do', async () => {
    const { client } = await full();
    const caps = (await client.call('get_lowtide_capabilities')).json as {
      lowtide: { version: string; schemaVersion: number; mcpServer: { version: string } };
      connection: {
        name: string;
        client: string;
        grant: string;
        preset: string;
        allowed: string[];
        notAllowed: string[];
        tools: number;
      };
      entities: Record<string, string>[];
    };
    expect(caps.lowtide).toEqual({
      version: LOWTIDE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      mcpServer: { name: 'lowtide', version: LOWTIDE_VERSION },
    });
    expect(caps.connection).toMatchObject({ name: 'Claude', client: 'claude', preset: 'full' });
    expect(caps.connection.grant).toMatch(/^[0-9a-f-]{36}$/);
    expect(caps.connection.allowed.join(' ')).toMatch(/projects\.create/);
    expect(caps.connection.allowed.length + caps.connection.notAllowed.length).toBe(
      CAPABILITIES.length,
    );
    expect(caps.connection.tools).toBeGreaterThan(100);
    const protectedTime = caps.entities.find((e) => e.entity === 'Protected Time')!;
    expect(protectedTime.read).toMatch(/Never available/);
    // Concise: well under the size of the old verbose answer.
    expect(JSON.stringify(caps).length).toBeLessThan(20_000);
  });

  it('tells a model LOWTIDE’s working rules when it connects', async () => {
    const { client } = await full();
    const text = client.initialize.result!.instructions as string;
    expect(text).toMatch(/canonical personal operating system/);
    expect(text).toMatch(/Search before creating/);
    expect(text).toMatch(/Never fabricate work sessions/);
    expect(text).toMatch(/Protected Time is never available/);
    expect(text).toMatch(/SPACE for plans, documents, research/);
    expect(client.initialize.result!.serverInfo).toMatchObject({
      name: 'lowtide',
      version: LOWTIDE_VERSION,
    });
  });

  it('keeps one version: package.json and LOWTIDE_VERSION agree', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      version: string;
    };
    expect(pkg.version).toBe(LOWTIDE_VERSION);
  });
});
