import { chmod, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// ShipIt strips quarantine from every file in the replacement .app. A 0444
// license copied from npm/Go modules makes that chmod fail, so the installer
// relaunches the old bundle and looks like a successful restart.
export async function ensureOwnerWritable(root) {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const info = await lstat(current)
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) {
      await chmod(current, 0o755)
      for (const name of await readdir(current)) stack.push(join(current, name))
      continue
    }
    if (info.isFile()) {
      await chmod(current, (info.mode & 0o111) !== 0 ? 0o755 : 0o644)
    }
  }
}
