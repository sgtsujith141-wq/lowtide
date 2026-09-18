/**
 * LOWTIDE — browser acceptance and regression suite.
 *
 *   node e2e/acceptance.mjs                                   # dev server
 *   E2E_URL=http://localhost:4173/ OFFLINE=1 node e2e/...     # built app + offline
 *
 * Covers the sixteen behaviours the milestone requires, in a real Chromium,
 * through real keyboard and pointer events.
 */
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'

const BASE = process.env.E2E_URL ?? 'http://localhost:5173/'
const CHECK_OFFLINE = process.env.OFFLINE === '1'
const SHOTS = process.env.SHOT_DIR ?? null

let failures = 0
let checks = 0
function check(label, condition, detail = '') {
  checks++
  if (condition) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const step = (name) => console.log(`\n${name}`)

const composerOf = (page) => page.getByRole('textbox', { name: /Write down what is on your mind/ })
const rowFor = (page, text) => page.locator('article').filter({ hasText: text }).first()

const browser = await chromium.launch()
const context = await browser.newContext({ acceptDownloads: true })
// Fail fast: a locator that is not going to appear should not cost 30 seconds.
context.setDefaultTimeout(8000)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

async function shot(name) {
  if (!SHOTS) return
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

try {
  /* ---------------------------------------------------------------- */
  step('1–5. Capture: Enter, Shift+Enter, IME, empty input, focus')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Come on in.' }).waitFor()
  const composer = composerOf(page)
  await composer.click()

  // 1. Enter submits.
  await page.keyboard.type('Need to send my mentor the updated portfolio.')
  await page.keyboard.press('Enter')
  await rowFor(page, 'send my mentor').waitFor({ timeout: 5000 })
  check('1. Enter saves the thought', true)
  check('1b. the composer clears', (await composer.inputValue()) === '')

  // 5. Focus is still in the composer — so the next thought can just be typed.
  check('5. focus returns to the composer', (await page.evaluate(() => document.activeElement?.id)) === 'composer')
  await page.keyboard.type('Had an idea for a new app.')
  await page.keyboard.press('Enter')
  await rowFor(page, 'idea for a new app').waitFor({ timeout: 5000 })
  check('5b. a second thought can be typed straight away (the reported bug)', true)

  // 2. Shift+Enter makes a newline instead of saving.
  const before = await page.locator('article').count()
  await page.keyboard.type('first line')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('second line')
  await page.waitForTimeout(150)
  check('2. Shift+Enter inserts a newline', (await composer.inputValue()) === 'first line\nsecond line')
  check('2b. Shift+Enter does not save', (await page.locator('article').count()) === before)

  // Cmd/Ctrl+Enter also submits.
  await page.keyboard.press('ControlOrMeta+Enter')
  await rowFor(page, 'second line').waitFor({ timeout: 5000 })
  check('2c. Cmd/Ctrl+Enter also saves', true)

  // 3. An IME composition must keep Enter for itself.
  const beforeIme = await page.locator('article').count()
  await composer.click()
  await page.evaluate(() =>
    document.getElementById('composer').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await page.keyboard.type('にほんご')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check('3. Enter during IME composition does not save', (await page.locator('article').count()) === beforeIme)
  check('3b. the composed text is still in the notebook', (await composer.inputValue()).includes('にほんご'))
  await page.evaluate(() =>
    document.getElementById('composer').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  )
  await composer.fill('')

  // 4. Empty and whitespace-only input create nothing.
  const beforeEmpty = await page.locator('article').count()
  await composer.click()
  await page.keyboard.press('Enter')
  await composer.fill('     ')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check('4. empty and whitespace-only input create nothing', (await page.locator('article').count()) === beforeEmpty)
  await shot('01-home')

  // The skip link must reach the content without hijacking the hash route.
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('a.skip').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const skipLanded = await page.evaluate(() => document.activeElement?.id)
  check('skip link moves focus to the content and does not hijack the route',
    skipLanded === 'main' && (await page.getByRole('heading', { name: 'Come on in.' }).isVisible()),
    `focus landed on "${skipLanded}"`)

  /* ---------------------------------------------------------------- */
  step('6. A failed write keeps the draft')
  await page.evaluate(() => {
    window.__tx = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function () {
      throw new DOMException('simulated storage failure', 'InvalidStateError')
    }
  })
  const beforeFail = await page.locator('article').count()
  await composer.click()
  await page.keyboard.type('this one must not be lost')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  check('6. nothing is added when the write fails', (await page.locator('article').count()) === beforeFail)
  check('6b. the complete draft is back in the notebook', (await composer.inputValue()).includes('this one must not be lost'))
  check('6c. the failure is explained', await page.getByRole('alert').first().isVisible())
  await shot('02-write-failure')

  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = window.__tx
  })
  await page.getByRole('button', { name: 'Try again' }).click()
  await rowFor(page, 'this one must not be lost').waitFor({ timeout: 5000 })
  check('6d. retrying after the failure saves it', true)

  /* ---------------------------------------------------------------- */
  step('7. Thoughts survive a refresh')
  await page.reload({ waitUntil: 'networkidle' })
  await rowFor(page, 'send my mentor').waitFor({ timeout: 5000 })
  check('7. captured thoughts are still there after a reload', true)

  /* ---------------------------------------------------------------- */
  step('8. Classification')
  const mentorRow = rowFor(page, 'send my mentor')
  await mentorRow.getByRole('button', { name: /^File/ }).click()
  await page.getByRole('menuitemradio', { name: /^Action/ }).click()
  await page.waitForTimeout(300)
  check('8. a thought can be filed from the row itself', (await mentorRow.getByRole('button', { name: /^File/ }).textContent())?.includes('Action'))

  const ideaRow = rowFor(page, 'idea for a new app')
  await ideaRow.getByRole('button', { name: /^File/ }).click()
  await page.getByRole('menuitemradio', { name: /^Idea/ }).click()
  await page.waitForTimeout(300)
  check('8b. a second thought files as something else', (await ideaRow.getByRole('button', { name: /^File/ }).textContent())?.includes('Idea'))

  // Re-filing keeps the original words and is always allowed.
  await ideaRow.getByRole('button', { name: /^File/ }).click()
  await page.getByRole('menuitemradio', { name: /^On my mind/ }).click()
  await page.waitForTimeout(300)
  check('8c. a classification can be changed again', (await ideaRow.getByRole('button', { name: /^File/ }).textContent())?.includes('On my mind'))
  await ideaRow.getByRole('button', { name: /^File/ }).click()
  await page.getByRole('menuitemradio', { name: /^Idea/ }).click()
  await page.waitForTimeout(250)

  /* ---------------------------------------------------------------- */
  step('9. Editing and deleting')
  const editRow = rowFor(page, 'second line')
  await editRow.getByRole('button', { name: /^More for/ }).click()
  await page.getByRole('menuitem', { name: 'Edit the words' }).click()
  const editBox = page.getByRole('textbox', { name: 'Edit this thought' })
  await editBox.waitFor()
  await editBox.fill('first line / second line, tidied up')
  await editBox.press('Enter')
  await page.waitForTimeout(400)
  check('9. a thought can be edited', await rowFor(page, 'tidied up').isVisible())
  const tidied = rowFor(page, 'tidied up')
  check('9b. the edit is marked, with the original kept', await tidied.getByRole('button', { name: /edited/ }).isVisible())
  await tidied.getByRole('button', { name: /edited/ }).click()
  check('9c. the first version can be read back', await tidied.getByText(/First written:/).isVisible())

  await tidied.getByRole('button', { name: /^More for/ }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.waitForTimeout(400)
  check('9d. a thought can be deleted', (await rowFor(page, 'tidied up').count()) === 0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.waitForTimeout(400)
  check('9e. and the delete can be undone', await rowFor(page, 'tidied up').isVisible())

  /* ---------------------------------------------------------------- */
  step('14. Return tickets')
  const passport = rowFor(page, 'this one must not be lost')
  await passport.getByRole('button', { name: /^More for/ }).click()
  await page.getByRole('menuitem', { name: /Put it aside until/ }).click()
  const parkInput = page.getByLabel('Bring it back on')
  const today = new Date()
  const iso = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
  await parkInput.fill(iso)
  await page.waitForTimeout(400)
  check('14. an item can be put aside until a date', (await parkInput.inputValue()) === iso)

  /* ---------------------------------------------------------------- */
  step('10–11. Black Box snapshots and history')
  await page.getByRole('link', { name: /^Projects/ }).first().click()
  await page.getByLabel('Start a project').fill('Harrow deck')
  await page.getByLabel('What is it, in a line').fill('The pitch deck for the Harrow rebrand.')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('heading', { name: 'Harrow deck' }).waitFor()
  check('10. a project can be created with a description', await page.getByText('The pitch deck for the Harrow rebrand.').isVisible())

  await page.getByRole('button', { name: 'Save my place' }).first().click()
  await page.getByLabel('Where it stands').fill('Second draft; the client has seen nothing yet.')
  await page.getByLabel('What you last finished').fill('Rewrote the opening section.')
  await page.getByLabel("What's in the way").fill('Waiting on revised figures from finance.')
  await page.getByLabel('The last decision you made').fill('Dropped the case study rather than shorten it.')
  await page.getByLabel('The exact next action').fill('Open slide 12 and write the three-line summary.')
  await page.getByRole('button', { name: 'Save my place' }).last().click()
  await page.getByText('Your place is saved').waitFor({ timeout: 5000 })
  check('10b. a snapshot saves and says when', true)
  check('10c. reopening leads with where you left off', await page.getByRole('heading', { name: /Here’s where you left off/ }).isVisible())

  await page.getByRole('button', { name: 'Update where I am' }).click()
  await page.getByLabel('The exact next action').fill('Send the deck to Priya for a first look.')
  await page.getByRole('button', { name: 'Save my place' }).last().click()
  await page.getByText('Your place is saved').waitFor({ timeout: 5000 })
  await page.getByRole('heading', { name: 'Earlier places' }).waitFor({ timeout: 5000 })
  check('11. the earlier snapshot is kept as history', true)
  const historyToggle = page.locator('li.paper button').first()
  await historyToggle.click()
  check('11b. an earlier snapshot can be read', await page.getByText('Open slide 12 and write the three-line summary.').isVisible())
  await shot('03-project')

  /* ---------------------------------------------------------------- */
  step('12. The evening ritual persists a hand-off')
  await page.getByRole('link', { name: 'Close the day' }).first().click()
  await page.getByRole('heading', { name: /Let’s put the day down/ }).waitFor()
  check('12. the ritual shows what is still loose', await page.getByRole('heading', { name: /^Still loose/ }).isVisible())
  check('12b. it shows where projects stand', await page.getByRole('heading', { name: /^Where your projects stand/ }).isVisible())

  const picks = page.locator('input[type="checkbox"]')
  await picks.first().check()
  check('12c. a starting point for tomorrow can be chosen', await picks.first().isChecked())
  await page.getByLabel('A line to the person who comes back').fill('Stopped halfway through slide 12. Figures still not in.')
  await shot('04-ritual')
  await page.getByRole('button', { name: 'Close the day' }).last().click()
  await page.getByRole('heading', { name: 'Your day is saved.' }).waitFor({ timeout: 5000 })
  check('12d. closing reaches the quiet closing state', true)
  check('12e. the closing screen drops the workspace chrome', (await page.getByRole('navigation', { name: 'Primary' }).count()) === 0)
  await page.waitForTimeout(500)
  await shot('05-closed')

  /* ---------------------------------------------------------------- */
  step('13. Gentle Return shows what was actually saved')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  check('13. home shows the last hand-off', await page.getByRole('heading', { name: /^Last hand-off/ }).isVisible())
  await page.getByRole('link', { name: /^Return/ }).first().click()
  await page.getByRole('heading', { name: /Here’s where you stopped/ }).waitFor()
  check('13b. the hand-off note survived', await page.getByText('Stopped halfway through slide 12').isVisible())
  check('13c. what you chose is listed', await page.getByRole('heading', { name: /^What you chose/ }).isVisible())
  check('14b. the return ticket surfaced on its day', await page.getByRole('heading', { name: /^Back today/ }).isVisible())
  check('13d. project context is shown', await page.getByText('Send the deck to Priya for a first look.').isVisible())
  await shot('06-return')

  /* ---------------------------------------------------------------- */
  step('15. Export and import')
  await page.goto(`${BASE}#/data`)
  await page.getByRole('heading', { name: /Your data, in your hands/ }).waitFor()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download a backup' }).click(),
  ])
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  check('15. the export is a LOWTIDE backup', backup.app === 'lowtide' && backup.version === 2)
  check('15b. it holds the things, project, snapshots and hand-off',
    backup.data.things.length >= 4 && backup.data.projects.length === 1 &&
    backup.data.capsules.length === 2 && backup.data.handoffs.length === 1,
    JSON.stringify({ t: backup.data.things.length, p: backup.data.projects.length, c: backup.data.capsules.length, h: backup.data.handoffs.length }))
  check('15c. the project description is in the backup', backup.data.projects[0].description === 'The pitch deck for the Harrow rebrand.')

  await page.getByLabel('Or paste JSON').fill(JSON.stringify(backup))
  await page.getByRole('button', { name: 'Check this' }).click()
  await page.getByRole('heading', { name: 'What would be added' }).waitFor()
  check('15d. re-importing existing data adds nothing', await page.getByText('Already here (skipped)').isVisible())
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Delete everything on this device' }).click()
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click()
  await page.getByText('Everything has been removed from this device.').waitFor({ timeout: 5000 })
  await page.getByLabel('Or paste JSON').fill(JSON.stringify(backup))
  await page.getByRole('button', { name: 'Check this' }).click()
  await page.getByRole('button', { name: 'Add this to my data' }).click()
  await page.getByText(/^Added /).waitFor({ timeout: 5000 })
  await page.goto(`${BASE}#/return`)
  await page.reload({ waitUntil: 'networkidle' })
  check('15e. a wiped device is fully restored from the backup', await page.getByText('Stopped halfway through slide 12').isVisible())

  /* ---------------------------------------------------------------- */
  if (CHECK_OFFLINE) {
    step('Offline')
    await page.goto(BASE, { waitUntil: 'networkidle' })
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      const reg = await navigator.serviceWorker.ready
      return Boolean(reg.active)
    })
    check('a service worker is active', swReady)
    await context.setOffline(true)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('heading', { name: 'Come on in.' }).waitFor({ timeout: 10000 })
    check('the app loads with the network switched off', true)
    await composerOf(page).click()
    await page.keyboard.type('written while offline')
    await page.keyboard.press('Enter')
    await rowFor(page, 'written while offline').waitFor({ timeout: 5000 })
    check('capture still works offline', true)
    await context.setOffline(false)
  }

  /* ---------------------------------------------------------------- */
  step('16. Data written by the previous schema survives')
  const legacyCtx = await browser.newContext()
  const legacy = await legacyCtx.newPage()
  legacy.setDefaultTimeout(8000)
  // Land on the origin WITHOUT booting the app, so nothing holds the database
  // open while the old version of it is built by hand.
  await legacy.goto(`${BASE}favicon.svg`)
  await legacy.evaluate(async () => {
    const withTimeout = (promise, ms, what) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
      ])

    await withTimeout(
      new Promise((resolve, reject) => {
        const del = indexedDB.deleteDatabase('lowtide')
        del.onsuccess = () => resolve()
        del.onerror = () => reject(del.error)
        del.onblocked = () => reject(new Error('delete blocked'))
      }),
      5000,
      'delete',
    )

    await withTimeout(
      new Promise((resolve, reject) => {
        const open = indexedDB.open('lowtide', 1)
        open.onupgradeneeded = () => {
          const db = open.result
          db.createObjectStore('things', { keyPath: 'id' }).createIndex('byCreated', 'createdAt')
          db.createObjectStore('projects', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt')
          const caps = db.createObjectStore('capsules', { keyPath: 'id' })
          caps.createIndex('byProject', 'projectId')
          caps.createIndex('bySaved', 'savedAt')
          db.createObjectStore('handoffs', { keyPath: 'id' }).createIndex('byClosed', 'closedAt')
          db.createObjectStore('meta', { keyPath: 'key' })
          db.createObjectStore('oplog', { keyPath: 'seq', autoIncrement: true })
        }
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['things', 'projects'], 'readwrite')
          const now = Date.now()
          tx.objectStore('things').put({
            id: 'legacy-thing', text: 'saved by the old version', originalText: null, note: '',
            kind: 'action', status: 'open', createdAt: now, updatedAt: now, classifiedAt: now,
            completedAt: null, dueAt: null, waitingOn: '', returnAt: null, returnedAt: null,
            projectId: null, deletedAt: null, batchId: null,
          })
          // A version 1 project record has no `description` field at all.
          tx.objectStore('projects').put({
            id: 'legacy-project', name: 'Project from yesterday', createdAt: now, updatedAt: now,
            archivedAt: null, deletedAt: null,
          })
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
        open.onblocked = () => reject(new Error('open blocked'))
      }),
      5000,
      'seed',
    )
  })

  // Now boot the app against that old database.
  await legacy.goto(BASE, { waitUntil: 'networkidle' })
  await legacy.getByRole('heading', { name: 'Come on in.' }).waitFor()
  check('16. a thought written by the old schema is still there',
    await legacy.locator('article').filter({ hasText: 'saved by the old version' }).first().isVisible())
  await legacy.goto(`${BASE}#/projects`)
  await legacy.getByRole('heading', { name: 'Project from yesterday' }).waitFor()
  check('16b. a project written by the old schema opens without error', true)
  const migrated = await legacy.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('lowtide')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const row = await new Promise((resolve) => {
      const request = db.transaction('projects').objectStore('projects').get('legacy-project')
      request.onsuccess = () => resolve(request.result)
    })
    const version = db.version
    db.close()
    return { version, description: row?.description, name: row?.name }
  })
  check('16c. the database was upgraded in place', migrated.version === 2, `version ${migrated.version}`)
  check('16d. the new field was added and the old data kept',
    migrated.description === '' && migrated.name === 'Project from yesterday',
    JSON.stringify(migrated))
  await legacyCtx.close()

  step('Console')
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  failures++
  console.log(`\nFAILED: ${error.message}`)
  await shot('99-failure')
} finally {
  await browser.close()
}

console.log(`\n${failures === 0 ? `PASS — ${checks} checks` : `FAIL — ${failures} of ${checks} checks failed`}`)
process.exit(failures === 0 ? 0 : 1)
