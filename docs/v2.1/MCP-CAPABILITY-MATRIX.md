# MCP capability matrix (v2.1)

_Generated from `companion/server/tools/matrix.ts` and the tool registry; a test checks that every tool named here exists. `get_lowtide_capabilities` returns the same matrix to a connected client, filtered by its grant._

Every operation the owner can do in the app has an MCP tool, or is **intentionally restricted** with the reason given. Empty cells are operations that do not apply to that kind of record.

## Projects

| Operation | In the app                      | Over MCP                                                                                         |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| read      | Projects, Command Room          | `get_project`, `search_projects`, `get_project_summary`, `get_context`                           |
| create    | Projects → New project; ⌘K; New | `create_project`, `create_project_from_brief`                                                    |
| update    | Command Room                    | `update_project`, `pin_project`, `create_project_workspace`                                      |
| move      | —                               | **Restricted:** Projects have no place to move to.                                               |
| archive   | Command Room state              | `archive_project`, `restore_project`                                                             |
| delete    | —                               | **Restricted:** Projects are archived, never deleted (permanent deletion is off for AI clients). |

## Tasks

| Operation | In the app                         | Over MCP                                                                  |
| --------- | ---------------------------------- | ------------------------------------------------------------------------- |
| read      | Tasks, Today, Command Room         | `get_task`, `get_tasks`, `search_tasks`                                   |
| create    | Tasks → Add; Command Room; ⌘K; New | `create_task`                                                             |
| update    | Task editor                        | `update_task`, `update_tasks`, `complete_task`, `reopen_task`             |
| move      | Task editor (project, milestone)   | `move_task`                                                               |
| archive   | Drop                               | `archive_task`, `restore_task`                                            |
| delete    | —                                  | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Subtasks

| Operation | In the app                | Over MCP                                                                  |
| --------- | ------------------------- | ------------------------------------------------------------------------- |
| read      | Task editor               | `get_task`                                                                |
| create    | Task editor → Add subtask | `create_task` (parent)                                                    |
| update    | Task editor               | `update_task`                                                             |
| move      | Task editor (parent)      | `update_task` (parent), `move_task`                                       |
| archive   | Drop                      | `archive_task`                                                            |
| delete    | —                         | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Milestones

| Operation | In the app                  | Over MCP                                                                                      |
| --------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| read      | Command Room roadmap        | `get_milestones`                                                                              |
| create    | Roadmap → Add milestone     | `create_milestone`                                                                            |
| update    | Roadmap                     | `update_milestone`, `complete_milestone`, `reopen_milestone`                                  |
| move      | Roadmap reorder             | `reorder_milestones`                                                                          |
| archive   | Roadmap → Archive           | `archive_milestone`, `restore_milestone`                                                      |
| delete    | Roadmap (unused milestones) | **Restricted:** Archive instead; a milestone you just created can be undone from the AI area. |

## Decisions

| Operation | In the app               | Over MCP                                                            |
| --------- | ------------------------ | ------------------------------------------------------------------- |
| read      | Command Room → Decisions | `get_decisions`, `get_decision`, `search_decisions`                 |
| create    | Record decision          | `record_decision`                                                   |
| update    | Supersede                | `supersede_decision`                                                |
| move      | —                        | **Restricted:** A decision belongs to its project.                  |
| archive   | —                        | **Restricted:** Decisions are immutable history; supersede instead. |
| delete    | —                        | **Restricted:** Decisions are immutable history.                    |

## Approvals

| Operation | In the app                     | Over MCP                                                           |
| --------- | ------------------------------ | ------------------------------------------------------------------ |
| read      | Home → Needs you; Command Room | `get_approval_requests`                                            |
| create    | Command Room                   | `request_approval`                                                 |
| update    | Resolve                        | `resolve_approval` (with approvals.resolve), `update_project_item` |
| move      | —                              |                                                                    |
| archive   | Resolve                        | `resolve_approval`                                                 |
| delete    | Remove                         | `cancel_approval`                                                  |

## Blockers

| Operation | In the app              | Over MCP                                                                  |
| --------- | ----------------------- | ------------------------------------------------------------------------- |
| read      | Command Room; Needs you | `get_blockers`                                                            |
| create    | Command Room            | `create_blocker`                                                          |
| update    | Command Room            | `update_project_item`, `resolve_blocker`                                  |
| archive   | Resolve                 | `resolve_blocker`                                                         |
| delete    | Remove                  | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Waiting items

