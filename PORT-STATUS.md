# 搬运状态与冲突报告（2026-09-17）

- 仓库：`/Users/xiaoxingjiang/MilkSU/Coding/milksu-react`
- 分支：`port/backend`
- 提交：**`d127311`**（Go 层搬运完成）← 基线 `bd3199c`（上游 26.917.1）、`bd146ed`（WIP）
- 结论一句话：**Go 后端层已经全部合完并验证通过；侧车（Node）层和引擎设计合并留作下一步，需要你拍板。**

---

## 一、已经安全合并并验证的部分 ✅

### 验证结果（可复现）

```bash
cd /Users/xiaoxingjiang/MilkSU/Coding/milksu-react
export PATH=/opt/homebrew/bin:$PATH
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
export TMPDIR=/tmp/mk          # 不设这个，hostpath 测试会因 socket 路径过长而失败（在上游基线上同样失败）

go build ./...                                  # 通过
go vet ./internal/... ./cmd/milksu-backend/...  # 通过
go test ./internal/... ./cmd/milksu-backend/    # 32 个包全绿
cd app && ./node_modules/.bin/tsc -b            # 通过
```

### 冲突是怎么解的（规则 + 理由）

| 文件 | 冲突 | 用的规则 | 理由 |
|---|---|---|---|
| `internal/config/settings.go` | 1 处 | **并集** | 上游加字族/字号/`Lab`，我们加 `Network`/`RemoteControl`/`AgentCollaboration`/`PinnedProjects` |
| `internal/conversation/store.go` | 2 处 | **以本地为准 + 补上游字段** | 我们加 `Origin`/`StoredMessageOrigin`；上游加 `ParentConversationID`/`Multitask` |
| `internal/conversation/store_test.go` | 1 处 | **取本地** | 本地多一个 `TestStoreRoundTripsPinnedOrder` |
| `cmd/milksu-backend/app.go` | 4 处 | 1、2 **取上游**；3、4 **并集** | 1、2 是凭据撤销/轮换语义，**上游更成熟**（区分"撤销要停"和"轮换不停"）；3、4 只是相邻的不同函数（`AbortSubagent` vs `StopCodingSession`） |
| `cmd/milksu-backend/desktop_rpc.go` | 2 处 | **并集** | 相邻的 RPC 登记项 |
| `internal/engine/sidecar.go` | 1 处 | **并集** | 上游加 URL 常量，我们加 `MILKSU_PROTECTED_ROOTS`（守卫受保护路径） |
| `app/src/desktop.ts` | 3 处 | **并集** | 相邻的接口声明 |
| `app/src/types.ts` | 2 处 | **并集** | 相邻的类型/字段 |
| `internal/engine/supervisor.go` | 18 处 | **不合并，保留上游设计** | 见下节 |

### 引擎层：只加方法，不动上游设计

`supervisor.go` 有 18 处冲突，本质是**两套并行演进的引擎设计**（上游已有 `maxParkedSidecarsHardLimit` 硬上限、`engineSidecarStoppedEvent` 停止事件，我们本地没有；我们是 `maxParkedSidecars = 6` + `parkedTurnStaleWindow`）。

**决定：保留上游设计，只补 3 个本地新方法**（都是纯新增，只调用上游已有的内部函数）：

```
SettleAgentDelivery    跨对话投递回执
HardStopSession        三级停止的"硬停"（按上游 stopChildProcess(process) 签名改写，去掉了本地的"停止原因"参数）
ClearQueuedMessages    清掉 pi 仍持有的排队消息
```

**代价（明确记录）**：以下本地引擎改动**没有搬进来**（因为都落在冲突区内）：
`parkedSidecarBusy`（刚收到提示的 sidecar 不许回收）、`processBusyLocked`（跑探测也算忙）、
`parkedTurnStaleWindow`、`decrementActiveTurns`（回合统计修正）、"停止原因上报"。

---

## 二、还没处理的冲突（需要你拍板）

### A. `sidecar/pi/bridge.js` — 9 处（侧车接线）

其中 8 处是注释/相邻差异（并集即可），但**第 6 处是真设计差异**：

| | 流式合并实现 |
|---|---|
| **上游** | `queueTextDelta(conversationId, String(update.delta ?? ""))` —— 上游把这个功能重构成了助手函数 |
| **本地** | `streamDeltas.queue("text_delta", conversationId, update.delta)` —— 我们用的是新模块 `bridge-stream-delta.js` |

我们本地那个提交是 `perf(pi): coalesce thinking deltas with the answer stream`（**把"思考"增量也合并**），
上游的 `queueTextDelta` 只合并"正文"增量。

**要你定**：跟上游的助手（简单、不引入我们的模块），还是把我们的 `streamDeltas` 接上（多一个"思考增量合并"的性能收益，但等于替换上游刚写好的实现）。

