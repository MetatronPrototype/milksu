import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

// The host hands the absolute protected roots over at spawn. The sidecar is where tools run,
// so this is the only place a write can be refused before it happens.
export const PROTECTED_ROOTS_ENV = "MILKSU_PROTECTED_ROOTS";

// .git/hooks is an execution-injection point anywhere on disk, so it is matched by shape
// rather than by root.
const GIT_HOOKS_SHAPE = /(^|[\\/])\.git[\\/]hooks([\\/]|$)/;

function normalizePath(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return resolve(trimmed).replace(/[\\/]+$/, "");
}

function isInside(candidate, root) {
  if (!candidate || !root) return false;
  if (candidate === root) return true;
  return candidate.startsWith(root + sep);
}

export function parseProtectedRoots(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const roots = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const path = normalizePath(entry.path);
    if (!path) continue;
    roots.push({ path, label: String(entry.label ?? "").trim() || "protected" });
  }
  return roots;
}

// The runtime data directory, derived from the collaboration root the host sets
// (`<dataDir>/agent-home/coding-collaboration`). Used only when the host did not pass roots.
export function dataDirectoryFromEnvironment(env = process.env) {
  const collaborationRoot = String(env.MILKSU_CODING_COLLABORATION_ROOT ?? "").trim();
  if (!collaborationRoot) return "";
  return dirname(dirname(normalizePath(collaborationRoot)));
}

// Roots the host did not pass (development, or an older host) still need closing: the coding
// roots are derived from this session's own workspace and the real user home.
export function derivedProtectedRoots({ workspace, userHome, dataDirectory } = {}) {
  const roots = [];
  const home = String(userHome ?? "").trim() || homedir();
  if (dataDirectory) {
    roots.push({ path: normalizePath(dataDirectory), label: "runtime-data" });
  }
  const normalizedWorkspace = normalizePath(workspace);
  if (!normalizedWorkspace) return roots;
  const codingRoot = normalizePath(join(home, "MilkSU", "Coding"));
  if (isInside(normalizedWorkspace, codingRoot)) {
    roots.push({ path: codingRoot, label: "coding-workspaces" });
  }
  const scratch = /^(.*[\\/]agent-workspaces[\\/]Coding)[\\/]/.exec(normalizedWorkspace);
  if (scratch?.[1]) {
    roots.push({ path: normalizePath(scratch[1]), label: "coding-workspaces" });
  }
  return roots;
}

export function mergeProtectedRoots(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const root of list ?? []) {
      if (!root?.path || seen.has(root.path)) continue;
      seen.add(root.path);
      merged.push(root);
    }
  }
  // Most specific first, so the audit label names the narrowest root that matched.
  return merged.sort((left, right) => right.path.length - left.path.length);
}

/**
 * The violation, or null. `.git/hooks` is checked before the workspace exception: it is an
 * execution-injection point, so it is never writable - not even inside the session's own
 * tree. The session's own workspace is otherwise always writable.
 */
export function protectedWriteViolation(
  target,
  { roots = [], enforcedRoots = [], ownWorkspace } = {},
) {
  const candidate = normalizePath(target);
  if (!candidate) return null;
  if (GIT_HOOKS_SHAPE.test(candidate)) return { path: candidate, label: "git-hooks" };
  // 读者在设置里指定的受限文件夹优先于「会话自己的 workspace 永远可写」那条例外：
  // 他要保护的往往正是自己项目里的某个目录。内置清单不走这一支（它们的作用域仍按原来的
  // 顺序判定，否则主目录那条会把整个工作区都盖住）。
  let enforced = null;
  for (const root of enforcedRoots) {
    if (!isInside(candidate, root.path)) continue;
    if (!enforced || root.path.length > enforced.path.length) enforced = root;
  }
  if (enforced) return { path: candidate, label: enforced.label };
  const workspace = normalizePath(ownWorkspace);
  if (workspace && isInside(candidate, workspace)) return null;
  // Name the narrowest root that matched, whatever order the host sent them in.
  let best = null;
  for (const root of roots) {
    if (!isInside(candidate, root.path)) continue;
    if (!best || root.path.length > best.path.length) best = root;
  }
  return best ? { path: candidate, label: best.label } : null;
}

