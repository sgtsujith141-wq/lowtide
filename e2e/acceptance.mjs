/**
 * The acceptance test from the milestone brief, driven through a real browser.
 *
 *   node e2e/acceptance.mjs                      # against the dev server
 *   E2E_URL=http://localhost:4173/ OFFLINE=1 …   # against the built app
 *
 * OFFLINE=1 additionally pulls the network away and reloads, which only passes
 * if the service worker is serving the app shell from cache.
 */
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'

const URL_BASE = process.env.E2E_URL ?? 'http://localhost:5173/'
const CHECK_OFFLINE = process.env.OFFLINE === '1'
const SHOTS = process.env.SHOT_DIR ?? null

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function step(name) {
  console.log(`\n${name}`)
}

const MESSY = [
  'the Harrow deck is still unfinished',
  'I said I would send Priya the numbers by Friday',
  'is the passport still valid?',
]

const browser = await chromium.launch()
const context = await browser.newContext({ acceptDownloads: true })
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
  /* 1 — landing ------------------------------------------------------ */
  step('1. Landing')
  await page.goto(URL_BASE, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Put the day down.' }).waitFor()
  check('landing renders the tagline', true)
  await shot('01-landing')

  /* 2 — a messy brain dump ------------------------------------------- */
  step('2. The dump')
  await page.getByRole('link', { name: 'Empty your head' }).click()
  const box = page.getByRole("textbox", { name: "What is taking up room?" })
  await box.waitFor()

  await box.fill('call the dentist about the crown')
  await box.press('Enter')
  await page.getByText('Saved. It is out of your head now.').waitFor({ timeout: 5000 })
  check('a single thought saves and confirms', true)
  check('the field is cleared only after a successful save', (await box.inputValue()) === '')

  for (const line of MESSY) {
    await box.type(line)
    await box.press('Shift+Enter')
  }
  await box.press('ControlOrMeta+Enter')
  await page.getByText('Saved 3 things.').waitFor({ timeout: 5000 })
  check('a multi-line paste saves as separate things', true)

  const captured = await page.locator('section[aria-label="Captured in this sitting"] article').count()
  check('all four captures are listed back', captured === 4, `found ${captured}`)
  await shot('02-dump')

  /* 3 — classify ------------------------------------------------------ */
  step('3. Routing')
  await page.getByRole('link', { name: 'File them →' }).click()
  await page.getByRole('heading', { name: 'To file' }).waitFor()
  const queue = page.locator('ul li.lt-card')
  const before = await queue.count()

  // Keyboard path: focus the first card, press its hotkey.
  await queue.first().click()
  await page.keyboard.press('1')
  await page.waitForTimeout(250)
  const after = await page.locator('ul li.lt-card').count()
  check('a keyboard hotkey files the focused thought', after === before - 1, `${before} → ${after}`)

  // Mouse path for the rest, filing each card by what it actually says.
  for (const [text, label] of [
    ['send Priya the numbers', 'Commitment'],
    ['Harrow deck', 'Project'],
    ['passport', 'On my mind'],
  ]) {
    const card = page.locator('ul li.lt-card', { hasText: text }).first()
    await card.getByRole('button', { name: new RegExp(`^\\d ${label}$`) }).click()
    await page.waitForTimeout(200)
  }
  check('the queue empties as things are filed', (await page.locator('ul li.lt-card').count()) === 0)

  // A commitment needs a date; set one three days out.
  const due = new Date()
  due.setDate(due.getDate() + 3)
  const dueValue = `${due.getFullYear()}-${`${due.getMonth() + 1}`.padStart(2, '0')}-${`${due.getDate()}`.padStart(2, '0')}`
  const commitment = page.locator('.lt-card', { hasText: 'send Priya the numbers' }).first()
  await commitment.getByRole('button', { name: 'Details' }).click()
  await commitment.getByLabel('Due', { exact: true }).fill(dueValue)
  await page.waitForTimeout(250)
  check('a due date can be set on a commitment', true)
  await shot('03-things')

  /* 4 — a project and its capsule ------------------------------------- */
  step('4. Black box')
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click()
  await page.getByLabel('Start a project').fill('Harrow deck')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('heading', { name: 'Harrow deck' }).waitFor()
  check('a project can be created', true)

  await page.getByRole('button', { name: 'Save my place' }).first().click()
  await page.getByLabel('Where it stands').fill('Second draft; the client has seen nothing yet.')
  await page.getByLabel('What you last finished').fill('Rewrote the opening section.')
  await page.getByLabel("What's in the way").fill('Waiting on revised figures from finance.')
  await page.getByLabel('The last decision you made').fill('Dropped the case study rather than shorten it.')
  await page.getByLabel('The exact next action').fill('Open slide 12 and write the three-line summary.')
  await page.getByRole('button', { name: 'Save my place' }).last().click()
  await page.getByText('Your place is saved').waitFor({ timeout: 5000 })
  check('a capsule saves and confirms with a timestamp', true)
  await shot('04-project')

  // Saving again must keep the previous version.
  await page.getByRole('button', { name: 'Update my place' }).first().click()
  await page.getByLabel('The exact next action').fill('Send the deck to Priya for a first look.')
  await page.getByRole('button', { name: 'Save my place' }).click()
  await page.getByText('Your place is saved').waitFor({ timeout: 5000 })
  await page.getByRole('heading', { name: 'History' }).waitFor({ timeout: 5000 })
  check('an earlier capsule is kept as history', true)

  /* 5 — close the day -------------------------------------------------- */
  step('5. Closing')
  await page.goto(`${URL_BASE}#/close`)
  await page.getByRole('heading', { name: 'Loose ends' }).waitFor()
  await page.getByRole('button', { name: /Leave them and go on|Next/ }).click()
  await page.getByRole('heading', { name: 'What is owed' }).waitFor()
  check('commitments due within three days are surfaced', await page.getByText('send Priya the numbers').isVisible())
  await page.getByRole('button', { name: /Next/ }).click()

  await page.getByRole('heading', { name: 'Tomorrow' }).waitFor()
  const boxes = page.locator('input[type="checkbox"]')
  await boxes.first().check()
  await boxes.nth(1).check()
  check('a small number of next actions can be chosen', (await boxes.nth(0).isChecked()) === true)
  await page.getByRole('button', { name: /Next/ }).click()

  await page.getByRole('heading', { name: 'Places' }).waitFor()
  check('projects are offered for a final save', await page.getByText('Harrow deck').first().isVisible())
  await page.getByRole('button', { name: /Next/ }).click()

  await page.getByRole('heading', { name: 'Close', exact: true }).waitFor()
  await page.getByLabel('A line to the person who comes back').fill('Stopped halfway through slide 12. Figures still not in.')
  await shot('05-closing')
  await page.getByRole('button', { name: 'Close the day' }).click()
  await page.getByRole('heading', { name: 'The day is down.' }).waitFor({ timeout: 5000 })
  const chromeGone = (await page.getByRole('navigation', { name: 'Primary' }).count()) === 0
  check('the day closes to a quiet screen', true)
  check('the closing screen drops the app chrome', chromeGone)
  await page.waitForTimeout(600)
  await shot('06-closed')

  /* 6 — restart -------------------------------------------------------- */
  step('6. Restart and return')
  await page.goto(URL_BASE, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Put the day down.' }).waitFor()
  check('the landing page still knows about the last hand-off', await page.getByText(/You last put the day down/).isVisible())

  await page.getByRole('link', { name: 'Pick up where I stopped' }).click()
  await page.getByRole('heading', { name: 'Here is where you stopped.' }).waitFor()
  check('the hand-off note survived the restart', await page.getByText('Stopped halfway through slide 12').isVisible())
  check('the chosen next actions are shown', (await page.locator('section', { hasText: 'What you chose' }).first().isVisible()))
  check('an approaching commitment is shown', await page.getByText('Coming up').isVisible())
  check('project context is shown', await page.getByText('Send the deck to Priya for a first look.').isVisible())
  await shot('07-return')

  /* 7 — export and restore --------------------------------------------- */
  step('7. Export and restore')
  await page.goto(`${URL_BASE}#/data`)
  await page.getByRole('heading', { name: 'Your data, in your hands.' }).waitFor()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download a backup' }).click(),
  ])
  const file = await download.path()
  const backup = JSON.parse(await readFile(file, 'utf8'))
  check('the export is a LOWTIDE v2 backup', backup.app === 'lowtide' && backup.version === 2)
  check('the export contains every record', backup.data.things.length === 4 && backup.data.projects.length === 1 && backup.data.capsules.length === 2 && backup.data.handoffs.length === 1,
    JSON.stringify({ t: backup.data.things.length, p: backup.data.projects.length, c: backup.data.capsules.length, h: backup.data.handoffs.length }))

  // Re-importing the same file must add nothing rather than duplicate or overwrite.
  await page.getByLabel('Or paste JSON').fill(JSON.stringify(backup))
  await page.getByRole('button', { name: 'Check this' }).click()
  await page.getByRole('heading', { name: 'What would be added' }).waitFor()
  check('a re-import of existing data adds nothing', await page.getByText('Already here (skipped)').isVisible())
  check('and the add button is disabled', await page.getByRole('button', { name: 'Add this to my data' }).isDisabled())
  await page.getByRole('button', { name: 'Cancel' }).click()

  // A fresh device: wipe, then restore from the backup.
  await page.getByRole('button', { name: 'Delete everything on this device' }).click()
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click()
  await page.getByText('Everything has been removed from this device.').waitFor({ timeout: 5000 })
  await page.getByLabel('Or paste JSON').fill(JSON.stringify(backup))
  await page.getByRole('button', { name: 'Check this' }).click()
  await page.getByRole('button', { name: 'Add this to my data' }).click()
  await page.getByText(/Added 4 things/).waitFor({ timeout: 5000 })
  await page.goto(`${URL_BASE}#/return`)
  await page.reload({ waitUntil: 'networkidle' })
  check('everything comes back from the backup', await page.getByText('Stopped halfway through slide 12').isVisible())
  await shot('08-restored')

  /* 8 — offline --------------------------------------------------------- */
  if (CHECK_OFFLINE) {
    step('8. Offline')
    await page.goto(URL_BASE, { waitUntil: 'networkidle' })
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      const reg = await navigator.serviceWorker.ready
      return Boolean(reg.active)
    })
    check('a service worker is active', swReady)
    await context.setOffline(true)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('heading', { name: 'Put the day down.' }).waitFor({ timeout: 10000 })
    check('the app loads with the network switched off', true)
    await page.goto(`${URL_BASE}#/return`)
    check('saved data is readable offline', await page.getByText('Stopped halfway through slide 12').isVisible())
    await shot('09-offline')
    await context.setOffline(false)
  }

  step('Console')
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  failures++
  console.log(`\nFAILED: ${error.message}`)
  await shot('99-failure')
} finally {
  await browser.close()
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)