**这一处不解决，就会有两个测试红**（就是现在唯一红的两个）：
```
✖ every session system prompt carries the iron rule        (bridge-external-content.test.js)
✖ every tool registered in bridge.js is part of the session catalog  (bridge-policy.test.js)
```
原因：新模块（`bridge-external-content.js` 等）已经搬进来了，但 `bridge.js` 没接线，所以"系统提示里没有 Cross-conversation content 那句话"、"注册表里没有那两个被复核过的工具"。

### B. `sidecar/pi/bridge-destructive-delete.js` — 2 处（删除守卫判定）

我们本地的 `stripFdOnlyRedirections`（描述符重定向不算写文件）、`writesPath`（按解析后的真实目标判定）在冲突区内。
上游同一文件已经有 `recursiveDeleteTargets`（我们 #106 的一部分已合）。
**要你定**：这两处守卫判定要不要搬（我建议搬，因为是你最近在追的安全问题）。

### C. 7 个"两边独立新增"的文件 — 不能用三方合并，要人工比对增量

这些文件在共同祖先里不存在（上游和我们各自新增），硬合出来的内容是假的：

| 文件 | 上游 vs 本地 | 说明 |
|---|---|---|
| `sidecar/pi/bridge-hang-guard.js` | **+203 −67** | **iCloud「仅存云端」预检的真实修复**（上游只有基础版） |
| `sidecar/pi/bridge-hang-guard.test.js` | +158 −120 | 同上 |
| `internal/engine/supervisor_parking_test.go` | +158 −228 | 本地改写过测试 |
| `internal/engine/supervisor_credentials_test.go` | +112 −28 | |
| `internal/engine/supervisor_parking_process_test.go` | +4 −1 | |
| `cmd/milksu-backend/destructive_inspect.go` / `_test.go` | 无差异 | **无需搬** |

**要你定**：`bridge-hang-guard.js` 的 iCloud 预检要不要搬（我建议搬，这是你 9-12 那次事故的核心修复）。

### D. `sidecar/dsh/bridge.js` — 1 处（DSH 提示路径的文件追踪）

### E. `internal/engine/supervisor.go` — 18 处（已按上面"保留上游设计"处理，未合并）

---

## 三、当前测试状态

| 范围 | 结果 |
|---|---|
| Go：`go build` / `go vet` / `go test ./internal/... ./cmd/milksu-backend/` | ✅ 全绿（32 包） |
| 前端：`app` 的 `tsc -b` | ✅ 通过 |
| 侧车：`npm run test:sidecar` | ⚠️ 仅 2 个失败（都因 `bridge.js` 未接线，见 A） |

---

## 四、建议的下一步（按价值/风险排序）

1. **B + C**：把守卫判定（`bridge-destructive-delete.js` 2 处）和 iCloud 预检（`bridge-hang-guard.js` +203 −67）搬过来 —— 都是你的安全修复，改动局部，有现成测试。
2. **A**：决定 `bridge.js` 的流式合并跟谁，然后接线（会让剩下 2 个测试转绿）。
3. **D**：DSH 追踪，1 处。
4. **E**：引擎那 18 处 —— 建议**长期不做**，除非你发现上游设计缺了你会遇到的行为（届时针对具体行为打小补丁，而不是整块合）。

## 五、怎么查看/回退

```bash
cd /Users/xiaoxingjiang/MilkSU/Coding/milksu-react
git diff --stat main..port/backend        # 看改了什么
git log --oneline -2                      # d127311 / bd146ed
git checkout main && git branch -D port/backend   # 完全丢弃
```

备份：`/Users/xiaoxingjiang/MilkSU/_backups/react/`（搬运前 bundle + 快照，已校验）

---

# 更新（第二次）：b 已搬完，c/d 需要你拍板

提交：**`89fea39`** `port(sidecar): 搬入删除守卫的后续加固（b）`

## b. `bridge-destructive-delete.js` — ✅ 已完成

**做法**：直接取本地版本。理由（已实测）：**本地是上游的超集**。
上游已经有 `unresolved` 机制、`-lc` 组合 flag 识别、`./x.sh` 识别（这些是 #104/#105/#106 一并带进去的），
本地另有：`stripFdOnlyRedirections`（描述符重定向不算写文件）、`writesPath`（命令自己写的脚本读不到时拒绝）。

**验证**：`node --test sidecar/pi/bridge-destructive-delete.test.js` → **28/28 通过**，
含 `guard-fd`（描述符重定向）、`guard-script-written`（命令自己写的脚本被拒）、
`guard-home`（`~` 先展开）、`guard-inline-flag`、`guard-script-path`。

