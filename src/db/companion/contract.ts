import type { Repositories } from '../repositories/types';

/*
 * The repository contract as seen over the wire (ADR-058). The browser's
 * companion client builds its repositories from this list, and the
 * companion's RPC endpoint dispatches with it. A test pins it to the real
 * repository objects, so the two can never drift apart.
 *
 * - 'call': an async method, run on the companion.
 * - 'watch': a live `Watch` property.
 * - 'watchFactory': a method that returns a `Watch`.
 * - 'local': pure, runs in the browser (never sent).
 */
export type MemberKind = 'call' | 'watch' | 'watchFactory' | 'local';

export const REPOSITORY_CONTRACT = {
  tasks: {
    create: 'call',
    get: 'call',
    listOpen: 'call',
    watchOpen: 'watch',
    watchClosed: 'watch',
    update: 'call',
    complete: 'call',
    reopen: 'call',
    drop: 'call',
    setDoing: 'call',
    watchAll: 'watch',
    planFor: 'call',
    removeFromPlan: 'call',
    watchForDay: 'watchFactory',
  },
  inbox: {
    capture: 'call',
    listUnprocessed: 'call',
    watchUnprocessed: 'watch',
    countUnprocessed: 'call',
    convertToTask: 'call',
    markProcessed: 'call',
  },
  protectedTime: {
    create: 'call',
    update: 'call',
    remove: 'call',
    watchForDate: 'watchFactory',
    watchRange: 'watchFactory',
  },
  habits: {
    create: 'call',
    update: 'call',
    archive: 'call',
    restore: 'call',
    watchAll: 'watch',
    setEntry: 'call',
    clearEntry: 'call',
    watchEntries: 'watchFactory',
  },
  hackathons: {
    create: 'call',
    update: 'call',
    archive: 'call',
    restore: 'call',
    setPinned: 'call',
    watchAll: 'watch',
  },
  backup: { exportBackup: 'call', watchCounts: 'watch', inspect: 'local', restore: 'call' },
  projects: {
    create: 'call',
    createFromHackathon: 'call',
    update: 'call',
    setState: 'call',
    setFocus: 'call',
    setPinned: 'call',
    get: 'call',
    watchAll: 'watch',
    watchBySlug: 'watchFactory',
    addMilestone: 'call',
    updateMilestone: 'call',
    completeMilestone: 'call',
    reopenMilestone: 'call',
    moveMilestone: 'call',
    reorderMilestones: 'call',
    removeMilestone: 'call',
    archiveMilestone: 'call',
    restoreMilestone: 'call',
    watchMilestones: 'watchFactory',
    watchArchivedMilestones: 'watchFactory',
    watchAllMilestones: 'watch',
    addItem: 'call',
    updateItem: 'call',
    moveItem: 'call',
    resolveItem: 'call',
    reopenItem: 'call',
    removeItem: 'call',
    watchItems: 'watchFactory',
    watchAllItems: 'watch',
    recordDecision: 'call',
    watchDecisions: 'watchFactory',
    watchAllDecisions: 'watch',
    watchSnapshots: 'watchFactory',
    watchTasks: 'watchFactory',
  },
  work: {
    start: 'call',
    pause: 'call',
    resume: 'call',
    finish: 'call',
    describe: 'call',
    discard: 'call',
    watchActive: 'watch',
    watchRange: 'watchFactory',
    watchForProject: 'watchFactory',
  },
  offTime: {
    start: 'call',
    end: 'call',
    discard: 'call',
    declareDayOff: 'call',
    removeDayOff: 'call',
    watchActive: 'watch',
    watchRange: 'watchFactory',
  },
  events: {
    watchRecent: 'watchFactory',
    watchRange: 'watchFactory',
    watchTimeline: 'watchFactory',
  },
  aiSessions: { record: 'call', watchForProject: 'watchFactory' },
  activity: { watchSources: 'watchFactory' },
  college: { create: 'call', update: 'call', remove: 'call', watchRange: 'watchFactory' },
  notes: { create: 'call', update: 'call', remove: 'call', watchForProject: 'watchFactory' },
  space: {
    get: 'call',
    getByKey: 'call',
    create: 'call',
    update: 'call',
    move: 'call',
    archive: 'call',
    restore: 'call',
    ensureRoots: 'call',
    watchChildren: 'watchFactory',
    watchAll: 'watch',
    watchLinked: 'watchFactory',
    watchSources: 'watchFactory',
    watchProjectSources: 'watchFactory',
    saveContent: 'call',
    appendBlocks: 'call',
    updateBlock: 'call',
    setCell: 'call',
    addRow: 'call',
    addLink: 'call',
    removeLink: 'call',
    duplicate: 'call',
    ensureProjectSpace: 'call',
    updateRow: 'call',
    deleteRow: 'call',
    addColumn: 'call',
    updateColumn: 'call',
    removeColumn: 'call',
    saveView: 'call',
    removeView: 'call',
    insertBlocks: 'call',
    deleteBlocks: 'call',
    moveBlock: 'call',
    replaceBlocks: 'call',
    setPinned: 'call',
    duplicateTree: 'call',
    applyTemplate: 'call',
    ensureSystemPages: 'call',
    deletePermanently: 'call',
  },
} as const satisfies {
  [R in keyof Repositories]: { [M in keyof Repositories[R]]: MemberKind };
};

export type RepoName = keyof typeof REPOSITORY_CONTRACT;

/** A domain error as it crosses the wire. */
export interface WireError {
  name: string;
  message: string;
}

export interface RpcRequest {
  repo: RepoName;
  member: string;
  args: unknown[];
}

export type RpcResponse = { ok: true; value: unknown } | { ok: false; error: WireError };
