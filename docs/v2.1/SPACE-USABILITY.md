# SPACE usability (v2.1)

SPACE is where pages, folders and databases live. v2.1 makes it obvious where to make
things, where to type, and where things went.

## Making things

- **+ New** at the top of the page tree: Page, Folder, Database, from a template, or
  Import. Each row has its own **+** (Add inside) and a right-click menu (New page /
  folder / database inside, Rename, Pin, Duplicate, Move to…, Export, Archive).
- The global **New** button (rail and phone bar) and **⌘K** create SPACE pages, folders
  and databases next to tasks, projects, hackathons, ideas and decisions. Defaults follow
  where you are.
- **Folders are real folders** (a section without a system key). Opening one shows what
  is inside, grouped (folders, pages, databases), with Page, Folder, Database, Import and
  Export buttons, its name and an optional description.
- **Templates** live in SPACE → LOWTIDE → Templates; any page there can start a new page.
  Seven ship by default: Project Overview, Research Note, Architecture Note, Decision
  Record, Meeting / Session Note, Build Plan and Hackathon Research.

## Writing

- A new page opens with the cursor in an empty title; the body shows "Start writing, or
  press / for blocks". Clicking anywhere below the last block puts the cursor in the page.
- **/** inserts blocks: text, headings, lists, checklist, quote, callout, code, divider,
  simple table, database, sub-page, folder, bookmark, a file reference, and links to a
  page, project, task, milestone, decision or hackathon.
- **[[** links a page inline, and offers to create it if it doesn't exist.
- Bookmarks show a link card; code blocks scroll sideways instead of wrapping.
- Each page has a header: breadcrumbs, title, a one-line description, and a page menu
  (Pin, Duplicate, Move, Export, Archive). History and technical details are folded away
  in the inspector.

## Databases

- Property types: text, number, checkbox, date, select, status, multi-select, URL,
  relation, rollup, formula, and the computed created time, updated time, created by and
  updated by. Changing a type that would lose values is refused with the reason.
- Views: **table, board, list, calendar**, each with saved filters, sorts, grouping,
  hidden and ordered properties.
- Relations link to SPACE pages or LOWTIDE records; rollups count, count done, percent
  done, sum or take the latest; formulas use `prop("Name")` (or `{Name}`), arithmetic,
  comparisons, `and`, `or` and `not`, and `if`, `concat`, `round`, `length`, `empty`,
  `today` and `dateBetween`.
- Boards move cards by drag and drop or a "Move to" list. Large databases draw 50 cards
  per board column (4 per calendar day) with **Show more**, so a 10,000-row database stays
  quick.
- CSV import makes a database; databases export as CSV.

## Finding and keeping things

- **Pinned** pages sit at the top of the tree and on the SPACE home.
- **Search** (⌘K) finds pages by title and text and shows where each one lives with an
  excerpt.
- **Trash**: archived pages and folders wait there to be restored. "Delete forever" asks
  first and says how many pages go with a folder. Only archived things can be deleted.
- **Export** a page or folder as Markdown (a folder becomes a zip); **Import** Markdown,
  text or CSV.
- **How SPACE works** (the ? button) explains all of this in a few lines.

## Phones

The tree opens as a sheet from **Pages**; everything above works at 320 px and up with no
sideways scrolling (checked at 320, 360, 390, 768, 1024, 1440 and 1920 px, dark and
light).

## Known gaps

- The relation picker links pages, not individual database rows.
- Boards group by select or status properties only.
- Sorting from a table header is not saved to the view (View options sorts are).
- Editing a 10,000-row database takes about 1.8 s per change: a table is stored as one
  record, so each change rewrites it.