## c. `sidecar/pi/bridge-hang-guard.js` — ⚠️ 设计冲突，请你决定

**这不是"谁新谁旧"，是两种相反的取舍。** 上游在自己的注释里明确写了立场：

> 「不在这一层判断「哪条命令危险」…… **iCloud 只作为超时之后的解释出现，不作为执行前的拦截理由**」
> 「已有的重复调用熔断只比较多次调用之间有没有新进展，单次调用不返回落在它的判定之外，所以这一层是必要的」

| | 本地 | 上游 |
|---|---|---|
| bash 默认超时 | **120 秒** | **600 秒**（`DEFAULT_BASH_TIMEOUT_SECONDS`） |
| iCloud「仅存云端」检测 | **执行前拦截**（fail closed），扫描超时也拦截 | **不拦截**；`DATALESS_DIAGNOSTIC_THRESHOLD=20` 只用于**超时后**的解释文本 |
| 相关符号 | `datalessBlockReason` / `datalessUnknownReason` / `isBulkCommand` / `appendGuardLog` | `DATALESS_DIAGNOSTIC_THRESHOLD` / `DATALESS_SCAN_TIMEOUT_MS` / `DATALESS_EARLY_EXIT_LIMIT` |
| 9-12 那次 `git fsck` 卡 1 小时 40 分 | 根本不让它开始 | 10 分钟被超时终止，然后解释"可能是 iCloud" |
| 代价 | 可能误拦合法命令；扫描本身有成本 | 最坏白等 10 分钟 |

**两条路都能解决那次事故，但不是同一个产品行为，必须你定。**

## d. `sidecar/dsh/bridge.js` — ❌ 建议不搬

本地相对上游是 **+88 −671**：**本地删掉了 671 行**，而上游的 DSH 已经大幅演进
（0.1.6 完整内核、官方 Messages、host plugin 独立 ESM 等）。**搬过去等于回退上游的 DSH 工作。**
本地只有两个小函数（`sessionMcpServers`、`respondWorkspaceAction`），若确实需要，应针对具体行为单独打小补丁。

## 当前测试现状

| 范围 | 结果 |
|---|---|
| Go：`go build` / `go vet` / `go test ./internal/... ./cmd/milksu-backend/` | ✅ 全绿（32 包） |
| 前端：`app` 的 `tsc -b` | ✅ 通过 |
| 侧车：`npm run test:sidecar` | **727 / 729 通过**；仅剩 2 个红，都因 `bridge.js` 未接线 |

---

# 更新（第三次）：c 按你的要求实现（先问用户 + 确认后放行 + 超时兜底）

提交：见下一条。

## c 的最终形态：不是"硬拒绝"，也不是"不拦"，而是"暂停一次去问用户"

按你的指示实现：

1. **执行前暂停**：批量命令落在 iCloud 驱逐目录时，守卫**暂停**它，并给出完整信息
   （目录、`N+` 个仅存云端文件、约 2 秒/文件、预计 ≥M 分钟、阈值）。
2. **第一步明确要求先问用户**：文案里 `Step 1 — tell the user before anything else: ask with milksu_ask …`
   （测试断言已锁住 `milksu_ask` 必须出现）。
3. **用户同意后放行**：模型带**显式 timeout** 重跑时，守卫视其为"用户已确认"，
   解除暂停（`tool_call lifts the iCloud pause when the caller passes an explicit timeout`）。
4. **超时照旧兜底**：默认 120 秒、上限 3600 秒；`tool_result` 在超时结果上仍追加 iCloud 诊断。
5. 扫描超时（数不清文件）时同样**暂停并去问用户**，而不是静默放行。

验证：`node --test sidecar/pi/bridge-hang-guard.test.js` → **29/29 通过**（新增 1 个行为测试）。

## ⚠️ 一个需要你知道的差异：bash 默认超时

| | 值 |
|---|---|
| 我们本地（现在搬进来的） | **120 秒**（`MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS` 可调） |
| 上游 | **600 秒** |

搬的是本地版本，所以现在是 120 秒。**对非 iCloud 的长构建可能偏短**（2 分钟就被终止）。
一行环境变量或一个常量即可调整，等你决定。

## d 的决定：不搬（已按上面第二节的理由）

`sidecar/dsh/bridge.js` 本地相对上游是 +88 −671，搬过去会回退上游的 DSH 演进。未做。

## 剩余未决：a（`bridge.js` 接线）

侧车 735 个测试里只剩 2 个红，都因 `bridge.js` 未接线：
- `every session system prompt carries the iron rule`（缺 "Cross-conversation content" 那句）
- `every tool registered in bridge.js is part of the session catalog`（注册表里缺两个被复核过的工具）

