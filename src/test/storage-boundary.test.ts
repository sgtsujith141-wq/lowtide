// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/*
 * Proves the ESLint storage boundary (eslint.config.js) actually fires: probe
 * sources are linted as if they lived at the given paths. Nothing is written
 * to disk.
 */

const eslint = new ESLint();

async function boundaryErrors(filePath: string, code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.filter((m) => m.ruleId === 'no-restricted-imports').length ?? 0;
}

describe('storage boundary lint rule', () => {
  it.each([
    ['import { openDatabase } from "../../db/database";', 'the concrete database'],
    ['import { LowtideDatabase } from "../../db/database.ts";', 'the database with extension'],
    ['export { openDatabase } from "../../db/database";', 'a re-export of the database'],
    ['import { taskSchema } from "../../db/schema";', 'persistence schemas'],
    [
      'import { createDexieTaskRepository } from "../../db/repositories/dexie-task-repository";',
      'a Dexie repository implementation',
    ],
    ['import { resolveDeps } from "../../db/repositories/shared";', 'repository internals'],
    ['import { Dexie } from "dexie";', 'the dexie package'],
  ])('blocks feature code importing %s (%s)', async (code) => {
    expect(await boundaryErrors('src/features/probe/probe.ts', code)).toBe(1);
  });

  it('blocks components and hooks from the concrete database', async () => {
    const code = 'import { openDatabase } from "../db/database";';
    expect(await boundaryErrors('src/components/Probe.tsx', code)).toBe(1);
    expect(await boundaryErrors('src/hooks/useProbe.ts', code)).toBe(1);
  });

  it('blocks app code from the concrete database', async () => {
    expect(
      await boundaryErrors('src/app/Probe.tsx', 'import { openDatabase } from "../db/database";'),
    ).toBe(1);
  });

  it('allows feature code to use repository interfaces and the hook', async () => {
    const code = [
      'import type { Repositories } from "../../db/repositories";',
      'import { useRepositories } from "../../hooks/useRepositories";',
      'import type { Task } from "../../types/domain";',
    ].join('\n');
    expect(await boundaryErrors('src/features/probe/probe.ts', code)).toBe(0);
  });

  it('allows the composition root, src/db itself and tests to use the database', async () => {
    expect(
      await boundaryErrors('src/main.tsx', 'import { openDatabase } from "./db/database";'),
    ).toBe(0);
    expect(
      await boundaryErrors(
        'src/db/repositories/probe.ts',
        'import { Dexie } from "dexie";\nimport "../database";',
      ),
    ).toBe(0);
    expect(
      await boundaryErrors(
        'src/test/probe.test.ts',
        'import { openDatabase } from "../db/database";',
      ),
    ).toBe(0);
  });
});
