import { createContext, useContext } from 'react';
import type { Id } from '../../types/domain';

/** What the global New menu can make (v2.1). */
export const CREATE_KINDS = [
  'task',
  'project',
  'page',
  'folder',
  'database',
  'hackathon',
  'idea',
  'decision',
] as const;
export type CreateKind = (typeof CREATE_KINDS)[number];

export const CREATE_LABEL: Record<CreateKind, string> = {
  task: 'Task',
  project: 'Project',
  page: 'SPACE page',
  folder: 'SPACE folder',
  database: 'SPACE database',
  hackathon: 'Hackathon',
  idea: 'Idea',
  decision: 'Decision',
};

/** Starting values a caller can pass (a page's own project, a folder…). */
export interface CreateDefaults {
  projectId?: Id;
  /** Where a SPACE page, folder or database goes. */
  parentId?: Id;
  title?: string;
}

export interface CreateApi {
  openCreate(kind: CreateKind, defaults?: CreateDefaults): void;
}

export const CreateContext = createContext<CreateApi>({ openCreate: () => undefined });

export const useCreate = () => useContext(CreateContext);