`bridge.js` 有 9 处冲突，其中 **1 处是真设计差异**：流式合并
（上游 `queueTextDelta` 只合并正文；我们的 `streamDeltas` 连"思考"增量也合并）。

---

# 完成（第四次）：a 已接上，搬运收尾

提交：**`057c501`** `port(sidecar): 接上 bridge.js（a）——思考增量也合并`

## 全绿验证（可复现）

```bash
cd ~/MilkSU/Coding/milksu-react
export PATH=/opt/homebrew/bin:$PATH
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
export TMPDIR=/tmp/mk

go build ./...                                      # 通过
go test ./internal/... ./cmd/milksu-backend/        # 全绿
(cd app && ./node_modules/.bin/tsc -b)              # 通过
npm --prefix app run test                           # 101 文件 / 627 测试全过
npm run test:sidecar                                # 736 / 736
```

## 这一轮解决的冲突（a：bridge.js 9 处）

| 处 | 内容 | 规则 |
|---|---|---|
| 1、2 | 导入（补 background-wake / stream-delta / destructiveDeleteApproval） | 并集 |
| 3、8、9 | 会话状态表 | 并集 |
| **4、6** | **流式合并实现** | **取本地（streamDeltas：思考+正文共用 60ms 管道）** |
| 5 | 工具注册 | 并集（`request_destructive_delete` + `deliver_to_conversation` 都要） |
| 7 | 注释 | 取本地 |

## 顺带修正：`bridge-workflow-prompt.js`

上游把 **subagent / isolated browser 两段引导从系统提示里移除了**（上游测试用 `doesNotMatch` 明确锁住这一点，
这也是它删掉 `subagentGuidance`/`browserGuidance` 变量的原因）。
所以这里**不能取本地版本**，做法是：保留上游结构 + 只追加我们的两段
（`visibleProgressRule`、「跨对话内容」铁律），并补一个只针对"工具调用前必须有可见正文"的测试。

## 仍未搬运的（明确记录，都是刻意决定）

| 项 | 原因 |
|---|---|
| `internal/engine/supervisor.go` 的 18 处设计冲突 | 上游已并行演进（有停靠池硬上限、停止事件）；本地那 5 项微调未搬 |
| `sidecar/dsh/bridge.js` | 本地是旧版（−671 行），搬过去会回退上游 DSH |
| 本地引擎 5 项微调 | `parkedSidecarBusy` / `processBusyLocked` / `parkedTurnStaleWindow` / `decrementActiveTurns` / 停止原因上报 |
| bash 默认超时 | 现在是本地的 **120 秒**；上游是 600 秒（待决定） |

## 下一步（未执行）

用这个分支重新构建试验田（`MILKSU_REPO=~/MilkSU/Coding/milksu-react bash 试验田打包安装.sh`），
得到 `beta.18` = React 界面 + 上面这些搬过来的修复。

---

# 更新（第五次）：按你的决定改引擎设计 + 超时

## 关键发现：「引擎设计跟我的」不能整块替换

试过才知道：本地的 `internal/engine/supervisor.go` 不只是"停靠池设计不同"，而是**一个更老的引擎**，
缺整块上游后来的工作：

```
engine.SessionHandoffResult / WorkspaceForSession / AbortMessage 签名
QueueMessage / ListDshCommands / ExecuteDshCommand / DshCommandDescriptor / DshCommandResult / DshPlanMode
```

这些是 **DSH 运行时支持**（上游"接入 0.1.6 完整内核"那批）。整块替换 = 把 DSH 支持删掉。
所以只能**以上游引擎为底，把你的设计逐项改上去**。已恢复并逐项实施。

## 已实施（都在上游引擎上做的小改动）

| 项 | 内容 |
|---|---|
| 停靠池上限 | `maxParkedSidecars` **3 → 6**（你的设定；硬上限随之 6 → 12） |
| 刚收到指令的保护 | 新增 `lastPromptAt`：`writeToSessionLocked` 写完命令即记录；回收候选判定里 30 秒内视为忙 |
| 还在说话的保护 | 新增 `lastActivity`：`readEvents` 每读到一行即记录；30 秒内视为忙 |
| 跑探针也算忙 | 新增 `workspaceHasWaiterLocked`：工作区里任一会话在等 `probeWaiters` / `controlWaiters` / `recoveryWaiters` 时，该停靠 sidecar 不参与回收 |
| bash 默认超时 | **120 → 600 秒**（跟上游） |

改动集中在 `oldestParkedCandidateLocked` 的 `requireIdle` 判据上，**不动上游的硬上限与停止事件**。

验证：`go build` ✅、`go test ./internal/... ./cmd/milksu-backend/` 全绿、
前端 vitest 101 文件 / 627 测试 ✅、侧车 736/736 ✅、hang-guard 29/29 ✅

