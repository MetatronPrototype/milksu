import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const QUARANTINE = 'com.apple.quarantine'
const QUARANTINE_VALUE = '0081;00000000;MilkSU;00000000-0000-0000-0000-000000000000'

export async function walkRegularFiles(root) {
  const files = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const info = await lstat(current)
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) {
      for (const name of await readdir(current)) stack.push(join(current, name))
      continue
    }
    if (info.isFile()) files.push({ path: current, mode: info.mode })
  }
  return files
}

export function ownerUnwritableFiles(files) {
  return files.filter(file => (file.mode & 0o222) === 0).map(file => file.path)
}

export async function clearQuarantineAttribute(file) {
  await execFileAsync('/usr/bin/xattr', ['-w', QUARANTINE, QUARANTINE_VALUE, file])
  await execFileAsync('/usr/bin/xattr', ['-d', QUARANTINE, file])
}

export async function assertShipItCanClearQuarantine(appPath, {
  xattrPaths = [],
} = {}) {
  const files = await walkRegularFiles(appPath)
  const blocked = ownerUnwritableFiles(files)
  if (blocked.length > 0) {
    const preview = blocked.slice(0, 8).join('\n')
    throw new Error(
      `ShipIt cannot install this bundle: ${blocked.length} files are not owner-writable\n${preview}`,
    )
  }
  const targets = [...new Set(xattrPaths.filter(Boolean))]
  for (const file of targets) {
    await clearQuarantineAttribute(file)
  }
  return { fileCount: files.length, cleared: targets.length }
}
