import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import type { Page } from 'playwright'

const root = join(import.meta.dirname, '..')
const {
  revision,
  artifacts: [artifact],
} = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
const tarball = join(root, 'release', artifact.file)
const checksum = createHash('sha256')
  .update(await readFile(tarball))
  .digest('hex')
assert.equal(checksum, artifact.sha256)

const temporary = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'hotkeys-browser-'))
try {
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@shaulavo/hotkeys': `file:${tarball}`,
        '@tanstack/react-store': '^0.11.1',
        react: '19.2.0',
        'react-dom': '19.2.0',
      },
    }),
  )
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: temporary, stdio: 'inherit' },
  )
  await cp(
    join(root, 'scripts/fixtures/browser-consumer.tsx'),
    join(temporary, 'browser-consumer.tsx'),
  )
  execFileSync(
    'bun',
    ['build', '--target=browser', '--format=iife', '--outfile=fixture.js', 'browser-consumer.tsx'],
    { cwd: temporary, stdio: 'inherit' },
  )

  const browser = await chromium.launch({ executablePath: process.env.HOTKEYS_CHROMIUM })
  try {
    const page = await browser.newPage()
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text())
    })
    await page.setContent('<main></main><button>Unmount</button><pre aria-label="Log"></pre>')
    await page.addScriptTag({ path: join(temporary, 'fixture.js') })
    await runScenario(page)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
  assert.equal(
    createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex'),
    checksum,
  )
  console.log(`Chromium passed for ${artifact.file} at ${revision} (SHA-256 ${checksum})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function runScenario(page: Page) {
  const workspace = page.getByRole('button', { name: 'Workspace' })
  const editor = page.getByRole('textbox', { name: 'Editor' })
  const pending = page.locator('output[aria-label="Pending"]')
  const shifts = page.locator('output[aria-label="Shift"]')
  const log = page.getByLabel('Log')
  await workspace.focus()
  await page.keyboard.press('Control+b')
  await editor.focus()
  await page.keyboard.press('Control+b')
  await textEquals(log, 'workspace\neditor\n')
  await page.keyboard.press('Control+k')
  await textEquals(pending, 'Control+K')
  await page.keyboard.press('Control+c')
  await textEquals(pending, 'idle')
  await textEquals(log, 'workspace\neditor\nchord\n')

  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('ShiftRight')
  await textEquals(shifts, '11')
  await page.keyboard.up('ShiftLeft')
  await textEquals(shifts, '01')
  await page.keyboard.up('ShiftRight')
  await textEquals(shifts, '00')

  const first = page.frameLocator('#first').getByRole('button')
  const second = page.frameLocator('#second').getByRole('button')
  await first.focus()
  await page.keyboard.press('F8')
  const once = 'workspace\neditor\nchord\nregistered\n'
  await textEquals(log, once)

  await page.getByRole('button', { name: 'Swap' }).click()
  await first.focus()
  await page.keyboard.press('F8')
  await second.focus()
  await page.keyboard.press('F8')
  await editor.focus()
  await page.keyboard.press('Control+b')
  const swapped = once + 'registered\neditor\n'
  await textEquals(log, swapped)
  await page.getByRole('button', { name: 'Unmount' }).click()
  await textEquals(log, swapped + 'true,true,true,true\n')
}

async function textEquals(locator: ReturnType<Page['locator']>, expected: string) {
  const deadline = Date.now() + 5_000
  let actual: string | null = null
  do {
    actual = await locator.textContent({ timeout: 5_000 })
    if (actual === expected) return
    await delay(20)
  } while (Date.now() < deadline)
  assert.equal(actual, expected)
}