## ② 里剩下的 3 项（未做，各自需要单独一轮）

| 项 | 为什么单独做 |
|---|---|
| `parkedTurnStaleWindow` | 上游已有"硬上限"来兜住同类泄漏（转弯不报完成时仍会被回收）。两套机制合并要先决定策略，否则重复设防反而难懂 |
| `decrementActiveTurns` | 绑在本地"每进程 activeTurns 计数器"的设计上；上游用的是 supervisor 级会话状态（`busySessions`），不是同一套 |
| 停止原因上报 | 要给事件结构加 `Reason` 字段，并改 `stopChildProcess` 的签名和**全部 7 处调用点** |

## ① 中未采纳的部分（明确记录）

`staleSidecarGraceTimeout` 保留上游的 **75 分钟**（本地是 10 分钟）。
上游注释里写明理由：hang guard 允许单次 bash 跑到 3600 秒，宽限短于这个上限会**杀掉仍在合法工作的回合**。
本地那 10 分钟与之矛盾，采纳会引入该回归。

---

# 更新（第六次）：③ 停止原因上报已搬（① 按建议不搬）

## ③ 停止原因上报 —— ✅ 已完成（用你的）

在上游引擎上实现（不动上游任何策略）：

| 改动 | 内容 |
|---|---|
| `childProcess.stopReason atomic.Value` | 记录"为什么被停" |
| `stoppedReason(process)` | 读取该原因；自然死亡返回空 |
| `stopChildProcess(process, reason)` | 由 1 参数改为 2 参数，并打印一行结构化日志（reason / pid / workspace / stale / retired） |
| `engine.sidecar_stopped` 事件 | 带上 `Reason`（复用上游 Event 已有的 `Reason` 字段，未新增字段） |
| `engine.stopped` 事件 | 同样带上 `Reason` |

8 处调用点各自的原因：

```
parked-reap         停靠池回收
retired             轮换后退役
credential-revoked  凭据被撤销
shutdown            应用关停（pi / dsh / parked / retiring 四处）
hard-stop           三级停止的硬停
```

新增测试：`TestStopChildProcessRecordsWhyItStopped`（含 nil 进程、初值为空、后写覆盖）。

## ① `parkedTurnStaleWindow` —— ❌ 不搬（按建议保持上游）

判据是"最后输出之后多久"，值为 10 分钟。但：
- bash 默认超时现在是 **600 秒**（正好 10 分钟），最大 3600 秒
- 一个正在执行的长命令**全程不产生输出** → 会被判成"安静太久" → 回收 → **杀掉正在跑的回合**
- 上游对同类机制（`staleSidecarGraceTimeout`）明确写了这个理由，并把值设为 75 分钟（大于命令上限）
- 上游的 `maxParkedSidecarsHardLimit`（现为 12）已覆盖防泄漏

## ② `decrementActiveTurns` —— ❌ 不需要（上游已修同类问题）

上游在 `error` 与 `session_destroyed` 两条路径上都会 `delete(s.busySessions, sessionID)`，
注释与本地提交的意图一致（"turn_settled ends only the turn"）。机制不同，覆盖相同。

## 全绿验证

Go 全绿（含 `go vet`）、前端 `tsc` + 627 测试、侧车 736/736。

---

# 界面层搬运进度（B→D→E→A→C）

分支 `port/backend`（未推送）。每步都已 `tsc` + `vitest` 验证并单独提交。

| 步 | 状态 | 提交 | 说明 |
|---|---|---|---|
| **B 存活/卡住指示** | ✅ 完成 | `6461486` | 4 个派生值 + 停止横幅 + 诚实文案；测试 3 条 |
| **D 空回合提示** | ⏭️ 跳过 | — | 上游已有：`hasEmptyVisibleReply` + `shouldRetainAssistantWithoutText`（含"只有思考没正文"），界面已有「这一轮没有可见正文」+ 继续 |
| **E 队列可见性** | ✅ 完成 | `566658e` | `sidecarKeyOf` / `turnOwnsSidecar` / `engineHolderFor` / `activeQueuedBehind`；测试 1 条 |
| **A 三级停止** | ✅ 完成 | `3c45e9a` + `705eda8` | 第 1 级上游已有；补第 2 级（重试仍失败 → 可强制）与第 3 级（本地结算 + 硬停 + 30 秒迟到事件守卫）；紧急开关放**输入框右上角外侧**、仅 `activeForceStopReady` 时出现；测试 1 条 |
| **C 跨对话界面** | ⏳ 未开始 | — | 见下 |

## C 的现状与实现要点（下一轮直接用）