| Operation | In the app   | Over MCP                                                                  |
| --------- | ------------ | ------------------------------------------------------------------------- |
| read      | Command Room | `get_waiting`                                                             |
| create    | Command Room | `create_waiting`                                                          |
| update    | Command Room | `update_project_item`                                                     |
| move      | Lanes        | `move_project_item`                                                       |
| archive   | Resolve      | `resolve_waiting`                                                         |
| delete    | Remove       | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Parked items

| Operation | In the app   | Over MCP                                                                  |
| --------- | ------------ | ------------------------------------------------------------------------- |
| read      | Command Room | `get_parked`                                                              |
| create    | Command Room | `park_item`                                                               |
| update    | Command Room | `update_project_item`, `resume_item`                                      |
| move      | Lanes        | `move_project_item`, `move_idea`                                          |
| archive   | Resolve      | `archive_item`                                                            |
| delete    | Remove       | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Ideas

| Operation | In the app                    | Over MCP                                                                  |
| --------- | ----------------------------- | ------------------------------------------------------------------------- |
| read      | SPACE → Ideas; Command Room   | `get_space_tree`, `get_parked`                                            |
| create    | SPACE → New page in Ideas; ⌘K | `create_space_page`, `park_item`                                          |
| update    | Editor                        | `insert_space_blocks`                                                     |
| move      | Drag in the tree              | `move_space_item`, `move_idea`                                            |
| archive   | Archive                       | `archive_space_item`, `archive_item`                                      |
| delete    | Trash → Delete forever        | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## SPACE pages

| Operation | In the app               | Over MCP                                                                                                                     |
| --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| read      | SPACE                    | `get_space_page`, `search_space`, `get_backlinks`, `export_space`                                                            |
| create    | + New → Page; tree +; ⌘K | `create_space_page`, `create_space_subpage`, `apply_space_template`, `import_space`                                          |
| update    | Editor                   | `rename_space_item`, `write_space_page`, `insert_space_blocks`, `link_space_entity`, `unlink_space_entity`, `pin_space_item` |
| move      | Drag; Move to…           | `move_space_item`, `reorder_space_item`, `move_space_items`, `duplicate_space_item`, `merge_space_pages`                     |
| archive   | Archive                  | `archive_space_item`, `restore_space_item`, `archive_space_items`                                                            |
| delete    | Trash → Delete forever   | **Restricted:** Permanent deletion is the owner’s, in SPACE → Trash.                                                         |

## SPACE folders

| Operation | In the app             | Over MCP                                                                          |
| --------- | ---------------------- | --------------------------------------------------------------------------------- |
| read      | SPACE                  | `get_space_tree`                                                                  |
| create    | + New → Folder; tree + | `create_space_folder`                                                             |
| update    | Rename                 | `rename_space_item`, `pin_space_item`                                             |
| move      | Drag; Move to…         | `move_space_item`, `reorder_space_item`, `organize_space`, `duplicate_space_item` |
| archive   | Archive                | `archive_space_item`, `restore_space_item`                                        |
| delete    | Trash → Delete forever | **Restricted:** Permanent deletion is the owner’s, in SPACE → Trash.              |

## SPACE blocks

| Operation | In the app           | Over MCP                                                         |
| --------- | -------------------- | ---------------------------------------------------------------- |
| read      | Editor               | `get_space_page`                                                 |
| create    | Type; / menu         | `append_space_blocks`, `insert_space_blocks`                     |
| update    | Editor               | `update_space_block`, `replace_space_blocks`, `write_space_page` |
| move      | Block menu ↑ ↓; drag | `move_space_block`                                               |
| archive   | —                    |                                                                  |
| delete    | Block menu → Delete  | `delete_space_blocks`                                            |

## SPACE databases

| Operation | In the app                      | Over MCP                                                                                                                                         |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| read      | SPACE                           | `get_space_page`, `query_space_table`, `export_space`                                                                                            |
| create    | + New → Database; /database     | `create_space_table`, `import_space`, `apply_space_template`                                                                                     |
| update    | Database header, property menus | `update_space_table`, `add_space_table_column`, `update_space_table_column`, `remove_space_table_column`, `save_space_view`, `remove_space_view` |
| move      | Drag; Move to…                  | `move_space_item`                                                                                                                                |
| archive   | Archive                         | `archive_space_item`, `restore_space_item`                                                                                                       |
| delete    | Trash → Delete forever          | **Restricted:** Permanent deletion is the owner’s, in SPACE → Trash.                                                                             |

