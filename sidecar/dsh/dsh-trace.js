// TEMPORARY (defect 10 trace): write-only diagnostics for the DSH bridge.
// Pure I/O; every failure is swallowed and no behaviour is changed.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export function dshTracePath() {
  const appData = String(process.env.MILKSU_APPDATA_DIR ?? "").trim();
  if (appData) return join(appData, "runtime", "dsh-bridge.log");
  return "/tmp/milksu-dsh-bridge.log";
}

export function dshTrace(event, fields = {}) {
  try {
    appendFileSync(dshTracePath(), `${new Date().toISOString()} ${event} ${JSON.stringify(fields)}\n`);
  } catch {
    // Diagnostics must never break the bridge.
  }
}