**上游在渲染层完全没有投递机制**：`submitAgentDelivery` / `settleAgentDelivery` / `settle_agent_delivery` / `deliverAgentMessage` / `CrossConversationNotice` / `normalizeDeliveryKind` / `agentCollaboration` 全是 0 命中。
（但 `types.ts` 里 `Message.origin` / `MessageOrigin` 已经在 ✅，后端 RPC `DeliverAgentMessage` / `SettleAgentDelivery` 也已在 beta.18 ✅）

要补的 5 项（本地参考：`debug/window-batch2` 的 `useConversations.ts`）：

1. `crossConversationNotices` + 合并逻辑（本地 1066-1105 行）：按 (conversationId, sourceId) 合并、`count` 累加、`summary` 截 120 字
2. `activeCrossConversationNotices`（按 activeId 过滤）
3. `dismissCrossConversationNotice(id)`
4. `deliverAgentMessage(input)` → 依赖本地内部的 `submitAgentDelivery`（本地 2471 行）+ 限流 `allowAgentDelivery`（10 秒内同向最多 5 条）
5. `setAgentCollaboration(value)`（把 `AgentCollaborationConfig` 镜像进渲染层；注意 `settings.go` 里的封印校验已在后端生效）

另需：
- 新建 `app/src/components/CrossConversationNotice.tsx`（本地对应 `components-vue/CrossConversationNotice.vue`）
- 转写里按 `Message.origin` 显示来源徽标
- `settleAgentDelivery(sourceId, requestId, status, detail)` → `invokeCommand('settle_agent_delivery', …)`（RPC 已有）

## 还剩下的其它活

1. **A 的 4 项引导**（`injectQueuedGuidance` / `reorderQueuedGuidance` / `activeInjectedGuidance` / `activeQueuedGuidanceInterrupted`）——与输入区耦合最紧，放最后
2. **重编 beta.19** 装进试验田（`MILKSU_REPO=…milksu-react bash 试验田打包安装.sh`），之后才能实际看到 B/E/A

## 用户已拍板的决定（不要再问）

| 事项 | 决定 |
|---|---|
| 温和停止 vs 强制停止 | **共存**：正常停止按钮=上游温和停止；温和停止重试仍失败后，在**输入框右上角外侧**出现强制停止 |
| "第一击就地结算"（`pendingStopAckIds`） | **不搬**，保留上游"等引擎确认"的语义（`activeStopPendingAck` 已按上游语义映射为 `abortingIds`） |
| 停靠池上限 | 6（硬上限 12） |
| bash 默认超时 | 600 秒 |
| `staleSidecarGraceTimeout` | 保留上游 75 分钟（本地 10 分钟会杀掉合法长回合） |
| A 的 4 项引导 | 要做，放最后 |
| 重编 | 全部改完再编 beta.19 |

## C 分成两半做（第一半已完成，第二半未做）

**已完成（提交 `13e5a42`）——显示侧**：
`CrossConversationNotice` 类型 + store 状态 `crossConversationNotices` +
`pushCrossConversationNotice`（按 对话+来源 合并、count 累加、摘要截 120 字）+
`dismissCrossConversationNotice` + `activeCrossConversationNotices` + `normalizeDeliveryKind`；
新建 `app/src/components/CrossConversationNotice.tsx`；ChatPage 转写流顶部渲染。
测试：`app/src/composables/useConversationsNotice.test.ts`（4 条）。

**未完成——功能侧（这才是让跨对话真正能用的一半）**：

1. **`agent-delivery` 事件处理器**（后端已发，渲染层目前完全忽略 → 投递永远不会落到目标对话，
   工具等不到 ack 只能报"未确认"）。后端注释写明：App 只做校验+发事件，
   "它自己不启动回合；渲染层掌握调度，由它按目标的真实状态决定排队还是启动"。
   事件负载：`{ targetConversationId, text, origin{conversationId,conversationTitle,agent,deliveredAt}, kind, requestId }`
   （`cmd/milksu-backend/app_agent_delivery.go`，`agentDeliveryEventName = "agent-delivery"`）
   处理器要做：决定排队/启动 → 写进目标对话 → `settleAgentDelivery(sourceId, requestId, status, detail)`
   （RPC `settle_agent_delivery` 已搬，Go 侧在 `app_agent_delivery.go`）→ `pushCrossConversationNotice`
2. **`send()` 需要接受「目标对话 + origin」**（本地版签名末尾多了 `target, origin` 两个参数）。
   这是整个端口里最敏感的一处改动：上游 `send()` 是核心发送路径，动它会影响
   空闲对账、排队消息消费、重派发等路径。务必单独一趟、慢慢做。
3. `deliverAgentMessage` / `submitAgentDelivery`（发出侧）+ `buildExternalMessageEnvelope`
   + `queuedDeliverySources` + `notifyUnappliedDeliveries`（"未送达"回执）