## SPACE database rows

| Operation | In the app        | Over MCP                                              |
| --------- | ----------------- | ----------------------------------------------------- |
| read      | Database views    | `query_space_table`                                   |
| create    | Add row           | `add_space_table_row`, `add_space_table_rows`         |
| update    | Edit cells        | `update_space_table_row`                              |
| move      | —                 | **Restricted:** Rows are ordered by views, not moved. |
| archive   | —                 |                                                       |
| delete    | Row menu → Delete | `delete_space_table_row`                              |

## Hackathons

| Operation | In the app                          | Over MCP                                                                  |
| --------- | ----------------------------------- | ------------------------------------------------------------------------- |
| read      | Hackathons                          | `get_hackathons`                                                          |
| create    | Hackathons → New hackathon; ⌘K; New | `create_hackathon`                                                        |
| update    | Hackathon sheet                     | `update_hackathon`, `link_hackathon_project`, `pin_hackathon`             |
| move      |                                     | **Restricted:** Hackathons have no place to move to.                      |
| archive   | Hackathon sheet → Archive           | `archive_hackathon`, `restore_hackathon`                                  |
| delete    | —                                   | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Hackathon stages

| Operation | In the app               | Over MCP                 |
| --------- | ------------------------ | ------------------------ |
| read      | Stage rail               | `get_hackathons`         |
| update    | Hackathon sheet statuses | `update_hackathon_stage` |

## Work sessions

| Operation | In the app                    | Over MCP                                                                            |
| --------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| read      | Rhythm, Command Room, Home    | `get_recent_activity`, `get_context`                                                |
| create    | Start Work                    | **Restricted:** Only the owner starts real work; AI clients never create work time. |
| update    | Pause / Resume / Finish; note | **Restricted:** Work time is the owner’s own record.                                |
| delete    | Discard a mistaken session    | **Restricted:** Work time is the owner’s own record.                                |

## AI sessions

| Operation | In the app                 | Over MCP                                                       |
| --------- | -------------------------- | -------------------------------------------------------------- |
| read      | Command Room → AI; AI area | `get_recent_activity`                                          |
| create    |                            | `log_ai_session`, `document_project_session`                   |
| update    |                            | **Restricted:** A logged session is a record of what happened. |

## Notes

| Operation | In the app                     | Over MCP                                              |
| --------- | ------------------------------ | ----------------------------------------------------- |
| read      | Command Room → Docs; workspace | `get_document`, `search_workspace`                    |
| create    | Docs                           | `create_note`                                         |
| update    | Docs                           | **Restricted:** Use SPACE pages for living documents. |
| delete    | Docs                           | **Restricted:** Notes are kept.                       |

## Project links

| Operation | In the app                     | Over MCP                   |
| --------- | ------------------------------ | -------------------------- |
| read      | Command Room                   | `get_project`              |
| update    | Command Room (repository link) | `update_project` (repoUrl) |

## Entity relations

| Operation | In the app                            | Over MCP                                                |
| --------- | ------------------------------------- | ------------------------------------------------------- |
| read      | Inspector: links and backlinks        | `get_backlinks`                                         |
| create    | Inspector → Link; relation properties | `link_space_entity`, `add_space_table_rows` (relations) |
| delete    | Inspector → Unlink                    | `unlink_space_entity`                                   |

## Routine definitions

| Operation | In the app                      | Over MCP                                                                  |
| --------- | ------------------------------- | ------------------------------------------------------------------------- |
| read      | Life, Rhythm                    | `get_routines`                                                            |
| create    | New personal routine / gym type | `create_routine`                                                          |
| update    | Routine settings                | `update_routine`                                                          |
| archive   | Archive                         | `archive_routine`, `restore_routine`                                      |
| delete    |                                 | **Restricted:** Archived, never deleted over MCP (the owner can restore). |

## Routine logs

| Operation | In the app    | Over MCP            |
| --------- | ------------- | ------------------- |
| read      | Life, Rhythm  | `get_routines`      |
| create    | Tap / stepper | `log_routine`       |
| update    | Stepper       | `log_routine`       |
| delete    | Clear         | `clear_routine_log` |

