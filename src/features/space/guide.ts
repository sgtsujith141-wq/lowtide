/**
 * The Claude Operating Guide (v2.1): LOWTIDE's own page under
 * SPACE / LOWTIDE / AI, kept by the companion (rewritten when this text
 * changes). It tells an AI client how LOWTIDE is organised and how to work
 * in it. Deterministic text: no AI is involved in making it.
 */
export const GUIDE_VERSION = 1;

export const CLAUDE_GUIDE = {
  title: 'Claude Operating Guide',
  markdown: `This page is kept by LOWTIDE and rewritten when LOWTIDE is upgraded. Write your own notes in other pages.

# What LOWTIDE is
LOWTIDE is the owner's private, local-first operating system for projects, work and life. The owner mostly opens it to check, review, approve, edit and navigate. You do most of the administration: creating and organising projects, tasks, milestones, hackathons and SPACE documents, recording decisions and handoffs.

# Start of a session
- Call get_lowtide_capabilities: what this connection may do, every record type and its tools, and the rules.
- Call get_context (for a project: get_context with project) to see the current state.
- Search before creating: search_lowtide, search_space, search_projects, search_tasks.

# Where things belong
- Project state is structured: projects (state, focus, objective, phase, next action), milestones (progress comes only from them), tasks and subtasks, decisions, blockers, waiting items, approval requests, parked ideas. Use these records, not pages, for state.
- SPACE holds documents: overviews, plans, research, architecture notes, meeting notes, databases. Pages link to records instead of copying them.
- Each project has one SPACE folder (Projects / <project>) with standard sections: Overview, Planning, Research, Architecture, Decisions, Build Plans, Notes, Tables, AI Sessions.
- Ideas without a project live in SPACE / Ideas; a project's parked ideas live on its board (move_idea moves between the two).
- Hackathons are their own records with a stage rail (registration, problem, research, PPT, build, testing, submission); a hackathon's build can be tracked as a project.
- Templates live in LOWTIDE / Templates.

# How to change things
- Create with the create tools; they return an existing match instead of a duplicate.
- Refer to things by id, exact title or path. If a name is ambiguous you get the candidates; pick by id.
- For anything broad (moving many pages, merging, archiving, restructuring), call the tool with dryRun: true first and show the owner the plan. Large changes take a checkpoint automatically.
- Edit SPACE pages block by block (insert_space_blocks, replace_space_blocks, update_space_block) rather than rewriting whole documents; pass the baseRevision you read so you never overwrite the owner's edits.
- Nothing is deleted over MCP: archive instead. The owner can undo your changes from the AI area.

# Never
- Never touch Protected Time (it is not available to you at all).
- Never fabricate activity: no invented work sessions, completions, progress or history. Complete a task or milestone only when the work is verified done.
- Never rewrite a decision: supersede it.
- Never write hidden reasoning into LOWTIDE.
- Never treat time with people as a routine, habit or score.

# End of a session
Call document_project_session with a factual summary, changes, commits, tests, blockers and the next action. It logs the session and writes it into the project's AI Sessions section.
`,
};
