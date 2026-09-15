import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { ensureOwnerWritable } from '../../scripts/lib/bundle-owner-writable.mjs'
import {
  assertShipItCanClearQuarantine,
  ownerUnwritableFiles,
  walkRegularFiles,
} from '../../scripts/lib/shipit-quarantine-ready.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'milksu-shipit-'))
  const license = join(root, 'THIRD_PARTY-LICENSES', 'gopls-BSD-3-Clause.txt')
  await mkdir(join(root, 'THIRD_PARTY-LICENSES'), { recursive: true })
  await writeFile(license, 'license', { mode: 0o644 })
  await chmod(license, 0o444)
  return { root, license }
}

test('ShipIt gate rejects the same 0444 license that aborted 26.915.1', async () => {
  const { root, license } = await fixture()
  try {
    const blocked = ownerUnwritableFiles(await walkRegularFiles(root))
    assert.deepEqual(blocked, [license])
    await assert.rejects(
      assertShipItCanClearQuarantine(root, { xattrPaths: [license] }),
      /not owner-writable/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('after owner-writable repair, ShipIt can set and clear quarantine', async () => {
  const { root, license } = await fixture()
  try {
    await ensureOwnerWritable(root)
    const result = await assertShipItCanClearQuarantine(root, { xattrPaths: [license] })
    assert.equal(result.cleared, 1)
    assert.equal(ownerUnwritableFiles(await walkRegularFiles(root)).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
