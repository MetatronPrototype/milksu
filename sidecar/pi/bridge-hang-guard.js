/**
 * MilkSU 防挂死守卫（Pi sidecar 扩展）
 *
 * 修两个已确认的缺陷：
 *   1) bash 工具没有默认超时：`resolveTimeoutMs(undefined)` 返回 undefined，
 *      一条命令可以无限期挂住整个回合（现场证据：git fsck 在 iCloud 目录跑了 1 小时 40 分）。
 *   2) 没有 iCloud「仅存云端」文件的预检：批量读取类命令会逐个现下载
 *      （实测约 2 秒/文件；4036 个对象不可行）。
 *
 * 实现要点（与 pi 的钩子契约一致）：
 *   - `tool_call` 钩子拿到的 `event.input` 与随后执行的参数是**同一个对象**，
 *     因此就地写入 `timeout` 会被真正采用；
 *   - 钩子返回 `{ block: true, reason }` 可阻断该次调用；
 *   - pi 的超时实现本身是正确的（detached 进程组 + 结束后整组终止）。
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

export const DEFAULT_BASH_TIMEOUT_SECONDS = 120;
export const MAX_BASH_TIMEOUT_SECONDS = 3600;
export const DATALESS_BLOCK_THRESHOLD = 20;
export const DATALESS_SCAN_TIMEOUT_MS = 2500;
/**
 * The scan stops as soon as this many hits are seen (`head` closes the pipe), so a
 * heavily evicted tree answers in milliseconds instead of walking everything. A tree
 * that has fewer hits than this costs a full walk, which is why the guard also
 * refuses to treat a timed-out scan as "clean" inside an iCloud-synced directory.
 */
export const DATALESS_EARLY_EXIT_LIMIT = DATALESS_BLOCK_THRESHOLD + 1;

/** 需要预检的「批量读取/扫描」类命令：这些会触碰大量文件 */
export const BULK_COMMAND_PATTERNS = [
  /\bgit\s+(fsck|gc|repack|count-objects|cat-file|rev-list|verify-pack|prune|reflog)\b/,
  /\b(grep|egrep|fgrep|rg|ag|ack)\b[^|;]*\s-[a-zA-Z]*[rR]/,
  /\bfind\b/,
  /\bdu\b/,
  /\brsync\b/,
  /\btar\b/,
  /\bxcodebuild\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|ci|i)\b/,
  /\bpip\s+install\b/,
  /\bbrctl\b/,
];

