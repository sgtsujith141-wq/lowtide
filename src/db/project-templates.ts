import type { ProjectKind } from '../types/domain';
import type { ProjectSpaceSlot } from './repositories/types';

/*
 * Project templates (v2.1). A template sets up a project's SPACE folder (the
 * standard sections and a few starting pages) and can suggest milestones.
 * Milestones are only made when asked for, and never come completed: a
 * template gives structure, not progress.
 */

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  kind: ProjectKind;
  /** SPACE sections made in the project's folder, in order. */
  slots: ProjectSpaceSlot[];
  /** Starting pages: [section, title, markdown]. */
  pages: [ProjectSpaceSlot, string, string][];
  /** Suggested milestones, made only when asked for. */
  milestones: string[];
  /** A starting database, if the kind of work needs one. */
  database?: {
    slot: ProjectSpaceSlot;
    title: string;
    columns: {
      name: string;
      type: 'text' | 'status' | 'select' | 'date' | 'url';
      options?: string[];
    }[];
  };
}

const overview = (what: string) =>
  [
    '## What it is',
    what,
    '## Why it matters',
    '- ',
    '## Scope',
    '- In:',
    '- Out:',
    '## Current state',
    'Planning.',
  ].join('\n');

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'software',
    name: 'Software project',
    description: 'Overview, planning, architecture, research and decisions.',
    kind: 'software',
    slots: ['overview', 'planning', 'architecture', 'research', 'decisions'],
    pages: [
      ['overview', 'Overview', overview('One or two sentences on what this builds.')],
      ['planning', 'Plan', '## Goal\n\n## Steps\n- [ ] \n## Risks\n- '],
    ],
    milestones: ['Foundation', 'Core features', 'Polish', 'Launch'],
  },
  {
    id: 'hackathon',
    name: 'Hackathon build',
    description: 'Research, build plan and a fast milestone path to submission.',
    kind: 'software',
    slots: ['overview', 'research', 'build-plans'],
    pages: [
      ['overview', 'Overview', overview('What we are building for the hackathon.')],
      [
        'research',
        'Hackathon Research',
        '## Problem statement\n\n## Judging criteria\n- \n## Ideas\n- \n## Chosen approach\n',
      ],
    ],
    milestones: ['Problem chosen', 'Research done', 'Prototype', 'Submission'],
  },
  {
    id: 'research',
    name: 'Research project',
    description: 'A question, sources, findings and a write-up.',
    kind: 'research',
    slots: ['overview', 'research', 'notes'],
    pages: [
      ['overview', 'Overview', overview('The question this research answers.')],
      ['research', 'Sources', '## Sources\n- \n## Findings\n- '],
    ],
    milestones: ['Question framed', 'Sources gathered', 'Findings', 'Write-up'],
  },
  {
    id: 'content',
    name: 'Content / media system',
    description: 'Formats, a content pipeline database and a publishing plan.',
    kind: 'other',
    slots: ['overview', 'planning', 'research', 'tables'],
    pages: [
      ['overview', 'Overview', overview('What the content is, for whom, and where it goes.')],
      ['planning', 'Publishing plan', '## Cadence\n\n## Channels\n- \n## Formats\n- '],
    ],
    milestones: ['Format defined', 'Pilot published', 'Steady cadence', 'Distribution'],
    database: {
      slot: 'tables',
      title: 'Content pipeline',
      columns: [
        { name: 'Title', type: 'text' },
        { name: 'Status', type: 'status', options: ['Idea', 'Drafting', 'Ready', 'Published'] },
        { name: 'Platform', type: 'select' },
        { name: 'Publish date', type: 'date' },
        { name: 'Link', type: 'url' },
      ],
    },
  },
  {
    id: 'utility',
    name: 'Utility app',
    description: 'A small, focused tool: overview, architecture and a build plan.',
    kind: 'software',
    slots: ['overview', 'architecture', 'build-plans'],
    pages: [
      ['overview', 'Overview', overview('The one job this tool does well.')],
      ['build-plans', 'Build plan', '## MVP\n- [ ] \n## Later\n- '],
    ],
    milestones: ['MVP', 'Beta', 'Release'],
  },
];

export const templateById = (id: string) => PROJECT_TEMPLATES.find((t) => t.id === id);
