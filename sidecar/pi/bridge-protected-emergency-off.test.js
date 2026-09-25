import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTECTED_DISABLED_ENV,
  derivedProtectedRoots,
  protectedCommandViolation,
  protectedGuardDisabled,
  protectedWriteViolation,
} from "./bridge-protected-paths.js";

// 读者的原话：怕出问题「连救都救不了」。所以加了紧急关闭：
// 环境变量 MILKSU_PROTECTED_DISABLED=1（引擎也会把数据目录下的 agent-protection-off
// 文件转成它）⇒ 整套受限保护失效，包括内置根、读者列表、git-hooks 硬规则与侧车派生根。
// 这条测试两个方向都要证明：默认一定拦，开关一开一定放行，关掉一定立刻回来。
test("紧急关闭：一条路全关（含内置与读者列表），关掉立刻回来", (t) => {
  const opts = {
    roots: [
      { path: "/Users/me/data", label: "runtime-data" },
      { path: "/Applications/MilkSU.app", label: "app-bundle" },
    ],
    enforcedRoots: [{ path: "/Users/me/private", label: "protected" }],
  };
  const bundleFile = "/Applications/MilkSU.app/Contents/Resources/app.asar";
  const hook = "/Users/me/proj/.git/hooks/pre-commit";

  delete process.env[PROTECTED_DISABLED_ENV];
  t.after(() => {
    delete process.env[PROTECTED_DISABLED_ENV];
  });

  // 基线：默认必须拦住（否则下面的放行断言毫无意义）
  assert.equal(protectedGuardDisabled(), false);
  assert.ok(protectedWriteViolation(bundleFile, opts), "基线：App 本体应被拦");
  assert.ok(protectedWriteViolation("/Users/me/private/a.txt", opts), "基线：读者列表应被拦");
  assert.ok(protectedWriteViolation(hook, opts), "基线：git-hooks 硬规则应被拦");
  assert.ok(
    protectedCommandViolation(`cp x ${bundleFile}`, opts),
    "基线：命令判定应被拦",
  );

  // 打开紧急关闭
  process.env[PROTECTED_DISABLED_ENV] = "1";
  assert.equal(protectedGuardDisabled(), true);
  assert.equal(protectedWriteViolation(bundleFile, opts), null, "紧急关闭后 App 本体必须放行");
  assert.equal(protectedWriteViolation("/Users/me/private/a.txt", opts), null, "紧急关闭后读者列表必须放行");
  assert.equal(protectedWriteViolation(hook, opts), null, "紧急关闭后 git-hooks 硬规则必须放行");
  assert.equal(
    protectedCommandViolation(`cp x ${bundleFile}`, opts),
    null,
    "紧急关闭后命令判定必须放行（含「写目标看不到就宁严勿松」那一支）",
  );
  assert.deepEqual(
    derivedProtectedRoots({
      workspace: "/Users/me/MilkSU/Coding/x",
      userHome: "/Users/me",
      dataDirectory: "/Users/me/data",
    }),
    [],
    "紧急关闭后侧车自己派生的根也不得生效",
  );

  // 关掉开关 ⇒ 保护立刻回来
  delete process.env[PROTECTED_DISABLED_ENV];
  assert.equal(protectedGuardDisabled(), false);
  assert.ok(protectedWriteViolation(bundleFile, opts), "关掉开关后必须立刻恢复拦截");
});
