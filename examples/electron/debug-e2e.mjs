import { _electron as electron } from '@playwright/test'

const APP_DIR = process.cwd()

const app = await electron.launch({ args: [APP_DIR] })
const page = await app.firstWindow()
page.on('console', (msg) => console.log('CONSOLE:', msg.type(), msg.text()))
page.on('pageerror', (err) => console.log('PAGEERROR:', err))
await page.waitForSelector('[aria-label="Markdown editor"]')

async function selectWordByDoubleClick(word) {
  const { x, y } = await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index !== -1) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + needle.length)
        const rect = range.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
    }
    throw new Error('not found')
  }, word)
  await page.mouse.dblclick(x, y)
}

await selectWordByDoubleClick('fox')

const noteButton = page.getByRole('button', { name: 'Note' })
await noteButton.waitFor({ state: 'visible' })

const selBefore = await page.evaluate(() => document.getSelection()?.toString())
console.log('selection before click:', JSON.stringify(selBefore))

const box = await noteButton.boundingBox()
console.log('note button box:', box)

await noteButton.click()

await page.waitForTimeout(500)

const markCount = await page.locator('[aria-label="Markdown editor"] mark').count()
console.log('mark count:', markCount)

const html = await page.locator('[aria-label="Markdown editor"]').innerHTML()
console.log('editor html:', html)

await app.close()
