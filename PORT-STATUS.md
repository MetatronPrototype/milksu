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