function readPositiveInteger(environment, name, fallback) {
  const raw = environment?.[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function hangGuardConfig(environment = process.env) {
  return {
    enabled: environment?.MILKSU_PI_HANG_GUARD !== "0",
    defaultTimeoutSeconds: readPositiveInteger(
      environment,
      "MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS",
      DEFAULT_BASH_TIMEOUT_SECONDS,
    ),
    maxTimeoutSeconds: readPositiveInteger(
      environment,
      "MILKSU_PI_BASH_MAX_TIMEOUT_SECONDS",
      MAX_BASH_TIMEOUT_SECONDS,
    ),
    datalessGuardEnabled: environment?.MILKSU_PI_DATALESS_GUARD !== "0",
    datalessBlockThreshold: readPositiveInteger(
      environment,
      "MILKSU_PI_DATALESS_BLOCK_THRESHOLD",
      DATALESS_BLOCK_THRESHOLD,
    ),
    datalessScanTimeoutMs: readPositiveInteger(
      environment,
      "MILKSU_PI_DATALESS_SCAN_TIMEOUT_MS",
      DATALESS_SCAN_TIMEOUT_MS,
    ),
  };
}

export function isBulkCommand(command, patterns = BULK_COMMAND_PATTERNS) {
  const text = String(command ?? "");
  if (!text) return false;
  return patterns.some(pattern => pattern.test(text));
}

/**
 * 给一次 bash 调用补上超时。返回实际写入的秒数，未改动时返回 undefined。
 * - 未传 timeout：注入默认值
 * - 传了超过上限的值：收敛到上限
 * - 传了合理值：保持不变
 */
export function applyBashTimeout(input, config) {
  if (!input || typeof input !== "object") return undefined;
  const { defaultTimeoutSeconds, maxTimeoutSeconds } = config;
  const raw = input.timeout;
  const missing = raw === undefined || raw === null || raw === "";
  if (!missing) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    if (value > maxTimeoutSeconds) {
      input.timeout = maxTimeoutSeconds;
      return maxTimeoutSeconds;
    }
    return undefined;
  }
  input.timeout = defaultTimeoutSeconds;
  return defaultTimeoutSeconds;
}

/**
 * The home directory a command's `~` actually resolves to.
 *
 * MilkSU sandboxes the sidecar's own HOME (e.g. `…/com.milksu.app/agent-home`) but runs
 * tool commands with the real user home, and it publishes that as `MILKSU_USER_HOME`.
 * Using `os.homedir()` here silently checked a path that does not exist, which is exactly
 * how the iCloud preflight missed the incident.
 */
export function resolveUserHome(environment = process.env) {
  const configured = String(environment?.MILKSU_USER_HOME ?? "").trim();
  if (configured) return configured;
  try {
    return userInfo().homedir;
  } catch {
    return homedir();
  }
}

function iCloudRoots(home) {
  const homes = Array.isArray(home) ? home : [home];
  const roots = [];
  for (const entry of homes) {
    const base = String(entry ?? "").trim();
    if (!base) continue;
    roots.push(
      join(base, "Documents"),
      join(base, "Desktop"),
      join(base, "Library", "Mobile Documents"),
    );
  }
  return roots;
}

/**
 * Paths whose contents iCloud may keep in the cloud only. Used to decide whether the
 * dataless preflight is worth running at all: outside these roots the scan is skipped.
 */
export function isICloudSyncedPath(directory, options = {}) {
  const { platform = process.platform, home = resolveUserHome() } = options;
  if (platform !== "darwin") return false;
  const target = String(directory ?? "").trim();
  if (!target) return false;
  const resolved = resolvePath(target);
  return iCloudRoots(home).some(root => resolved === root || resolved.startsWith(root + sep));
}

/**
 * Best-effort decision log next to the Pi agent directory. A guard that silently decides
 * not to act is impossible to diagnose from the outside, so every decision (including the
 * skip paths) is recorded in one line.
 */
export function appendGuardLog(line, { home = resolveUserHome(), environment = process.env } = {}) {
  try {
    const base = environment?.MILKSU_PI_AGENT_DIR || join(home, ".pi", "agent");
    mkdirSync(base, { recursive: true });
    appendFileSync(join(base, "hang-guard.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break a tool call */
  }
}

/**
 * Candidate directories a bash command may touch: the session cwd plus every
 * `cd`/`pushd` target in the command itself. The incident that motivated this guard
 * ran `cd ~/Documents/sync-repo && git fsck` from a session whose cwd was NOT under an
 * iCloud root, so inspecting only the session cwd would have missed it entirely.
 */
export function commandDirectories(command, cwd, options = {}) {
  const { home = resolveUserHome() } = options;
  const candidates = [];
  const push = value => {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "-" || raw.startsWith("$")) return;
    let expanded = raw;
    if (expanded === "~") expanded = home;
    else if (expanded.startsWith("~/")) expanded = join(home, expanded.slice(2));
    if (!isAbsolute(expanded)) {
      if (!cwd) return;
      expanded = resolvePath(cwd, expanded);
    }
    candidates.push(expanded);
  };

  push(cwd);

  const text = String(command ?? "");
  const cdPattern = /(?:^|[;&|()\s])(?:cd|pushd)\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|()<>]+))/g;
  for (const match of text.matchAll(cdPattern)) {
    push(match[1] ?? match[2] ?? match[3]);
  }

  return [...new Set(candidates)];
}

