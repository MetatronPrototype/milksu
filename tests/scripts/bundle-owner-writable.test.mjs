import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { ensureOwnerWritable } from '../../scripts/lib/bundle-owner-writable.mjs'

test('owner-writable helper turns 0444 license files into 0644 without dropping executables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-writable-'))
  try {
    const licenses = join(root, 'THIRD_PARTY-LICENSES')
    const bin = join(root, 'node')
    const license = join(licenses, 'gopls-BSD-3-Clause.txt')
    await mkdir(licenses, { recursive: true, mode: 0o755 })
    await writeFile(license, 'license', { mode: 0o644 })
    await writeFile(bin, '#!/bin/sh\n', { mode: 0o755 })
    await chmod(license, 0o444)
    await chmod(bin, 0o555)
    await chmod(licenses, 0o555)
    await ensureOwnerWritable(root)
    assert.equal((await stat(license)).mode & 0o777, 0o644)
    assert.equal((await stat(bin)).mode & 0o777, 0o755)
    assert.equal((await stat(licenses)).mode & 0o777, 0o755)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
