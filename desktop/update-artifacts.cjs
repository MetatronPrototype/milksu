'use strict'

const { execFile } = require('node:child_process')
const { createHash, randomBytes } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { chmod, lstat, mkdir, readdir, rename, rm, stat } = require('node:fs/promises')
const { createServer } = require('node:http')
const { basename, dirname, join } = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const APP_BUNDLE_NAME = 'MilkSU.app'
const APP_BUNDLE_ID = 'com.milksu.app'

async function runCommand(file, args, options = {}) {
  return execFileAsync(file, args, { timeout: 120000, ...options })
}

async function ensureOwnerWritable(root) {
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

function teamIdentifier(output) {
  return /TeamIdentifier=([A-Z0-9]+)/u.exec(String(output ?? ''))?.[1] || ''
}

function feedVersion(version) {
  return String(version ?? '').replace(/^v/iu, '').trim()
}

function responseBody(response) {
  if (!response?.body) return null
  if (response.body[Symbol.asyncIterator]) return response.body
  if (typeof Readable.fromWeb === 'function' && response.body.getReader) {
    return Readable.fromWeb(response.body)
  }
  return response.body
}

function headerValue(response, name) {
  if (typeof response.headers?.get === 'function') return response.headers.get(name)
  if (!response.headers) return null
  return response.headers[name] ?? response.headers[name.toLowerCase()] ?? null
}

async function verifyArtifact(file, size, sha256) {
  const expected = Number(size)
  if (!Number.isSafeInteger(expected) || expected <= 0) {
    throw new Error('安装包大小无效')
  }
  if ((await stat(file)).size !== expected) {
    throw new Error('安装包大小不匹配，请重新下载')
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  if (digest.digest('hex') !== String(sha256).toLowerCase()) {
    throw new Error('安装包 SHA-256 校验失败，请重新下载')
  }
}

async function downloadUpdateArtifact(url, file, size, sha256, {
  signal,
  headers = {},
  fetchImpl = fetch,
  onProgress = () => {},
} = {}) {
  const parsed = new URL(url)
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('更新下载地址无效')
  }
  const expected = Number(size)
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > 5 * 1024 ** 3) {
    throw new Error('发布记录缺少有效的文件大小')
  }
  if (!/^[0-9a-f]{64}$/iu.test(String(sha256))) {
    throw new Error('发布记录缺少有效的 SHA-256')
  }
  const temporary = `${file}.part`
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await rm(temporary, { force: true })
  let received = 0
  try {
    const response = await fetchImpl(url, { headers, signal, redirect: 'follow' })
    if (!response?.ok || !response.body) {
      throw new Error(`更新下载失败（HTTP ${Number(response?.status) || 0}）`)
    }
    const length = headerValue(response, 'content-length')
    if (length !== null && Number(length) !== expected) {
      throw new Error('下载响应大小与发布记录不一致')
    }
    const digest = createHash('sha256')
    const inspect = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        if (received > expected) {
          callback(new Error('安装包超过发布记录大小'))
          return
        }
        digest.update(chunk)
        onProgress(received)
        callback(null, chunk)
      },
    })
    await pipeline(
      responseBody(response),
      inspect,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      { signal },
    )
    if (received !== expected || digest.digest('hex') !== String(sha256).toLowerCase()) {
      throw new Error('安装包完整性校验失败，请重新下载')
    }
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function removeUpdateDirectory(directory) {
  if (!directory) return
  let remove = rm
  if (process.versions.electron) {
    try {
      remove = require('original-fs').promises.rm
    } catch {
      remove = rm
    }
  }
  await remove(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

async function prepareMacUpdate(dmg, directory, currentApp, version, {
  run = runCommand,
} = {}) {
  const mount = join(directory, 'volume')
  const staged = join(directory, 'staged')
  await mkdir(staged, { recursive: true, mode: 0o700 })
  let attached = false
  try {
    await run('/usr/bin/hdiutil', [
      'attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg,
    ])
    attached = true
    const applications = (await readdir(mount)).filter(name => name.endsWith('.app'))
    if (applications.length !== 1 || applications[0] !== APP_BUNDLE_NAME) {
      throw new Error('安装包中没有唯一的 MilkSU 应用')
    }
    const sourceApp = join(mount, applications[0])
    const plist = join(sourceApp, 'Contents', 'Info.plist')
    const identifier = String((await run('/usr/libexec/PlistBuddy', [
      '-c', 'Print :CFBundleIdentifier', plist,
    ])).stdout || '').trim()
    const bundleVersion = String((await run('/usr/libexec/PlistBuddy', [
      '-c', 'Print :CFBundleShortVersionString', plist,
    ])).stdout || '').trim()
    if (identifier !== APP_BUNDLE_ID || bundleVersion !== feedVersion(version)) {
      throw new Error('应用标识或版本与发布记录不一致')
    }
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', sourceApp])
    await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', sourceApp])
    const incoming = await run('/usr/bin/codesign', ['-dv', '--verbose=4', sourceApp])
    const current = await run('/usr/bin/codesign', ['-dv', '--verbose=4', currentApp])
    const team = teamIdentifier(`${incoming.stdout || ''}\n${incoming.stderr || ''}`)
    const currentTeam = teamIdentifier(`${current.stdout || ''}\n${current.stderr || ''}`)
    if (!team || team !== currentTeam) {
      throw new Error('更新应用的签名团队与当前应用不一致')
    }
    const appCopy = join(staged, APP_BUNDLE_NAME)
    await run('/usr/bin/ditto', [sourceApp, appCopy])
    await ensureOwnerWritable(appCopy)
    const zip = join(directory, 'MilkSU-arm64.zip')
    await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appCopy, zip])
    return zip
  } finally {
    if (attached) await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000 })
    await removeUpdateDirectory(staged)
  }
}

async function createPreparedUpdateFeed(file, version) {
  const size = (await stat(file)).size
  const digest = createHash('sha512')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  const sha512 = digest.digest('base64')
  const prefix = `/${randomBytes(32).toString('hex')}/`
  const filename = basename(file)
  const metadata = Buffer.from(JSON.stringify({
    version: feedVersion(version),
    files: [{ url: filename, sha512, size }],
    path: filename,
    sha512,
  }))
  const server = createServer((req, res) => {
    const requestPath = String(req.url || '').split('?')[0]
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    if (
      requestPath === `${prefix}latest.yml`
      || requestPath === `${prefix}latest-mac.yml`
      || requestPath === `${prefix}latest-linux.yml`
    ) {
      res.writeHead(200, {
        'Content-Type': 'application/yaml',
        'Content-Length': metadata.length,
        'Cache-Control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : metadata)
      return
    }
    if (requestPath === `${prefix}${filename}`) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': size,
        'Cache-Control': 'no-store',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(file)
      stream.on('error', () => res.destroy())
      res.on('close', () => stream.destroy())
      stream.pipe(res)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法准备桌面更新')
  }
  return {
    url: `http://127.0.0.1:${address.port}${prefix}`,
    close() {
      return new Promise(resolve => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
        server.close(() => resolve())
      })
    },
  }
}

module.exports = {
  APP_BUNDLE_ID,
  APP_BUNDLE_NAME,
  createPreparedUpdateFeed,
  downloadUpdateArtifact,
  ensureOwnerWritable,
  feedVersion,
  prepareMacUpdate,
  removeUpdateDirectory,
  teamIdentifier,
  verifyArtifact,
}
