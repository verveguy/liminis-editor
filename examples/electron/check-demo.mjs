/**
 * Drive the live demo site and report what it actually does.
 *
 * This is a behavioural check, not a status-code check: 200 with correct asset
 * paths only proves the bytes arrived. The questions here are whether the
 * editor mounts, whether typing round-trips into the raw markdown pane, and
 * whether the page logged any errors while doing it.
 */
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://v3rv.com/liminis-editor/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const ok = (label, value) => console.log(`  ${value ? '✓' : '✗'} ${label}`)

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 })

// 1. The editor mounts at all.
const editor = page.locator('[contenteditable="true"]').first()
await editor.waitFor({ state: 'visible', timeout: 30_000 })
ok('editor mounts (contenteditable present)', await editor.isVisible())

// 2. The sample document rendered — headings prove the markdown pipeline ran.
const headings = await page.locator('[class*="editor-heading-h"]').count()
ok(`sample document rendered (${headings} headings)`, headings > 0)

// 3. The version badge — should name the release this site was deployed from.
const bodyText = await page.locator('body').innerText()
const version = bodyText.match(/v?0\.1\.\d+[^\s]*/)?.[0] ?? '(none found)'
console.log(`  • version badge reads: ${version}`)

// 4. Outline / sidebar entries, with "All The Things" pinned first.
const sidebar = await page.locator('aside, nav').first().innerText().catch(() => '')
ok('sidebar lists documents', sidebar.length > 0)
console.log(`  • first sidebar entries: ${sidebar.split('\n').filter(Boolean).slice(0, 4).join(' | ')}`)

// 5. The round trip: type into the editor, watch the raw markdown pane change.
const rawBefore = await page.locator('textarea').first().inputValue().catch(() => null)
if (rawBefore === null) {
  ok('raw markdown pane present', false)
} else {
  await editor.click()
  await page.keyboard.type('ZZTOPMARKER')
  await page.waitForTimeout(1500) // past the debounce
  const rawAfter = await page.locator('textarea').first().inputValue()
  ok('typing in the editor reaches the raw markdown pane', rawAfter.includes('ZZTOPMARKER'))
  ok('raw pane content actually changed', rawAfter !== rawBefore)
}

// 6. Nothing blew up while we did all that.
ok(`no console errors (${errors.length})`, errors.length === 0)
errors.slice(0, 5).forEach((e) => console.log(`      ${e.slice(0, 160)}`))

await page.screenshot({ path: process.argv[3] ?? '/tmp/demo.png', fullPage: false })
console.log(`  • screenshot: ${process.argv[3] ?? '/tmp/demo.png'}`)

await browser.close()
process.exit(errors.length === 0 ? 0 : 1)
