import type { Tool } from './kit';

/*
 * Standard MCP tool annotations (v2.3, ADR-074): hints a client may use to
 * decide when to ask its user first. They are never security: LOWTIDE's
 * permission engine decides what a grant may do, whatever a tool claims.
 *
 * - readOnlyHint: the tool changes nothing.
 * - destructiveHint (write tools): true when it may change or remove
 *   existing data (update, move, archive, delete, replace, merge); false
 *   when it only adds (create, append, record, log).
 * - idempotentHint (write tools): calling it again with the same arguments
 *   has no further effect (creates that return the existing match, setting
 *   a value, archiving something archived).
 * - openWorldHint: false for all; LOWTIDE is a closed, local system.
 *
 * Every write tool must appear in exactly one set of each pair (a test
 * checks it), so a new tool can't ship without being classified.
 */

export const ADDITIVE_WRITES: ReadonlySet<string> = new Set([
  'add_project_item',
  'add_space_table_column',
  'add_space_table_row',
  'add_space_table_rows',
  'append_space_blocks',
  'apply_space_template',
  'capture_inbox',
  'create_blocker',
  'create_checkpoint',
  'create_college_item',
  'create_hackathon',
  'create_milestone',
  'create_note',
  'create_project',
  'create_project_from_brief',
  'create_project_workspace',
  'create_routine',
  'create_space_folder',
  'create_space_page',
  'create_space_subpage',
  'create_space_table',
  'create_task',
  'create_waiting',
  'document_project_session',
  'duplicate_space_item',
  'import_space',
  'insert_space_blocks',
  'link_space_entity',
  'log_ai_session',
  'pin_hackathon',
  'pin_project',
  'pin_space_item',
  'record_decision',
  'request_approval',
  'restore_hackathon',
  'restore_milestone',
  'restore_project',
  'restore_routine',
  'restore_space_item',
  'restore_task',
  'supersede_decision',
]);

export const CHANGING_WRITES: ReadonlySet<string> = new Set([
  'archive_hackathon',
  'archive_item',
  'archive_milestone',
  'archive_project',
  'archive_routine',
  'archive_space_item',
  'archive_space_items',
  'archive_space_page',
  'archive_task',
  'cancel_approval',
  'clear_routine_log',
  'complete_milestone',
  'complete_task',
  'delete_space_blocks',
  'delete_space_table_row',
  'link_hackathon_project',
  'log_routine',
  'merge_space_pages',
  'move_idea',
  'move_project_item',
  'move_space_block',
  'move_space_item',
  'move_space_items',
  'move_task',
  'organize_space',
  'park_item',
  'remove_space_table_column',
  'remove_space_view',
  'rename_space_item',
  'reopen_milestone',
  'reopen_task',
  'reorder_milestones',
  'reorder_space_item',
  'replace_space_blocks',
  'resolve_approval',
  'resolve_blocker',
  'resolve_waiting',
  'resume_item',
  'save_space_view',
  'unlink_space_entity',
  'update_college_item',
  'update_hackathon',
  'update_hackathon_stage',
  'update_milestone',
  'update_project',
  'update_project_item',
  'update_routine',
  'update_space_block',
  'update_space_table',
  'update_space_table_column',
  'update_space_table_row',
  'update_task',
  'update_tasks',
  'write_space_page',
]);

export const IDEMPOTENT_WRITES: ReadonlySet<string> = new Set([
  'archive_hackathon',
  'archive_item',
  'archive_milestone',
  'archive_project',
  'archive_routine',
  'archive_space_item',
  'archive_space_items',
  'archive_space_page',
  'archive_task',
  'cancel_approval',
  'clear_routine_log',
  'complete_milestone',
  'complete_task',
  'create_hackathon',
  'create_milestone',
  'create_project',
  'create_project_workspace',
  'create_space_folder',
  'create_space_table',
  'create_task',
  'link_hackathon_project',
  'link_space_entity',
  'log_routine',
  'move_idea',
  'move_project_item',
  'move_space_item',
  'move_space_items',
  'move_task',
  'pin_hackathon',
  'pin_project',
  'pin_space_item',
  'rename_space_item',
  'reopen_milestone',
  'reopen_task',
  'reorder_milestones',
  'reorder_space_item',
  'resolve_approval',
  'resolve_blocker',
  'resolve_waiting',
  'restore_hackathon',
  'restore_milestone',
  'restore_project',
  'restore_routine',
  'restore_space_item',
  'restore_task',
  'resume_item',
  'save_space_view',
  'unlink_space_entity',
  'update_college_item',
  'update_hackathon',
  'update_hackathon_stage',
  'update_milestone',
  'update_project',
  'update_project_item',
  'update_routine',
  'update_space_block',
  'update_space_table',
  'update_space_table_column',
  'update_space_table_row',
  'update_task',
  'update_tasks',
]);

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export function annotationsFor(tool: Pick<Tool, 'name' | 'title' | 'write'>): ToolAnnotations {
  if (!tool.write) {
    return {
      title: tool.title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
  }
  return {
    title: tool.title,
    readOnlyHint: false,
    // Unknown write tools count as destructive and not idempotent (the MCP defaults).
    destructiveHint: !ADDITIVE_WRITES.has(tool.name),
    idempotentHint: IDEMPOTENT_WRITES.has(tool.name),
    openWorldHint: false,
  };
}