4. `setAgentCollaboration` + `canReplyTo` / `allowsResultReply` / `agentDeliveryDecision`
   （回复许可；后端 `SetAgentCollaboration` 已搬）

**注意**：显示侧已就绪，但在第 1 项落地前界面不会出现任何提示（没人调用 push），
所以这一半单看是"看得见但不会亮"的。

### C 功能侧：动手前已经核实过的事实（2026-09-17 核实）

**第一步已完成**（提交 `ecb8881`）：`send()` 末尾新增两个可选参数
`targetConversationId?: string` / `origin?: MessageOrigin`，内部只改两行、
都带 `?? s.activeId` 回退；现有调用方一个没动；tsc + 636 测试与改动前完全一致。

**第二步要用的、已核实的事实**：

1. 事件名 `"agent-delivery"`，由 `App.DeliverAgentMessage` 唯一发出
   （`cmd/milksu-backend/app_agent_delivery.go:418`）。后端**只校验+发事件+返回 "announced"**，
   不写目标对话（Go 侧无任何落库路径）。
2. 渲染层监听方式（已核实 `app/src/desktop.ts:1382` `listenEvent` 会把值包成 `{ payload }`）：
   `listenEvent<AgentDeliveryEvent>('agent-delivery', event => { const payload = event.payload ... })`
   参照 `useConversations.ts:3187` 的 `engine-event` 写法；注意 `disposeEvents` 只有一个变量，
   要另加一个 disposer 并在卸载处一起释放。
3. 负载字段（`agentDeliveryEvent` 的 json tag，已核实）：
   `{ targetConversationId, text, origin: { conversationId, conversationTitle, agent, deliveredAt }, kind?, requestId? }`
4. 回执 RPC（已核实 `app/src/desktop.ts:471`）：
   `invokeCommand('settle_agent_delivery', { conversationId, requestId, status, detail })`
   参数名就是 `conversationId / requestId / status / detail`；`status` 是
   `'delivered' | 'queued' | 'refused'` 字符串。**不调用它，工具会一直等到超时才报“未确认”。**
5. 处理器应做（对照本地 `useConversations.ts` 约 3360-3412 行）：
   取 targetId/text/origin/kind/requestId → 用 `send(text, text, [], undefined, undefined, -1, targetId, origin)`
   投递 → 按真实结果 `settleAgentDelivery(sourceId, requestId, status, detail)` →
   `pushCrossConversationNotice({ conversationId: targetId, sourceId, kind, summary: text, at })`。

## C 全部完成 ✅（`13e5a42` 显示侧、`148b124` 功能侧、`82e11f1` 协作开关界面）

跨对话投递现在真的可用：侧车工具 → 后端校验（同项目/白名单/限流/熔断/封印）
→ `agent-delivery` 事件 → 渲染层落库 + 回执 + 到达提示。

界面三处：
1. 到达提示（转写流顶部，只读、可关闭）
2. 设置 → Agent 协作 → 「允许跨项目投递」总开关（立即落盘；被封印时额外说明）
3. 会话列表「⋯ → 可访问的对话」：单向名单 + 「同时允许对方回复我」

**没搬的东西（有意为之）**：
- `deliverAgentMessage` / `submitAgentDelivery` / `buildExternalMessageEnvelope` 的渲染层发送路径
  —— 本地没有任何界面调用它们（已核实），真实路径是侧车工具 → 后端。
- 渲染层的投递门禁（`agentDeliveryDecision` / `canReplyTo` / `allowsResultReply`）与
  `setAgentCollaboration` 的渲染层镜像 —— 权威在后端，渲染层不重复实现一份策略。

**下一步只剩两件**：
1. A 的 4 项引导（`injectQueuedGuidance` / `reorderQueuedGuidance` /
   `activeInjectedGuidance` / `activeQueuedGuidanceInterrupted`）——与输入区耦合最紧
2. 重编 beta.19 装进试验田

## 界面层搬运全部完成 ✅（B、E、A、C + A 的引导四项；D 上游已有而跳过）

最后一个提交：`0583a61`（A 引导四项：并入本轮 / 拖动重排 / 中断标记）。

`PORT-UI-INVENTORY.md` 里列的界面缺项至此全部处理完毕。剩下的只有两件非代码的事：
1. 打包 beta.19 并装进试验田（用 `试验田打包安装.sh`，脚本自带门牌号校验、旧包自动留 .bak）
2. 上机验收：B/E/A 的存活与停止指示、C 的跨对话投递、引导的加入本轮

## 跨对话投递的两个真断点（盲测发现，已修）

用户要求"真发一条给 TestA/B/C，不准偷看结果"，结果三条全部
`Unconfirmed: ... did not report the outcome before the wait timed out`。
查后端日志：**一条 [delivery] announced 都没有**（最后一条停在 9/16 23:42）。

