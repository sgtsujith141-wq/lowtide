import { SCHEMA_VERSION } from '../../db/repositories';

/** "Database version 3" or "Database version 2, upgraded on import". */
export function describeSourceSchema(version: number): string {
  return version === SCHEMA_VERSION
    ? `Database version ${version}`
    : `Database version ${version}, upgraded on import`;
}