// Shell words that name a write target. Anything not listed is not a write this guard
// understands, and is left alone: the guard must never refuse a read.
const SINGLE_TARGET_COMMANDS = new Set(["cp", "mv", "install", "ln"]);
const ALL_TARGET_COMMANDS = new Set(["rm", "truncate", "touch", "mkdir", "chmod", "chown"]);

// Split a command line into segments on the shell operators that end one command.
function commandSegments(command) {
  return String(command ?? "")
    .split(/(?:\r?\n|;|&&|\|\||\|)/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

// Tokenize one segment, keeping quoted words whole and dropping the quotes themselves.
function segmentTokens(segment) {
  const tokens = [];
  let current = "";
  let quote = "";
  let started = false;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (quote) {
      if (character === "\\" && quote === "\"" && index + 1 < segment.length) {
        current += segment[index + 1];
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = "";
        continue;
      }
      current += character;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    // A redirect is its own token so the target after it can be read directly.
    if (character === ">") {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      const next = segment[index + 1];
      if (next === ">") {
        tokens.push(">>");
        index += 1;
      } else {
        tokens.push(">");
      }
      continue;
    }
    current += character;
  }
  if (started || current) tokens.push(current);
  return tokens;
}

// The concrete paths a shell command can write to. Relative targets resolve against the
// command's own working directory, exactly as the shell would.
function shellWriteTargets(command, { env = process.env, bindings = new Map(), cwd = "" } = {}) {
  const targets = new Set();
  let currentCwd = String(cwd ?? "");
  // Judge a relative write target by where the shell would really put it: `cd <dir> && ... > f`
  // writes inside <dir>, not inside the session workspace.
  const resolveTarget = (target) => {
    const expanded = expandShellTarget(target, env, bindings);
    if (!expanded) return "";
    if (expanded.startsWith("/")) return expanded;
    if (expanded.startsWith("~")) return expandShellTarget(expanded, env, bindings);
    return currentCwd ? join(currentCwd, expanded) : expanded;
  };
  for (const segment of commandSegments(command)) {
    const tokens = segmentTokens(segment);
    if (!tokens.length) continue;
    const leadingName = String(tokens[0] ?? "").split("/").pop();
    if (leadingName === "cd") {
      const destination = tokens.slice(1).find(token => !token.startsWith("-"));
      if (destination) {
        const resolved = expandShellTarget(destination, env, bindings);
        if (resolved.startsWith("/")) currentCwd = resolved;
        else if (currentCwd) currentCwd = join(currentCwd, resolved);
      }
      continue;
    }
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if ((token === ">" || token === ">>") && tokens[index + 1]) {
        targets.add(resolveTarget(tokens[index + 1]));
      }
    }
    const commandName = String(tokens[0] ?? "").split("/").pop();
    const args = tokens.slice(1).filter(token => token !== ">" && token !== ">>");
    const plain = args.filter(token => !token.startsWith("-"));
    if (commandName === "tee") {
      for (const token of plain) targets.add(resolveTarget(token));
      continue;
    }
    if (commandName === "dd") {
      for (const token of args) {
        if (token.startsWith("of=")) targets.add(resolveTarget(token.slice(3)));
      }
      continue;
    }
    if (commandName === "sed") {
      if (args.some(token => token.startsWith("-i")) && plain.length) {
        targets.add(resolveTarget(plain[plain.length - 1]));
      }
      continue;
    }
    if (SINGLE_TARGET_COMMANDS.has(commandName)) {
      if (plain.length) targets.add(resolveTarget(plain[plain.length - 1]));
      continue;
    }
    if (ALL_TARGET_COMMANDS.has(commandName)) {
      for (const token of plain) targets.add(resolveTarget(token));
    }
    // `git config`/`hook` style commands write inside `.git`; the resolved path check below
    // covers them through the `.git/hooks` shape and the protected roots.
  }
  return targets;
}

// Expand the variables a shell would expand, so `$HOME/...` is judged by where it really
// points rather than by its text.
function expandShellTarget(target, env = process.env, bindings = new Map()) {
  let value = String(target ?? "").trim();
  if (!value) return "";
  if (value === "~" || value.startsWith("~/")) {
    // The shell expands `~` to $HOME, which for a sidecar is the isolated runtime home.
    value = join(String(env.HOME ?? "").trim() || homedir(), value.slice(1));
  }
  value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced ?? bare;
    if (name === "HOME") return String(env.HOME ?? homedir());
    if (name === "PWD") return String(env.PWD ?? env.MILKSU_USER_HOME ?? "");
    if (name === "MILKSU_USER_HOME") return String(env.MILKSU_USER_HOME ?? "");
    if (bindings.has(name)) return bindings.get(name);
    return match;
  });
  return value;
}