链路本该是两跳，**两跳都缺**：

```
侧车工具 → broker.request
  → emit 引擎事件 agent.delivery（stdout JSON 行）
  → [跳1] 渲染层转给后端 RPC deliver_agent_message（后端校验+发公告）   ← 上游完全没有（本地 useConversations.ts:3711 有）
  → 后端发桌面事件 agent-delivery
  → [跳2] 渲染层落库 + settle 回执                                   ← 已在第一次 C 里补好
  → 侧车 broker.respond → 工具拿到真结果
```

另外还有一层：**Go 的桥接结构体把字段丢了**。侧车 stdout 写的是
`{type, id, ...data}` 平铺 JSON，宿主用结构体解析；上游的结构体既没有
`targetConversationId` / `deliveryOrigin`，也没有 raw 的 `text`
（本地 supervisor.go 都有：DeliveryOrigin 5 处 / TargetConversationID 3 处），
于是 Unmarshal 时静默丢掉 → 渲染层收到空壳 → 分支 return → 后端从未被通知。

修复提交：`e93a5cb`（渲染层第 1 跳）+ `cf73d0a`（Go 字段与转发）。
回归测试：原来那条投递测试只造 `{Type, ID}`，所以字段丢了也测不出来——已补齐断言。

**教训**：先前判断"deliverAgentMessage 没用"只查了"有没有组件调用"，
没查 composable 自己的事件分支；也没意识到"跨语言桥接的结构体字段缺失"
会让一个功能整条静默失败。

## 跨对话投递的第三个断点：命令队列死锁（已修）

前两个断点修完、beta.21 上机重测**仍然超时**。但这次后端日志给出了关键信息：

```
[delivery] announced source=6a195ccb… target=4da74902…   ← 请求到了后端
[delivery] settled   source=6a195ccb… status=delivered    ← 渲染层也结算了
```

也就是说消息**真的落进目标对话了**，回执也算出了 delivered，但**判决没回到侧车**。

根因在侧车的命令分发：`bridge.js` 用一个 promise 链把命令**严格串行**处理

```js
commandQueue = commandQueue.then(() => handleCommand(command))
```

而 `sendMessage` 会 `await` 整轮（`session.prompt`），所以**一轮运行期间整条队列被占住**。
绕开队列的名单里有 `abort_session` / `approval_response` / `steer_message`（各自有独立队列）
等——**唯独没有 `delivery_response`**。于是"回答正在等待的那个工具调用"这条命令，
被排在**正在等它的那一轮**后面，永远排不到；工具 15 秒超时（`DELIVERY_ACK_TIMEOUT_MS`）。

这是**死锁式的设计缺陷，上游和本地都有**（本地也只在 switch 里，没有绕开队列）。
修法：像 `approval_response` 一样立即处理（它本身是同步的，只 resolve 一个 promise）。

`bridge.js` 是纯执行脚本、没有任何导出，所以这个修复**无法写单测**，只能靠端到端验证
（侧车 736 个测试全过，但都不覆盖分发顺序）。

### 三次盲测的教训汇总

| # | 断点 | 层次 |
|---|---|---|
| 1 | 渲染层没有 `agent.delivery` 分支 | React 前端 |
| 2 | Go 桥接结构体丢字段（target/origin/text） | Go 引擎 |
| 3 | `delivery_response` 被串行队列堵死 | 侧车分发 |

**一条功能可以跨三个语言层同时断掉，而每一层单独看都"像是好的"。**
盲测（真的发一条）是唯一能发现这种事的方法——静态检查、单测全绿都盖不住。

## 跨对话投递端到端验证通过 ✅（beta.23，2026-09-17 23:35）

三个断点全部修完后，重发三条，工具**第一次拿到了真实回执**（此前三次都是
"Unconfirmed: ... did not report the outcome before the wait timed out"）：

```
Delivered: MilkSU accepted the message for fa500e38… (TestA) and dispatched it.
Delivered: MilkSU accepted the message for db73405a… (TestB) and dispatched it.
Delivered: MilkSU accepted the message for 4da74902… (TestC) and dispatched it.
```

判决能回到发信方，说明整条往返链路都通了：

```
侧车工具 → broker.request
  → 引擎事件 agent.delivery（stdout JSON）
  → Go 解析（字段必须存在）→ 转发给渲染层
  → 渲染层转 RPC deliver_agent_message → 后端校验 + 发公告
  → 渲染层落库 + settle 回执
  → Go 写 delivery_response 给侧车（必须绕开串行命令队列）
  → broker.respond → 工具拿到 verdict
```

**缺任何一环都只会得到超时**。这也说明这类跨语言链路无法靠单层检查发现——
只能真发一条看回执。
