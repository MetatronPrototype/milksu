#!/usr/bin/env node

import { createRequire } from 'node:module'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { assertShipItCanClearQuarantine } from './lib/shipit-quarantine-ready.mjs'

const require = createRequire(import.meta.url)
const { prepareMacUpdate } = require('../desktop/update-artifacts.cjs')

function argument(name) {
  const prefix = `--${name}=`
  const raw = process.argv.find(item => item.startsWith(prefix))
  return raw ? raw.slice(prefix.length) : ''
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with status ${code}`)))
  })
}

const dmg = resolve(argument('dmg'))
const currentApp = resolve(argument('app') || '/Applications/MilkSU.app')
const version = argument('version') || '26.915.1'
const work = await mkdtemp(join(tmpdir(), 'milksu-ota-dmg-'))

try {
  await stat(dmg)
  await stat(currentApp)
  process.stdout.write(`prepareMacUpdate dmg=${dmg}\ncurrent=${currentApp} version=${version}\n`)
  const zip = await prepareMacUpdate(dmg, work, currentApp, version)
  process.stdout.write(`prepared ${zip}\n`)
  const extractRoot = join(work, 'prepared-extract')
  await run('/usr/bin/ditto', ['-x', '-k', zip, extractRoot])
  const app = join(extractRoot, 'MilkSU.app')
  const license = join(
    app,
    'Contents',
    'Resources',
    'milksu-sidecar',
    'THIRD_PARTY-LICENSES',
    'gopls-BSD-3-Clause.txt',
  )
  const result = await assertShipItCanClearQuarantine(app, { xattrPaths: [license] })
  process.stdout.write(`prepared ShipIt check: PASS files=${result.fileCount} cleared=${result.cleared}\n`)
} finally {
  await rm(work, { recursive: true, force: true })
}