## Gym entries

| Operation | In the app  | Over MCP                          |
| --------- | ----------- | --------------------------------- |
| read      | Life → Gym  | `get_routines`                    |
| create    | Log session | `log_routine` (a fitness routine) |
| delete    | Clear       | `clear_routine_log`               |

## College entries

| Operation | In the app                          | Over MCP                                   |
| --------- | ----------------------------------- | ------------------------------------------ |
| read      | Life → College, Calendar            | `get_college`                              |
| create    | Add class, lab, assignment or event | `create_college_item`                      |
| update    | Attended / missed / done            | `update_college_item`                      |
| delete    | Remove                              | **Restricted:** Mark it cancelled instead. |

## Calendar items

| Operation | In the app         | Over MCP                                                                         |
| --------- | ------------------ | -------------------------------------------------------------------------------- |
| read      | Calendar (derived) | `get_hackathons`, `get_milestones`, `get_tasks`, `get_college`                   |
| create    |                    | **Restricted:** The calendar shows records with dates; create the record itself. |

## Files / references

| Operation | In the app                     | Over MCP                               |
| --------- | ------------------------------ | -------------------------------------- |
| read      | Editor                         | `get_space_page`                       |
| create    | File reference, bookmark block | `insert_space_blocks` (Markdown links) |
| delete    |                                | `delete_space_blocks`                  |

## Protected Time

| Operation | In the app | Over MCP                                          |
| --------- | ---------- | ------------------------------------------------- |
| read      | Today      | **Restricted:** Never available to any AI client. |
| create    | Today      | **Restricted:** Never available to any AI client. |
| update    | Today      | **Restricted:** Never available to any AI client. |
| delete    | Today      | **Restricted:** Never available to any AI client. |

## Tools by capability

127 tools. A grant sees only the tools its capabilities allow; asking for another returns `Cannot <action>. Grant lacks <capability>.`