/**
 * The violation for a shell command, or null. Only writes are considered: a read that merely
 * mentions a protected path is ordinary work and must pass. This is still a soft guard - a
 * deliberately obfuscated command can slip past - but it must never be a coin flip, and it
 * must never block a read.
 */
// The shell variables the command binds itself (`D=/path; ... > $D/f`). Ignoring them hands
// the agent a ready-made way around a protected folder - that was the real bug: the write was
// created through a variable, so the literal-path check never saw a protected path at all.
// Values are expanded to a fixed point, so a variable built from another variable still counts.
function shellVariableBindings(command, env = process.env) {
  const bindings = new Map();
  for (const segment of commandSegments(command)) {
    for (const token of segmentTokens(segment)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(token);
      if (!match) continue;
      const raw = match[2].replace(/^["']|["']$/g, "");
      bindings.set(match[1], raw ? expandShellTarget(raw, env, bindings) : "");
    }
  }
  return bindings;
}

// Commands that can put bytes on disk. Used only by the strict-when-in-doubt branch below.
// Commands whose whole job is to put bytes on disk.
const WRITE_COMMAND_NAMES = new Set([
  "rm", "rmdir", "mv", "cp", "install", "ln", "touch", "truncate", "mkdir", "mkfifo",
  "chmod", "chown", "chgrp", "rsync", "tar", "unzip", "patch", "tee", "dd", "ed",
]);
// Interpreters and editors can write, but only when the script says so: a plain
// `sed 's/x/y/' file` or `python -c 'print(1)'` is a read and must never be blocked.
const WRITE_CAPABLE_COMMAND_NAMES = new Set([
  "python", "python3", "node", "perl", "ruby", "sh", "bash", "zsh", "osascript", "awk",
  "sed", "ex", "vi", "vim", "nano", "emacs", "git", "find", "xargs", "sqlite3",
]);
const WRITE_ACTIVITY_SHAPE = /(?:open\s*\([^)]*["'](?:w|a|x)|writeFile|write_text|appendFile|>\s*["']?\/|(?:^|\s)-i\b|<<-?\s*["']?\w|hook|chmod|truncate|cp\b|mv\b|rm\b)/;

const DISCARD_TARGET_SHAPE = /^\/dev\/(?:null|stdout|stderr|tty)$/;

function commandHasWriteIntent(command, { env = process.env, bindings = new Map(), cwd = "" } = {}) {
  const text = String(command ?? "");
  // Real write targets only: `2>/dev/null` and `>/dev/null` discard output, they do not write,
  // and a read that merely contains a `>` must still pass.
  for (const target of shellWriteTargets(text, { env, bindings, cwd })) {
    const expanded = expandShellTarget(target, env, bindings);
    if (expanded && !DISCARD_TARGET_SHAPE.test(expanded)) return true;
  }
  for (const segment of commandSegments(text)) {
    const tokens = segmentTokens(segment);
    const name = String(tokens[0] ?? "").split("/").pop();
    if (!name) continue;
    const inPlace = /(?:^|\s)-i/.test(segment);
    if (WRITE_COMMAND_NAMES.has(name)) {
      if (name === "sed" && !inPlace) continue;
      return true;
    }
    if (SINGLE_TARGET_COMMANDS.has(name) || ALL_TARGET_COMMANDS.has(name)) return true;
    if (WRITE_CAPABLE_COMMAND_NAMES.has(name) && (name === "sed" ? inPlace : WRITE_ACTIVITY_SHAPE.test(segment))) {
      return true;
    }
  }
  return false;
}

function protectedViolationForPath(candidate, { roots = [], enforcedRoots = [], ownWorkspace } = {}) {
  const expanded = String(candidate ?? "").trim();
  if (!expanded) return null;
  if (!expanded.startsWith("/") && !expanded.startsWith("~")) return null;
  return protectedWriteViolation(expanded, { roots, enforcedRoots, ownWorkspace });
}

// Strict when in doubt: if the command can write and any path it mentions (after expanding its
// own variables) lands inside a protected root, block it and say why. Reads still pass - only
// commands that can write are judged here. "Cannot tell, so let it through" is exactly the
// crack the agent kept widening.
function protectedCommandMentionViolation(
  command,
  { roots = [], enforcedRoots = [], ownWorkspace, bindings = new Map(), env = process.env } = {},
) {
  for (const value of bindings.values()) {
    const violation = protectedViolationForPath(
      expandShellTarget(value, env, bindings),
      { roots, enforcedRoots, ownWorkspace },
    );
    if (violation) return { ...violation, reason: "protected-path-in-command" };
  }
  for (const segment of commandSegments(command)) {
    for (const token of segmentTokens(segment)) {
      if (token === ">" || token === ">>" || token.startsWith("-")) continue;
      const violation = protectedViolationForPath(
        expandShellTarget(token, env, bindings),
        { roots, enforcedRoots, ownWorkspace },
      );
      if (violation) return { ...violation, reason: "protected-path-in-command" };
    }
  }
  return null;
}

/**
 * What the **agent** is told when it is blocked. Deliberately different from the notice the
 * reader sees: the reader is told "it was blocked", the agent is told "this road is closed, do
 * not look for another one". The reader's own words: an agent that is not told will keep
 * hunting for a way in.
 */
export function protectedAgentNotice(violation, locale) {
  const target = String(violation?.path ?? "").trim() || "(the path you tried to write)";
  const throughVariable = violation?.reason === "protected-path-in-command";
  if (String(locale ?? "") === "en") {
    return "Blocked: " + target + " is inside a folder on the reader's protected list "
      + "(Settings, Files, protected folders), so agents may not write there."
      + (throughVariable
        ? " This command was blocked because it pointed at that folder through a shell variable"
          + " or after a cd, not because of how it was spelled."
        : "")
      + " Do not work around it: do not retry with a shell variable, a cd, another tool, or "
      + "another spelling of the path - the write stays blocked and repeated attempts stop the "
      + "turn. The only way through is for the reader to remove that folder in Settings (or turn "
      + "the master switch off): tell them what you need written and where, and wait for them.";
  }
  return "已拦截：" + target + " 在读者的「受限文件夹」列表里（设置 → 文件 → 受限文件夹），"
    + "agent 不能写入。" + (throughVariable
      ? "这条命令被拦不是因为写法，而是它通过 shell 变量或 cd 指到了那个目录。"
      : "")
    + "**不要绕过**：不要改用 shell 变量、cd、别的工具或别的路径拼法再试 —— 写入仍会被拒，"
    + "反复尝试会终止本轮。唯一可行的是让读者在设置里把该目录移出列表（或关掉总开关）："
    + "把你要写什么、写到哪里告诉读者，等读者处理。";
}

export function protectedCommandViolation(
  command,
  { roots = [], enforcedRoots = [], ownWorkspace, cwd, env = process.env } = {},
) {
  const text = String(command ?? "");
  if (!text.trim()) return null;
  const base = String(cwd ?? ownWorkspace ?? env.HOME ?? "").trim();
  const bindings = shellVariableBindings(text, env);
  for (const raw of shellWriteTargets(text, { env, bindings, cwd: base })) {
    let resolved = expandShellTarget(raw, env, bindings);
    if (!resolved) continue;
    // A `$=`-style suffix or a trailing quote leftover is not a path we can judge.
    if (!isAbsolute(resolved)) {
      resolved = base ? join(base, resolved) : resolved;
    }
    if (!isAbsolute(resolved)) continue;
    const violation = protectedWriteViolation(resolved, { roots, enforcedRoots, ownWorkspace });
    if (violation) return violation;
  }
  if (commandHasWriteIntent(text, { env, bindings, cwd: base })) {
    const mentioned = protectedCommandMentionViolation(text, {
      roots,
      enforcedRoots,
      ownWorkspace,
      bindings,
      env,
    });
    if (mentioned) return mentioned;
  }
  return null;
}
