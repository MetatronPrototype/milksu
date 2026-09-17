# 界面层搬运清单（只读比对结果，未改任何文件）

- 生成时间：本地 2026-09-17
- 比对对象：本地 Vue 版（`debug/window-batch2`）vs 上游 React 版（`26.917.1`）
- 方法：
  1. 把两边 composable **对外暴露的状态/动作清单**抽出来直接做差集（主运行时 `useConversations`：本地由 `useConversations()` 返回、上游由 `createConversationsRuntime()` 返回）
  2. 对差集逐项**抽查上游是否只是换了名字**（`git grep` 关键字）
  3. 组件层按**文件名集合**比对

---

## 一、结论：真实工作量比"130 个文件"小得多

| 层 | 要重写的量 |
|---|---|
| 状态/动作层 | **约 38 项**（`useConversations` 23 + `useEnvLease` 6 + `useLabJobs` 5 + `useNSSCTF` 4） |
| 组件层 | **新建 2 个**（`CrossConversationNotice`、`EmptyTurnNotice`）+ 改动 **6~8 个**已有组件 |
| 不需要动 | CTF/CVE/Lab 那 5 个 composable、以及上游新增的一批组件 |

> 130 个 `.vue` 里绝大部分差异是 **Vue 与 React 的写法差异**（框架差异），不是行为差异。

---

## 二、上游【已经有了】——不要重写（已抽查确认）

| 行为 | 上游证据 |
|---|---|
| **会话钉选 + 拖动排序** | `App.tsx` 有 `setConversationPinned` / `movePinnedConversation` / `reorderPinnedConversation` |
| **草稿按对话隔离** | `app/src/lib/composerDraftStore.ts`，按 key 存（`readComposerDraft(key)` / `writeComposerDraft(key, …)`） |
| 已结束的思考收进过程 | `#84` 已合并 |
| CTFShow / CTFTrainingPlatforms / CTFWorkspace / NSSCTFTraining / VulnerabilityDashboard | 接口清单差集为**空**（上游已包含本地全部导出项） |
| 命令面板、模型选择器、Working 托盘、分支菜单… | 上游新增（`CommandPanel` / `SearchableModelPicker` / `WorkingTray` / `ComposerBranchMenu`）——**别动** |

---

## 三、上游【缺少】的——需要按 React 改写

### A. 停止机制（7 项）← 你踩过的"停不下来"

```
activeStopPendingAck            activeForceStopReady        activeHardStopFailed
forceStopConversation           activeInjectedGuidance      injectQueuedGuidance
reorderQueuedGuidance           activeQueuedGuidanceInterrupted
```
涉及组件：`ChatPage.tsx`、`ChatComposer.tsx`
注意：后端契约（三级停止：软停 → 硬停 → 本地先结算）**已经搬过来了**（`HardStopSession` / `ClearQueuedMessages` 已在 beta.18 里），所以这里只差界面。

### B. 存活 / 卡住指示（4 项）← "界面谎称模型在回复"

```
activeEngineAlive        activeToolRunning        streamStale        streamStaleSeconds
```
涉及组件：`ChatProcessFold.tsx`、`ChatMessageItem.tsx`、`ChatPage.tsx`
特点：**只依赖已有事件，不需要动后端**。

### C. 跨对话投递的界面（5 项）

```
crossConversationNotices        activeCrossConversationNotices      dismissCrossConversationNotice
deliverAgentMessage             setAgentCollaboration
```
涉及组件：**新建 `CrossConversationNotice.tsx`**、`ChatPage.tsx`
注意：后端（投递、门禁、来源标记）**已在 beta.18 里**。

### D. 空回合提示 + 重试（3 项）

```
emptyTurnNotices        activeEmptyTurnNotices        dismissEmptyTurnNotice
```
涉及组件：**新建 `EmptyTurnNotice.tsx`**、`ChatPage.tsx`

### E. 队列可见性（1 项）

```
activeQueuedBehind
```
涉及组件：`ChatComposer.tsx`、`ChatPage.tsx`
注意：后端排队语义**已在 beta.18 里**。

### F. 其他（2 项）

```
pushEngineNotice（上游有近似实现，需比对）      wakeStuckTurn
```

### G. 环境租约 `useEnvLease.ts`（6 项）

```
address  detail  device  occupyJobTitle  occupyOwner  packageName（等）
```

### H. Lab 任务 `useLabJobs.ts`（5 项）

```
createJob  focusChallenge  rename  selected  touch
```
注意：上游把 lab 任务搬进了 `stores/labJobsStore.tsx`，所以这里要按 store 的形式改。

### I. NSSCTF 训练 `useNSSCTF.ts`（4 项）

```
abandon  openArena  start  workspace
```

### J. 组件层要新建的两个

| 组件 | 用途 |
|---|---|
| `CrossConversationNotice.tsx` | 另一个对话写回来时在角落提示 |
| `EmptyTurnNotice.tsx` | 回合没产出内容时提示可重试 |

> 其余"本地有、上游没有"的组件名（`EnvironmentStrip`、`LabEnvironmentPreview`、`TacticalPanelShell`、`TargetLivePane`、`TargetSurfacePreview`）是**实验室预览/已退役的 tactical 风格**，按 `AGENTS.md` 不该复活 → 建议不做。

---

## 四、建议的推进顺序（每步都可独立验证）

| 序 | 主题 | 项数 | 为什么放这个位置 |
|---|---|---|---|
| 1 | **B 存活/卡住指示** | 4 | 最独立（不动后端）、痛点直接、改 3 个组件即可看到效果 |
| 2 | **D 空回合提示** | 3 | 纯前端 + 1 个新组件，依赖第 1 步的存活判定 |
| 3 | **E 队列可见** | 1 | 后端已就位，界面一处即可 |
| 4 | **A 停止机制** | 7 | 价值最高但最复杂（三级停止的界面状态机），建议在 B 之后做 |
| 5 | **C 跨对话界面** | 5 | 后端已就位；需要新建组件 + 接线 |
| 6 | F / G / H / I | 2+6+5+4 | 按需，优先级最低 |

**验收方式**：每步都 `tsc -b` + `vitest`（现有 101 文件/627 测试）+ 真机跑一次；改到 `useConversations` 时同步补它的单测（上游已有 `useConversations*.test.ts` 可参考）。