| Tool                        | Capability                            | Writes | Dry run | Checkpoint first |
| --------------------------- | ------------------------------------- | ------ | ------- | ---------------- |
| `get_college`               | any grant (answers within its access) |        |         |                  |
| `get_inbox`                 | any grant (answers within its access) |        |         |                  |
| `get_lowtide_capabilities`  | any grant (answers within its access) |        |         |                  |
| `get_my_changes`            | any grant (answers within its access) |        |         |                  |
| `get_routines`              | any grant (answers within its access) |        |         |                  |
| `search_lowtide`            | any grant (answers within its access) |        |         |                  |
| `resolve_approval`          | approvals.resolve                     | yes    |         |                  |
| `get_decision`              | decisions.read                        |        |         |                  |
| `get_decisions`             | decisions.read                        |        |         |                  |
| `search_decisions`          | decisions.read                        |        |         |                  |
| `record_decision`           | decisions.write                       | yes    |         |                  |
| `supersede_decision`        | decisions.write                       | yes    |         |                  |
| `get_hackathons`            | hackathons.read                       |        |         |                  |
| `archive_hackathon`         | hackathons.write                      | yes    |         |                  |
| `create_hackathon`          | hackathons.write                      | yes    | yes     |                  |
| `pin_hackathon`             | hackathons.write                      | yes    |         |                  |
| `restore_hackathon`         | hackathons.write                      | yes    |         |                  |
| `update_hackathon`          | hackathons.write                      | yes    |         |                  |
| `update_hackathon_stage`    | hackathons.write                      | yes    |         |                  |
| `link_hackathon_project`    | hackathons.write + projects.edit      | yes    |         |                  |
| `add_project_item`          | items.edit                            | yes    |         |                  |
| `archive_item`              | items.edit                            | yes    |         |                  |
| `cancel_approval`           | items.edit                            | yes    |         |                  |
| `create_blocker`            | items.edit                            | yes    |         |                  |
| `create_waiting`            | items.edit                            | yes    |         |                  |
| `move_project_item`         | items.edit                            | yes    |         |                  |
| `park_item`                 | items.edit                            | yes    |         |                  |
| `request_approval`          | items.edit                            | yes    |         |                  |
| `resolve_blocker`           | items.edit                            | yes    |         |                  |
| `resolve_waiting`           | items.edit                            | yes    |         |                  |
| `resume_item`               | items.edit                            | yes    |         |                  |
| `update_project_item`       | items.edit                            | yes    |         |                  |
| `move_idea`                 | items.edit + space.write              | yes    |         |                  |
| `archive_routine`           | life.write                            | yes    |         |                  |
| `capture_inbox`             | life.write                            | yes    |         |                  |
| `clear_routine_log`         | life.write                            | yes    |         |                  |
| `create_college_item`       | life.write                            | yes    |         |                  |
| `create_routine`            | life.write                            | yes    |         |                  |
| `log_routine`               | life.write                            | yes    |         |                  |
| `restore_routine`           | life.write                            | yes    |         |                  |
| `update_college_item`       | life.write                            | yes    |         |                  |
| `update_routine`            | life.write                            | yes    |         |                  |
| `archive_milestone`         | milestones.edit                       | yes    |         |                  |
| `complete_milestone`        | milestones.edit                       | yes    |         |                  |
| `create_milestone`          | milestones.edit                       | yes    | yes     |                  |
| `reopen_milestone`          | milestones.edit                       | yes    |         |                  |
| `reorder_milestones`        | milestones.edit                       | yes    | yes     |                  |
| `restore_milestone`         | milestones.edit                       | yes    |         |                  |
| `update_milestone`          | milestones.edit                       | yes    |         |                  |
| `archive_project`           | projects.archive                      | yes    | yes     |                  |
| `restore_project`           | projects.archive                      | yes    |         |                  |
| `create_project`            | projects.create                       | yes    | yes     |                  |
| `create_project_from_brief` | projects.create + space.write         | yes    | yes     |                  |
| `pin_project`               | projects.edit                         | yes    |         |                  |
| `update_project`            | projects.edit                         | yes    | yes     |                  |
| `create_project_workspace`  | projects.edit + space.structure       | yes    |         |                  |
| `get_approval_requests`     | projects.read                         |        |         |                  |
| `get_blockers`              | projects.read                         |        |         |                  |
| `get_context`               | projects.read                         |        |         |                  |
| `get_document`              | projects.read                         |        |         |                  |
| `get_milestones`            | projects.read                         |        |         |                  |
| `get_parked`                | projects.read                         |        |         |                  |
| `get_project`               | projects.read                         |        |         |                  |
| `get_project_summary`       | projects.read                         |        |         |                  |
| `get_recent_activity`       | projects.read                         |        |         |                  |
| `get_waiting`               | projects.read                         |        |         |                  |
| `search_projects`           | projects.read                         |        |         |                  |
| `search_workspace`          | projects.read                         |        |         |                  |
| `create_checkpoint`         | sessions.log                          | yes    |         |                  |
| `create_note`               | sessions.log                          | yes    |         |                  |
| `log_ai_session`            | sessions.log                          | yes    |         |                  |
| `document_project_session`  | sessions.log + space.write            | yes    |         |                  |
| `archive_space_item`        | space.archive                         | yes    | yes     |                  |
| `archive_space_items`       | space.archive                         | yes    | yes     | ≥ 10 items       |
| `archive_space_page`        | space.archive                         | yes    |         |                  |
| `restore_space_item`        | space.archive                         | yes    |         |                  |
| `export_space`              | space.read                            |        |         |                  |
| `get_backlinks`             | space.read                            |        |         |                  |
| `get_space_page`            | space.read                            |        |         |                  |
| `get_space_tree`            | space.read                            |        |         |                  |
| `list_space_templates`      | space.read                            |        |         |                  |
| `query_space_table`         | space.read                            |        |         |                  |
| `search_space`              | space.read                            |        |         |                  |
| `create_space_folder`       | space.structure                       | yes    |         |                  |
| `duplicate_space_item`      | space.structure                       | yes    |         |                  |
| `move_space_item`           | space.structure                       | yes    | yes     |                  |
| `move_space_items`          | space.structure                       | yes    | yes     | ≥ 10 items       |
| `pin_space_item`            | space.structure                       | yes    |         |                  |
| `rename_space_item`         | space.structure                       | yes    |         |                  |
| `reorder_space_item`        | space.structure                       | yes    |         |                  |
| `organize_space`            | space.structure + space.archive       | yes    | yes     | ≥ 5 items        |
| `add_space_table_column`    | space.write                           | yes    |         |                  |
| `add_space_table_row`       | space.write                           | yes    |         |                  |
| `add_space_table_rows`      | space.write                           | yes    |         |                  |
| `append_space_blocks`       | space.write                           | yes    |         |                  |
| `apply_space_template`      | space.write                           | yes    |         |                  |
| `create_space_page`         | space.write                           | yes    |         |                  |
| `create_space_subpage`      | space.write                           | yes    |         |                  |
| `create_space_table`        | space.write                           | yes    |         |                  |
| `delete_space_blocks`       | space.write                           | yes    |         |                  |
| `delete_space_table_row`    | space.write                           | yes    |         |                  |
| `import_space`              | space.write                           | yes    |         |                  |
| `insert_space_blocks`       | space.write                           | yes    |         |                  |
| `link_space_entity`         | space.write                           | yes    |         |                  |
| `move_space_block`          | space.write                           | yes    |         |                  |
| `remove_space_table_column` | space.write                           | yes    | yes     |                  |
| `remove_space_view`         | space.write                           | yes    |         |                  |
| `replace_space_blocks`      | space.write                           | yes    |         |                  |
| `save_space_view`           | space.write                           | yes    |         |                  |
| `unlink_space_entity`       | space.write                           | yes    |         |                  |
| `update_space_block`        | space.write                           | yes    |         |                  |
| `update_space_table`        | space.write                           | yes    |         |                  |
| `update_space_table_column` | space.write                           | yes    |         |                  |
| `update_space_table_row`    | space.write                           | yes    |         |                  |
| `write_space_page`          | space.write                           | yes    |         |                  |
| `merge_space_pages`         | space.write + space.archive           | yes    | yes     |                  |
| `complete_task`             | tasks.complete                        | yes    |         |                  |
| `reopen_task`               | tasks.complete                        | yes    |         |                  |
| `create_task`               | tasks.create                          | yes    | yes     |                  |
| `archive_task`              | tasks.edit                            | yes    |         |                  |
| `move_task`                 | tasks.edit                            | yes    |         |                  |
| `restore_task`              | tasks.edit                            | yes    |         |                  |
| `update_task`               | tasks.edit                            | yes    | yes     |                  |
| `update_tasks`              | tasks.edit + tasks.complete           | yes    | yes     | ≥ 10 items       |
| `get_task`                  | tasks.read                            |        |         |                  |
| `get_tasks`                 | tasks.read                            |        |         |                  |
| `search_tasks`              | tasks.read                            |        |         |                  |

