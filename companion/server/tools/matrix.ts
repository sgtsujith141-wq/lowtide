/*
 * The AI/UI capability matrix (v2.1): for every kind of record, what the
 * owner can do in the app and which MCP tool does the same, or why it is
 * intentionally restricted. One source for get_lowtide_capabilities, the
 * docs and a test that every named tool exists.
 */

export const OPS = ['read', 'create', 'update', 'move', 'archive', 'delete'] as const;
export type Op = (typeof OPS)[number];

/** A tool name (or several), or a restriction with its reason. */
export type McpCell = string | string[] | { restricted: string };

export interface MatrixRow {
  entity: string;
  /** Where the owner does it in the app ('—': not something that applies). */
  ui: Partial<Record<Op, string>>;
  mcp: Partial<Record<Op, McpCell>>;
}

const NO_DELETE = { restricted: 'Archived, never deleted over MCP (the owner can restore).' };
const NOT_APPLICABLE = '—';

export const MATRIX: MatrixRow[] = [
  {
    entity: 'Projects',
    ui: {
      read: 'Projects, Command Room',
      create: 'Projects → New project; ⌘K; New',
      update: 'Command Room',
      move: NOT_APPLICABLE,
      archive: 'Command Room state',
      delete: NOT_APPLICABLE,
    },
    mcp: {
      read: ['get_project', 'search_projects', 'get_project_summary', 'get_context'],
      create: ['create_project', 'create_project_from_brief'],
      update: ['update_project', 'pin_project', 'create_project_workspace'],
      move: { restricted: 'Projects have no place to move to.' },
      archive: ['archive_project', 'restore_project'],
      delete: {
        restricted:
          'Projects are archived, never deleted (permanent deletion is off for AI clients).',
      },
    },
  },
  {
    entity: 'Tasks',
    ui: {
      read: 'Tasks, Today, Command Room',
      create: 'Tasks → Add; Command Room; ⌘K; New',
      update: 'Task editor',
      move: 'Task editor (project, milestone)',
      archive: 'Drop',
      delete: NOT_APPLICABLE,
    },
    mcp: {
      read: ['get_task', 'get_tasks', 'search_tasks'],
      create: 'create_task',
      update: ['update_task', 'update_tasks', 'complete_task', 'reopen_task'],
      move: 'move_task',
      archive: ['archive_task', 'restore_task'],
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Subtasks',
    ui: {
      read: 'Task editor',
      create: 'Task editor → Add subtask',
      update: 'Task editor',
      move: 'Task editor (parent)',
      archive: 'Drop',
      delete: NOT_APPLICABLE,
    },
    mcp: {
      read: 'get_task',
      create: 'create_task (parent)',
      update: 'update_task',
      move: ['update_task (parent)', 'move_task'],
      archive: 'archive_task',
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Milestones',
    ui: {
      read: 'Command Room roadmap',
      create: 'Roadmap → Add milestone',
      update: 'Roadmap',
      move: 'Roadmap reorder',
      archive: 'Roadmap → Archive',
      delete: 'Roadmap (unused milestones)',
    },
    mcp: {
      read: 'get_milestones',
      create: 'create_milestone',
      update: ['update_milestone', 'complete_milestone', 'reopen_milestone'],
      move: 'reorder_milestones',
      archive: ['archive_milestone', 'restore_milestone'],
      delete: {
        restricted: 'Archive instead; a milestone you just created can be undone from the AI area.',
      },
    },
  },
  {
    entity: 'Decisions',
    ui: {
      read: 'Command Room → Decisions',
      create: 'Record decision',
      update: 'Supersede',
      move: NOT_APPLICABLE,
      archive: NOT_APPLICABLE,
      delete: NOT_APPLICABLE,
    },
    mcp: {
      read: ['get_decisions', 'get_decision', 'search_decisions'],
      create: 'record_decision',
      update: 'supersede_decision',
      move: { restricted: 'A decision belongs to its project.' },
      archive: { restricted: 'Decisions are immutable history; supersede instead.' },
      delete: { restricted: 'Decisions are immutable history.' },
    },
  },
  {
    entity: 'Approvals',
    ui: {
      read: 'Home → Needs you; Command Room',
      create: 'Command Room',
      update: 'Resolve',
      move: NOT_APPLICABLE,
      archive: 'Resolve',
      delete: 'Remove',
    },
    mcp: {
      read: 'get_approval_requests',
      create: 'request_approval',
      update: ['resolve_approval (with approvals.resolve)', 'update_project_item'],
      archive: 'resolve_approval',
      delete: 'cancel_approval',
    },
  },
  {
    entity: 'Blockers',
    ui: {
      read: 'Command Room; Needs you',
      create: 'Command Room',
      update: 'Command Room',
      archive: 'Resolve',
      delete: 'Remove',
    },
    mcp: {
      read: 'get_blockers',
      create: 'create_blocker',
      update: ['update_project_item', 'resolve_blocker'],
      archive: 'resolve_blocker',
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Waiting items',
    ui: {
      read: 'Command Room',
      create: 'Command Room',
      update: 'Command Room',
      move: 'Lanes',
      archive: 'Resolve',
      delete: 'Remove',
    },
    mcp: {
      read: 'get_waiting',
      create: 'create_waiting',
      update: 'update_project_item',
      move: 'move_project_item',
      archive: 'resolve_waiting',
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Parked items',
    ui: {
      read: 'Command Room',
      create: 'Command Room',
      update: 'Command Room',
      move: 'Lanes',
      archive: 'Resolve',
      delete: 'Remove',
    },
    mcp: {
      read: 'get_parked',
      create: 'park_item',
      update: ['update_project_item', 'resume_item'],
      move: ['move_project_item', 'move_idea'],
      archive: 'archive_item',
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Ideas',
    ui: {
      read: 'SPACE → Ideas; Command Room',
      create: 'SPACE → New page in Ideas; ⌘K',
      update: 'Editor',
      move: 'Drag in the tree',
      archive: 'Archive',
      delete: 'Trash → Delete forever',
    },
    mcp: {
      read: ['get_space_tree', 'get_parked'],
      create: ['create_space_page', 'park_item'],
      update: 'insert_space_blocks',
      move: ['move_space_item', 'move_idea'],
      archive: ['archive_space_item', 'archive_item'],
      delete: NO_DELETE,
    },
  },
  {
    entity: 'SPACE pages',
    ui: {
      read: 'SPACE',
      create: '+ New → Page; tree +; ⌘K',
      update: 'Editor',
      move: 'Drag; Move to…',
      archive: 'Archive',
      delete: 'Trash → Delete forever',
    },
    mcp: {
      read: ['get_space_page', 'search_space', 'get_backlinks', 'export_space'],
      create: ['create_space_page', 'create_space_subpage', 'apply_space_template', 'import_space'],
      update: [
        'rename_space_item',
        'write_space_page',
        'insert_space_blocks',
        'link_space_entity',
        'unlink_space_entity',
        'pin_space_item',
      ],
      move: [
        'move_space_item',
        'reorder_space_item',
        'move_space_items',
        'duplicate_space_item',
        'merge_space_pages',
      ],
      archive: ['archive_space_item', 'restore_space_item', 'archive_space_items'],
      delete: { restricted: 'Permanent deletion is the owner’s, in SPACE → Trash.' },
    },
  },
  {
    entity: 'SPACE folders',
    ui: {
      read: 'SPACE',
      create: '+ New → Folder; tree +',
      update: 'Rename',
      move: 'Drag; Move to…',
      archive: 'Archive',
      delete: 'Trash → Delete forever',
    },
    mcp: {
      read: 'get_space_tree',
      create: 'create_space_folder',
      update: ['rename_space_item', 'pin_space_item'],
      move: ['move_space_item', 'reorder_space_item', 'organize_space', 'duplicate_space_item'],
      archive: ['archive_space_item', 'restore_space_item'],
      delete: { restricted: 'Permanent deletion is the owner’s, in SPACE → Trash.' },
    },
  },
  {
    entity: 'SPACE blocks',
    ui: {
      read: 'Editor',
      create: 'Type; / menu',
      update: 'Editor',
      move: 'Block menu ↑ ↓; drag',
      archive: NOT_APPLICABLE,
      delete: 'Block menu → Delete',
    },
    mcp: {
      read: 'get_space_page',
      create: ['append_space_blocks', 'insert_space_blocks'],
      update: ['update_space_block', 'replace_space_blocks', 'write_space_page'],
      move: 'move_space_block',
      delete: 'delete_space_blocks',
    },
  },
  {
    entity: 'SPACE databases',
    ui: {
      read: 'SPACE',
      create: '+ New → Database; /database',
      update: 'Database header, property menus',
      move: 'Drag; Move to…',
      archive: 'Archive',
      delete: 'Trash → Delete forever',
    },
    mcp: {
      read: ['get_space_page', 'query_space_table', 'export_space'],
      create: ['create_space_table', 'import_space', 'apply_space_template'],
      update: [
        'update_space_table',
        'add_space_table_column',
        'update_space_table_column',
        'remove_space_table_column',
        'save_space_view',
        'remove_space_view',
      ],
      move: 'move_space_item',
      archive: ['archive_space_item', 'restore_space_item'],
      delete: { restricted: 'Permanent deletion is the owner’s, in SPACE → Trash.' },
    },
  },
  {
    entity: 'SPACE database rows',
    ui: {
      read: 'Database views',
      create: 'Add row',
      update: 'Edit cells',
      move: NOT_APPLICABLE,
      archive: NOT_APPLICABLE,
      delete: 'Row menu → Delete',
    },
    mcp: {
      read: 'query_space_table',
      create: ['add_space_table_row', 'add_space_table_rows'],
      update: 'update_space_table_row',
      move: { restricted: 'Rows are ordered by views, not moved.' },
      delete: 'delete_space_table_row',
    },
  },
  {
    entity: 'Hackathons',
    ui: {
      read: 'Hackathons',
      create: 'Hackathons → New hackathon; ⌘K; New',
      update: 'Hackathon sheet',
      archive: 'Hackathon sheet → Archive',
      delete: NOT_APPLICABLE,
    },
    mcp: {
      read: 'get_hackathons',
      create: 'create_hackathon',
      update: ['update_hackathon', 'link_hackathon_project', 'pin_hackathon'],
      move: { restricted: 'Hackathons have no place to move to.' },
      archive: ['archive_hackathon', 'restore_hackathon'],
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Hackathon stages',
    ui: { read: 'Stage rail', update: 'Hackathon sheet statuses' },
    mcp: { read: 'get_hackathons', update: 'update_hackathon_stage' },
  },
  {
    entity: 'Work sessions',
    ui: {
      read: 'Rhythm, Command Room, Home',
      create: 'Start Work',
      update: 'Pause / Resume / Finish; note',
      delete: 'Discard a mistaken session',
    },
    mcp: {
      read: ['get_recent_activity', 'get_context'],
      create: { restricted: 'Only the owner starts real work; AI clients never create work time.' },
      update: { restricted: 'Work time is the owner’s own record.' },
      delete: { restricted: 'Work time is the owner’s own record.' },
    },
  },
  {
    entity: 'AI sessions',
    ui: { read: 'Command Room → AI; AI area' },
    mcp: {
      read: 'get_recent_activity',
      create: ['log_ai_session', 'document_project_session'],
      update: { restricted: 'A logged session is a record of what happened.' },
    },
  },
  {
    entity: 'Notes',
    ui: { read: 'Command Room → Docs; workspace', create: 'Docs', update: 'Docs', delete: 'Docs' },
    mcp: {
      read: ['get_document', 'search_workspace'],
      create: 'create_note',
      update: { restricted: 'Use SPACE pages for living documents.' },
      delete: { restricted: 'Notes are kept.' },
    },
  },
  {
    entity: 'Project links',
    ui: { read: 'Command Room', update: 'Command Room (repository link)' },
    mcp: { read: 'get_project', update: 'update_project (repoUrl)' },
  },
  {
    entity: 'Entity relations',
    ui: {
      read: 'Inspector: links and backlinks',
      create: 'Inspector → Link; relation properties',
      delete: 'Inspector → Unlink',
    },
    mcp: {
      read: 'get_backlinks',
      create: ['link_space_entity', 'add_space_table_rows (relations)'],
      delete: 'unlink_space_entity',
    },
  },
  {
    entity: 'Routine definitions',
    ui: {
      read: 'Life, Rhythm',
      create: 'New personal routine / gym type',
      update: 'Routine settings',
      archive: 'Archive',
    },
    mcp: {
      read: 'get_routines',
      create: 'create_routine',
      update: 'update_routine',
      archive: ['archive_routine', 'restore_routine'],
      delete: NO_DELETE,
    },
  },
  {
    entity: 'Routine logs',
    ui: { read: 'Life, Rhythm', create: 'Tap / stepper', update: 'Stepper', delete: 'Clear' },
    mcp: {
      read: 'get_routines',
      create: 'log_routine',
      update: 'log_routine',
      delete: 'clear_routine_log',
    },
  },
  {
    entity: 'Gym entries',
    ui: { read: 'Life → Gym', create: 'Log session', delete: 'Clear' },
    mcp: {
      read: 'get_routines',
      create: 'log_routine (a fitness routine)',
      delete: 'clear_routine_log',
    },
  },
  {
    entity: 'College entries',
    ui: {
      read: 'Life → College, Calendar',
      create: 'Add class, lab, assignment or event',
      update: 'Attended / missed / done',
      delete: 'Remove',
    },
    mcp: {
      read: 'get_college',
      create: 'create_college_item',
      update: 'update_college_item',
      delete: { restricted: 'Mark it cancelled instead.' },
    },
  },
  {
    entity: 'Calendar items',
    ui: { read: 'Calendar (derived)' },
    mcp: {
      read: ['get_hackathons', 'get_milestones', 'get_tasks', 'get_college'],
      create: { restricted: 'The calendar shows records with dates; create the record itself.' },
    },
  },
  {
    entity: 'Files / references',
    ui: { read: 'Editor', create: 'File reference, bookmark block' },
    mcp: {
      read: 'get_space_page',
      create: 'insert_space_blocks (Markdown links)',
      delete: 'delete_space_blocks',
    },
  },
  {
    entity: 'Protected Time',
    ui: { read: 'Today', create: 'Today', update: 'Today', delete: 'Today' },
    mcp: {
      read: { restricted: 'Never available to any AI client.' },
      create: { restricted: 'Never available to any AI client.' },
      update: { restricted: 'Never available to any AI client.' },
      delete: { restricted: 'Never available to any AI client.' },
    },
  },
];

/** Every tool name the matrix mentions (for the test that they exist). */
export function matrixTools(): string[] {
  const names = new Set<string>();
  for (const row of MATRIX) {
    for (const cell of Object.values(row.mcp)) {
      if (typeof cell === 'string') names.add(cell.split(' ')[0]!);
      else if (Array.isArray(cell)) for (const c of cell) names.add(c.split(' ')[0]!);
    }
  }
  return [...names];
}
