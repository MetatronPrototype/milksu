'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  createPreparedUpdateFeed,
  downloadUpdateArtifact,
  ensureOwnerWritable,
  prepareMacUpdate,
  verifyArtifact,
} = require('./update-artifacts.cjs')

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'milksu-update-artifact-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('download validates the entire body before promoting .part to an installable file', async t => {
  const dir = await temporary(t)
  const file = path.join(dir, 'update.zip')
  const data = Buffer.alloc(1024, 17)
  let count = 0
  await downloadUpdateArtifact(
    'https://accounts.example/artifact',
    file,
    data.length,
    sha256(data),
    {
      onProgress(received) { count = received },
      fetchImpl: async () => new Response(data),
    },
  )
  await verifyArtifact(file, data.length, sha256(data))
  assert.equal(count, data.length)
  assert.deepEqual(await readFile(file), data)
  assert.deepEqual(await readdir(dir), ['update.zip'])
})

test('wrong hashes, truncation, oversized response and interrupted download leave no installer', async t => {
  const dir = await temporary(t)
  const expected = Buffer.alloc(100, 1)
  const digest = sha256(expected)
  for (const [name, response] of [
    ['hash', () => new Response(Buffer.alloc(100, 2))],
    ['short', () => new Response(Buffer.alloc(90, 1))],
    ['large', () => new Response(Buffer.alloc(101, 1))],
    ['error', () => new Response('<Error>Expired</Error>', { status: 403 })],
    ['length', () => new Response(Buffer.alloc(100, 1), { headers: { 'content-length': '120' } })],
    ['interrupted', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(20))
        controller.error(new Error('offline'))
      },
    }))],
  ]) {
    await assert.rejects(downloadUpdateArtifact(
      'https://accounts.example/artifact',
      path.join(dir, name),
      100,
      digest,
      { fetchImpl: async () => response() },
    ))
    assert.deepEqual(await readdir(dir), [], name)
  }
})

test('private feed serves exactly the verified file without exposing other paths', async t => {
  const dir = await temporary(t)
  const file = path.join(dir, 'MilkSU-macOS-arm64-26.912.2.zip')
  const content = Buffer.from('prepared archive fixture')
  await writeFile(file, content)
  const feed = await createPreparedUpdateFeed(file, '26.912.2')
  t.after(() => feed.close())
  const info = await (await fetch(`${feed.url}latest-mac.yml?noCache=1`)).json()
  assert.equal(info.version, '26.912.2')
  assert.equal(info.files[0].sha512, createHash('sha512').update(content).digest('base64'))
  assert.deepEqual(Buffer.from(await (await fetch(`${feed.url}${info.files[0].url}`)).arrayBuffer()), content)
  for (const requestPath of ['unknown', '../MilkSU-macOS-arm64-26.912.2.zip', '../../etc/passwd']) {
    assert.equal((await fetch(`${feed.url}${requestPath}`)).status, 404)
  }
  assert.equal((await fetch(`${feed.url}latest-mac.yml`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(new URL('/', feed.url))).status, 404)
})

test('owner-writable helper makes copied 0444 licenses writable for ShipIt', async t => {
  const dir = await temporary(t)
  const license = path.join(dir, 'gopls-BSD-3-Clause.txt')
  await writeFile(license, 'license', { mode: 0o444 })
  await ensureOwnerWritable(dir)
  assert.equal((await stat(license)).mode & 0o777, 0o644)
})

test('macOS DMG prepare verifies identity, team and version then dittos a writable zip', async t => {
  const dir = await temporary(t)
  const mount = path.join(dir, 'volume')
  const app = path.join(mount, 'MilkSU.app')
  const commands = []
  await mkdir(path.join(app, 'Contents'), { recursive: true })
  const zip = await prepareMacUpdate(
    path.join(dir, 'MilkSU.dmg'),
    dir,
    '/Applications/MilkSU.app',
    '26.915.2',
    {
      async run(file, args) {
        commands.push([file, ...args])
        if (file === '/usr/bin/hdiutil' && args[0] === 'attach') {
          return { stdout: '', stderr: '' }
        }
        if (file === '/usr/libexec/PlistBuddy' && args[1]?.includes('CFBundleIdentifier')) {
          return { stdout: 'com.milksu.app\n', stderr: '' }
        }
        if (file === '/usr/libexec/PlistBuddy' && args[1]?.includes('CFBundleShortVersionString')) {
          return { stdout: '26.915.2\n', stderr: '' }
        }
        if (file === '/usr/bin/codesign' && args[0] === '-dv') {
          return { stdout: '', stderr: 'TeamIdentifier=48Y78X426T\n' }
        }
        if (file === '/usr/bin/ditto' && args[0] !== '-c') {
          await mkdir(path.join(args[1], 'Contents'), { recursive: true })
          await writeFile(path.join(args[1], 'Contents', 'keep'), 'app', { mode: 0o444 })
          return { stdout: '', stderr: '' }
        }
        if (file === '/usr/bin/ditto' && args[0] === '-c') {
          await writeFile(args[args.length - 1], 'zip')
          return { stdout: '', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      },
    },
  )
  assert.equal(path.basename(zip), 'MilkSU-arm64.zip')
  assert.equal(await readFile(zip, 'utf8'), 'zip')
  assert.equal(commands.some(command => command[0] === '/usr/sbin/spctl'), true)
  assert.equal(await readdir(dir).then(names => names.includes('staged')), false)
})

test('install-time checksum detects a package changed after download', async t => {
  const dir = await temporary(t)
  const file = path.join(dir, 'changed.exe')
  await writeFile(file, 'bad')
  await assert.rejects(verifyArtifact(file, 3, sha256('old')))
})