## Capabilities and presets

| Capability          | Read only | Project operator | Workspace operator | Full LOWTIDE operator |
| ------------------- | :-------: | :--------------: | :----------------: | :-------------------: |
| `projects.read`     |     ✓     |        ✓         |         ✓          |           ✓           |
| `projects.create`   |           |                  |         ✓          |           ✓           |
| `projects.edit`     |           |        ✓         |         ✓          |           ✓           |
| `projects.archive`  |           |                  |         ✓          |           ✓           |
| `tasks.read`        |     ✓     |        ✓         |         ✓          |           ✓           |
| `tasks.create`      |           |        ✓         |         ✓          |           ✓           |
| `tasks.edit`        |           |        ✓         |         ✓          |           ✓           |
| `tasks.complete`    |           |        ✓         |         ✓          |           ✓           |
| `milestones.edit`   |           |        ✓         |         ✓          |           ✓           |
| `items.edit`        |           |        ✓         |         ✓          |           ✓           |
| `approvals.resolve` |           |                  |                    |           ✓           |
| `decisions.read`    |     ✓     |        ✓         |         ✓          |           ✓           |
| `decisions.write`   |           |        ✓         |         ✓          |           ✓           |
| `hackathons.read`   |     ✓     |        ✓         |         ✓          |           ✓           |
| `hackathons.write`  |           |        ✓         |         ✓          |           ✓           |
| `space.read`        |     ✓     |        ✓         |         ✓          |           ✓           |
| `space.write`       |           |        ✓         |         ✓          |           ✓           |
| `space.structure`   |           |        ✓         |         ✓          |           ✓           |
| `space.archive`     |           |        ✓         |         ✓          |           ✓           |
| `sessions.log`      |           |        ✓         |         ✓          |           ✓           |
| `life.write`        |           |                  |                    |           ✓           |
