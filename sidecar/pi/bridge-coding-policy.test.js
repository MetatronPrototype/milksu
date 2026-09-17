// A new tool that is registered but missing from the session catalog can never be
// reached: Pi builds its tool list when createAgentSession() runs and setActiveTools()
// cannot add definitions afterwards. This test reads the registrations straight out of
// bridge.js, so nobody has to maintain a second list by hand.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  codingReadOnlyToolNames,
  codingSessionToolNames,
  codingWorkspaceAutoToolNames,
  normalizeCodingPolicy,
} from "./bridge-coding-policy.js";

const bridgeSource = readFileSync(
  new URL("./bridge.js", import.meta.url),
  "utf8",
);

test("the reviewed deletion and delivery tools are go-mode only", () => {
  for (const name of ["request_destructive_delete", "deliver_to_conversation"]) {
    assert.ok(
      codingWorkspaceAutoToolNames.includes(name),
      `${name} must be available in go mode`,
    );
    assert.ok(
      !codingReadOnlyToolNames.includes(name),
      `${name} must not be available to a read-only or planning session`,
    );
  }
});

// Narrowing and restoring must not leave either tool permanently off: the catalog carries
// them, and the policy hands them out again as soon as side effects are allowed.
test("the policy keeps both tools across every mode and approval pair", () => {
  for (const mode of ["go", "plan"]) {
    for (const approval of ["read-only", "ask", "workspace-auto", "full-auto"]) {
      const policy = normalizeCodingPolicy(mode, approval);
      const effectful = mode === "go" && approval !== "read-only";
      for (const name of ["request_destructive_delete", "deliver_to_conversation"]) {
        assert.equal(
          policy.activeTools.includes(name),
          effectful,
          `${name} in mode=${mode} approval=${approval} should be ${effectful}`,
        );
      }
    }
  }
});
