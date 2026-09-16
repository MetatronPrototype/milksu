import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("host plugin loads as an ES module from a .mjs path", async () => {
  const loaded = await import(pathToFileURL(join(here, "host-plugin.mjs")).href);
  assert.equal(loaded.name, "milksu-dsh-host");
  assert.deepEqual(loaded.inject, ["compaction", "agents"]);
  assert.ok(loaded.optionalInject.includes("permissionPresets"));
  assert.ok(loaded.optionalInject.includes("subagents"));
  assert.equal(typeof loaded.apply, "function");
  assert.equal(typeof loaded.dispatch, "function");
});

test("host plugin lists and interrupts through ctx.subagents", async () => {
  const loaded = await import(pathToFileURL(join(here, "host-plugin.mjs")).href);
  const interrupted = [];
  const ctx = {
    agents: { get: (id) => (id === "acp_1" ? { id } : null) },
    subagents: {
      async listChildren() {
        return [{
          kind: "child",
          id: "cf4fb9a2",
          activity: "running",
          mode: "continuable",
          label: "环境巡检",
        }];
      },
      interruptByParent(childId, parentId) {
        interrupted.push({ childId, parentId });
      },
      async drainContinuableChildren() {},
    },
  };
  const listed = await loaded.dispatch(ctx, new Set(), {}, {
    method: "list_subagents",
    params: { sessionId: "acp_1" },
  });
  assert.deepEqual(listed.subagentTasks, [{
    id: "cf4fb9a2",
    role: "环境巡检",
    status: "running",
    toolCallId: "cf4fb9a2",
  }]);
  await loaded.dispatch(ctx, new Set(), {}, {
    method: "interrupt_subagent",
    params: { sessionId: "acp_1", subagentId: "cf4fb9a2" },
  });
  assert.deepEqual(interrupted, [{ childId: "cf4fb9a2", parentId: "acp_1" }]);
});

test("Sidecar package bundles the host plugin so DSH can load it from a CommonJS tree", () => {
  const packager = readFileSync(join(here, "..", "..", "scripts", "package-sidecar.mjs"), "utf8");
  assert.match(packager, /bundleDshHostPlugin/);
  assert.match(packager, /host-plugin\.mjs/);
  assert.match(packager, /format: 'esm'/);
});
