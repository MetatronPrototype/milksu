export function isDshSubagentToolName(name) {
  const value = String(name ?? "").trim().toLowerCase();
  return value === "subagent" || value.startsWith("subagent:");
}

export function dshSubagentRole(rawInput, fallback = "subagent") {
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    const label = String(
      rawInput.description ?? rawInput.label ?? rawInput.task ?? rawInput.prompt ?? "",
    ).trim();
    if (label) return label.slice(0, 80);
  }
  const fallbackLabel = String(fallback ?? "").trim();
  return fallbackLabel || "subagent";
}

export function acpToolContentText(update) {
  const content = update?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    const text = block?.content?.text ?? block?.text ?? "";
    return text ? [String(text)] : [];
  }).join("\n");
}

export function parseDshSubagentStart(content) {
  const text = String(content ?? "");
  const continuable = text.match(/\bstarted subagent\s+([A-Za-z0-9_-]+)\b/i);
  if (continuable?.[1]) {
    return { id: continuable[1], mode: "continuable" };
  }
  const job = text.match(/\bstarted background subagent job\s+([A-Za-z0-9_-]+)\b/i);
  if (job?.[1]) {
    return { id: job[1], mode: "job" };
  }
  return null;
}

export function upsertSubagentTask(tasks, next) {
  const current = Array.isArray(tasks) ? tasks : [];
  const incoming = next && typeof next === "object" ? next : null;
  const id = String(incoming?.id ?? "").trim();
  const role = String(incoming?.role ?? "").trim();
  const status = String(incoming?.status ?? "").trim();
  if (!incoming || !id || !role || !status) return current;
  const toolCallId = String(incoming.toolCallId ?? "").trim();
  const index = current.findIndex((item) => (
    item.id === id
    || (toolCallId && item.toolCallId === toolCallId)
    || (toolCallId && item.id === toolCallId)
    || (item.toolCallId && item.toolCallId === id)
  ));
  const task = {
    id,
    role,
    status,
    toolCallId: toolCallId || incoming.toolCallId,
  };
  if (index < 0) return [...current, task];
  return current.map((item, currentIndex) => (
    currentIndex === index ? { ...item, ...task } : item
  ));
}

export function applyDshSubagentToolUpdate(tasks, update) {
  const kind = String(update?.sessionUpdate ?? update?.session_update ?? "");
  const toolCallId = String(update?.toolCallId ?? update?.tool_call_id ?? "").trim();
  if (kind === "tool_call") {
    const title = String(update?.title || update?.kind || "");
    if (!isDshSubagentToolName(title)) return tasks;
    return upsertSubagentTask(tasks, {
      id: toolCallId || title,
      role: dshSubagentRole(update?.rawInput, title),
      status: "running",
      toolCallId: toolCallId || undefined,
    });
  }
  if (kind !== "tool_call_update" || !toolCallId) return tasks;
  const current = Array.isArray(tasks) ? tasks : [];
  const existing = current.find((item) => (
    item.id === toolCallId || item.toolCallId === toolCallId
  ));
  if (!existing && !isDshSubagentToolName(update?.title)) return tasks;
  const status = String(update?.status ?? "");
  const text = acpToolContentText(update);
  const started = parseDshSubagentStart(text);
  if (started) {
    return upsertSubagentTask(current, {
      id: started.id,
      role: existing?.role || dshSubagentRole(update?.rawInput, "subagent"),
      status: "running",
      toolCallId,
    });
  }
  if (status !== "completed" && status !== "failed") return current;
  if (!existing) return current;
  return upsertSubagentTask(current, {
    ...existing,
    status: status === "failed" ? "failed" : "succeeded",
  });
}