/**
 * 统计目录下「仅存于云端」（dataless）的文件数量。
 * 该扫描只读文件标志，不会触发下载；命中达到 limit 即提前结束。
 * 返回 -1 表示无法判定（平台不支持 / 扫描超时 / find 失败）。
 */
export function countDatalessFiles(directory, options = {}) {
  const {
    platform = process.platform,
    spawn = spawnSync,
    scanTimeoutMs = DATALESS_SCAN_TIMEOUT_MS,
    limit = DATALESS_EARLY_EXIT_LIMIT,
  } = options;
  if (platform !== "darwin") return -1;
  const target = String(directory ?? "").trim();
  if (!target) return -1;
  const quoted = `'${target.replace(/'/g, `'\\''`)}'`;
  const result = spawn(
    "/bin/sh",
    ["-c", `find ${quoted} -maxdepth 8 -flags +dataless 2>/dev/null | head -n ${limit}`],
    { timeout: scanTimeoutMs, maxBuffer: 4 << 20, encoding: "utf8" },
  );
  if (!result || result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return -1;
  }
  const lines = result.stdout.split("\n").filter(Boolean);
  return lines.length;
}

export function datalessBlockReason({
  directory,
  count,
  command,
  threshold = DATALESS_BLOCK_THRESHOLD,
  limit = DATALESS_EARLY_EXIT_LIMIT,
}) {
  const capped = count >= limit ? "+" : "";
  const minutes = Math.max(1, Math.round((count * 2) / 60));
  return [
    `MilkSU blocked this bulk command: ${count}${capped} files in the working directory exist only in iCloud`,
    `(evicted locally), so reading them forces on-demand downloads (~2s per file, >= ${minutes} min total,`,
    `and iCloud may evict them again). Threshold: ${threshold}.`,
    ``,
    `Directory: ${directory}`,
    `Command: ${String(command ?? "").slice(0, 200)}`,
    ``,
    `Options:`,
    `1) Download first: run "brctl download '${directory}'" (or Finder > Download Now), then retry.`,
    `2) Narrow the scope to a specific subdirectory or file instead of the whole tree.`,
    `3) Move the project out of ~/Documents (iCloud Desktop & Documents) and retry.`,
    `4) If the user accepts the wait, retry with an explicit timeout argument (e.g. timeout: 3600).`,
  ].join("\n");
}

/**
 * Reason used when the preflight itself could not finish inside its budget inside an
 * iCloud-synced directory: an unreadable or crawling scan is itself evidence that the
 * tree is evicted, so bulk commands are refused rather than silently allowed.
 */
export function datalessUnknownReason({
  directory,
  command,
  scanTimeoutMs = DATALESS_SCAN_TIMEOUT_MS,
}) {
  return [
    `MilkSU blocked this bulk command: the working directory is iCloud-synced and the`, 
    `preflight scan did not finish within ${scanTimeoutMs}ms. A scan this slow is itself a sign`,
    `that the tree is evicted (files present only in the cloud), so a bulk read would be`,
    `unbounded. This guard deliberately fails closed here.`,
    ``,
    `Directory: ${directory}`,
    `Command: ${String(command ?? "").slice(0, 200)}`,
    ``,
    `Options: run "brctl download '${directory}'" first, narrow the scope, move the project`,
    `out of ~/Documents, or disable the preflight with MILKSU_PI_DATALESS_GUARD=0.`,
  ].join("\n");
}

function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

/**
 * 返回一个 Pi 扩展工厂：注册 tool_call 与 tool_result 钩子。
 */
export function createHangGuardExtension({
  environment = process.env,
  platform = process.platform,
  home = resolveUserHome(environment),
  spawn,
  scanCacheTtlMs = 60_000,
} = {}) {
  const config = hangGuardConfig(environment);
  if (!config.enabled) {
    return () => {};
  }
  const cache = new Map();
  const countCached = directory => {
    const now = Date.now();
    const hit = cache.get(directory);
    if (hit && now - hit.at < scanCacheTtlMs) return hit.count;
    const count = countDatalessFiles(directory, {
      platform,
      spawn,
      scanTimeoutMs: config.datalessScanTimeoutMs,
      limit: config.datalessBlockThreshold + 1,
    });
    cache.set(directory, { at: now, count });
    return count;
  };

  return pi => {
    const log = line => appendGuardLog(line, { home, environment });
    log(
      `guard loaded default=${config.defaultTimeoutSeconds}s max=${config.maxTimeoutSeconds}s `
      + `datalessGuard=${config.datalessGuardEnabled} threshold=${config.datalessBlockThreshold}`,
    );

    pi.on("tool_call", async (event, ctx) => {
      try {
        if (event?.toolName !== "bash") return undefined;
        const input = event.input;
        if (!input || typeof input !== "object") return undefined;

        const applied = applyBashTimeout(input, config);
        const command = String(input.command ?? "");
        const bulk = isBulkCommand(command);

        if (!config.datalessGuardEnabled) {
          log(`tool_call bulk=${bulk} timeout=${applied ?? "kept"} datalessGuard=off`);
          return undefined;
        }
        if (!command || !bulk) {
          log(`tool_call bulk=${bulk} timeout=${applied ?? "kept"} -> skip`);
          return undefined;
        }

        // Check every directory the command may touch, not only the session cwd: a
        // command can `cd` into an iCloud-synced tree from anywhere.
        const candidates = commandDirectories(command, ctx?.cwd, { home });
        const synced = candidates.filter(directory => isICloudSyncedPath(directory, { platform, home }));
        if (synced.length === 0) {
          log(`tool_call bulk=true timeout=${applied ?? "kept"} synced=0 -> skip`);
          return undefined;
        }

        for (const directory of synced) {
          const count = countCached(directory);
          if (count < 0) {
            log(`tool_call bulk=true dir=${directory} count=unknown -> block (fail closed)`);
            return {
              block: true,
              reason: datalessUnknownReason({
                directory,
                command,
                scanTimeoutMs: config.datalessScanTimeoutMs,
              }),
            };
          }
          if (count >= config.datalessBlockThreshold) {
            log(`tool_call bulk=true dir=${directory} count=${count} -> block`);
            return {
              block: true,
              reason: datalessBlockReason({
                directory,
                count,
                command,
                threshold: config.datalessBlockThreshold,
                limit: config.datalessBlockThreshold + 1,
              }),
            };
          }
          log(`tool_call bulk=true dir=${directory} count=${count} -> below threshold`);
        }
        return undefined;
      } catch (error) {
        // 守卫自身绝不阻断正常流程，但必须留下痕迹
        log(`tool_call hook error: ${error && error.message ? error.message : error}`);
        return undefined;
      }
    });

    pi.on("tool_result", async (event, ctx) => {
      try {
        if (!event?.isError) return undefined;
        const text = textOf(event.content);
        if (!/timeout[:：]/i.test(text) && !/timed out/i.test(text)) return undefined;
        const directory = ctx?.cwd;
        // Only iCloud roots can hold cloud-only files, so skip the scan elsewhere.
        const synced = commandDirectories(event.input?.command, directory, { home })
          .filter(candidate => isICloudSyncedPath(candidate, { platform, home }));
        const count = synced.length > 0 ? countCached(synced[0]) : 0;
        const lines = [
          "",
          `[MilkSU hang guard] command was terminated by its timeout `
          + `(default ${config.defaultTimeoutSeconds}s, explicit max ${config.maxTimeoutSeconds}s).`,
        ];
        if (count >= config.datalessBlockThreshold) {
          lines.push(
            `Detected ${count} files that exist only in iCloud in ${synced[0]}; `
            + `that is the likely cause. Consider "brctl download" or moving the project out of ~/Documents.`,
          );
        }
        lines.push("For long jobs prefer the background task tools; keep foreground waits bounded.");
        return { content: [...(event.content ?? []), { type: "text", text: lines.join("\n") }] };
      } catch {
        return undefined;
      }
    });
  };
}
