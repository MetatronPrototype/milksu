#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureOwnerWritable } from './lib/bundle-owner-writable.mjs'
import {
  assertShipItCanClearQuarantine,
  ownerUnwritableFiles,
  walkRegularFiles,
} from './lib/shipit-quarantine-ready.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const licenseRel = join(
  'Contents',
  'Resources',
  'milksu-sidecar',
  'THIRD_PARTY-LICENSES',
  'gopls-BSD-3-Clause.txt',
)

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

async function inspectApp(app) {
  const license = join(app, licenseRel)
  await stat(license)
  const files = await walkRegularFiles(app)
  return {
    license,
    fileCount: files.length,
    blocked: ownerUnwritableFiles(files),
  }
}

const zipPath = resolve(argument('zip') || join(
  repositoryRoot,
  'build',
  'release',
  'MilkSU-macOS-arm64-ota.zip',
))
const roundtrip = process.argv.includes('--roundtrip')
const work = await mkdtemp(join(tmpdir(), 'milksu-ota-verify-'))

try {
  await stat(zipPath)
  const firstRoot = join(work, 'original')
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, firstRoot])
  const app = join(firstRoot, 'MilkSU.app')
  await stat(app)
  const first = await inspectApp(app)
  process.stdout.write(
    `original zip=${zipPath}\nfiles=${first.fileCount} unwritable=${first.blocked.length}\n`,
  )
  if (first.blocked.length > 0) {
    process.stdout.write(`${first.blocked.slice(0, 12).join('\n')}\n`)
  }
  let originalReady = true
  try {
    await assertShipItCanClearQuarantine(app, { xattrPaths: [first.license] })
    process.stdout.write('original ShipIt check: PASS\n')
  } catch (error) {
    originalReady = false
    process.stdout.write(`original ShipIt check: FAIL\n${error.message}\n`)
    if (!roundtrip) throw error
  }

  if (!roundtrip) {
    process.exit(originalReady ? 0 : 1)
  }
  await ensureOwnerWritable(app)
  const repairedZip = join(work, 'repaired.zip')
  await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, repairedZip])
  const secondRoot = join(work, 'repaired')
  await run('/usr/bin/ditto', ['-x', '-k', repairedZip, secondRoot])
  const repairedApp = join(secondRoot, 'MilkSU.app')
  const second = await inspectApp(repairedApp)
  const result = await assertShipItCanClearQuarantine(repairedApp, { xattrPaths: [second.license] })
  process.stdout.write(
    `repaired files=${second.fileCount} unwritable=${second.blocked.length} `
    + `cleared=${result.cleared} originalReady=${originalReady}\n`,
  )
  if (second.blocked.length > 0) {
    throw new Error('repaired zip still has owner-unwritable files')
  }
} finally {
  await rm(work, { recursive: true, force: true })
}
