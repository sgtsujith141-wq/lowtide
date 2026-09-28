/*
 * Browser persistent-storage status (ADR-034). Reading never prompts; asking
 * happens only from an explicit user action. Persistence lowers the chance of
 * the browser evicting data under storage pressure. It does not survive
 * clearing site data, deleting the profile, or losing the device.
 */

export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

const browserStorage = (): StorageManagerLike | undefined =>
  typeof navigator === 'undefined'
    ? undefined
    : (navigator.storage as StorageManagerLike | undefined);

export type PersistenceState = 'persistent' | 'not-persistent' | 'unsupported';
export type PersistenceRequest = 'granted' | 'denied' | 'unsupported';

export async function readPersistence(storage = browserStorage()): Promise<PersistenceState> {
  if (typeof storage?.persisted !== 'function') return 'unsupported';
  try {
    return (await storage.persisted()) ? 'persistent' : 'not-persistent';
  } catch {
    return 'unsupported';
  }
}

export async function requestPersistence(storage = browserStorage()): Promise<PersistenceRequest> {
  if (typeof storage?.persist !== 'function') return 'unsupported';
  try {
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
