# PORT-NOTES：把本地 Go/sidecar 修复搬到 React 基线（进行中，停止状态）

- 生成时间：本地 2026-09-17 17:0x（CST）
- 仓库：`/Users/xiaoxingjiang/MilkSU/Coding/milksu-react`
- 分支：**`port/backend`**，WIP 提交 **`bd146ed`**（基线 `bd3199c` = 上游 26.917.1）
- 状态：**编译不过，不可发布**。这是刻意的中间状态，用来保存已完成的部分。
- 未推送、未合并、不影响 `main`，也不影响你正在用的试验田（那是另一个 App 包）。

---

## 一、这个分支上有什么

| 类别 | 数量 | 说明 |
|---|---|---|
| ✅ 上游没有的新文件（直接取本地版本） | **31** | 见下面清单 |
| ✅ 三方合并自动成功 | **26** | 本地与上游改的是不同位置，git 自己合上了 |
| ⏸ 已退回上游（暂不合） | **14** | 12 个真冲突 + 2 个两边独立新增的文件 |

合计 46 个文件、**+7374 / −44**。

### 31 个新文件（已搬进来）

```
远端控制整包
  internal/remotecontrol/manager.go          1569 行
  internal/remotecontrol/manager_test.go      801 行
  internal/remotecontrol/page.go              493 行
  cmd/milksu-backend/app_remote.go            371 行
  cmd/milksu-backend/app_remote_actions.go    300 行
  cmd/milksu-backend/app_remote_recorder.go   247 行
  cmd/milksu-backend/app_remote_recorder_test.go / app_remote_test.go

跨对话投递
  cmd/milksu-backend/app_agent_delivery.go         451 行
  cmd/milksu-backend/app_agent_delivery_test.go    412 行
  sidecar/pi/bridge-delivery.js / .test.js
  sidecar/pi/bridge-external-content.js / .test.js

网络代理
  internal/netproxy/proxy.go                   175 行
  internal/netproxy/proxy_test.go               81 行
  cmd/milksu-backend/app_network.go            198 行
  cmd/milksu-backend/app_network_test.go        82 行

守卫与 agent 行为
  sidecar/pi/bridge-protected-paths.js         260 行   ← 受保护路径拒写
  sidecar/pi/bridge-protected-paths.test.js    191 行
  sidecar/pi/bridge-visible-progress.js         98 行   ← 每次工具调用前必须有一句正文
  sidecar/pi/bridge-visible-progress.test.js   110 行
  sidecar/pi/bridge-workflow-prompt.*                          ← 只提醒不阻断
  sidecar/pi/bridge-turn-heartbeat.*                           ← 回合心跳
  sidecar/pi/bridge-stream-delta.js / .test.js                 ← 流式增量
  sidecar/pi/bridge-background-wake.js / .test.js
  sidecar/pi/bridge-coding-policy.test.js
  sidecar/dsh/dsh-trace.js
  internal/engine/sidecar_protected_roots_test.go
```

---

## 二、为什么现在编译不过（关键的咬合关系）

干净搬过来的新文件**依赖冲突文件里的本地新增接口**，所以必须一起合：

```
cmd/milksu-backend/app_network.go
  → 需要 config.NetworkConfig、settings.Network          ← 在 internal/config/settings.go（冲突）

cmd/milksu-backend/app_agent_delivery.go
  → 需要 config.AgentCollaborationConfig                 ← internal/config/settings.go（冲突）
  → 需要 settings.SetAgentCollaboration                  ← internal/config/settings.go（冲突）
  → 需要 engines.SettleAgentDelivery                     ← internal/engine/supervisor.go（冲突）

internal/engine/sidecar_protected_roots_test.go
  → 需要 protectedRootsVariable                          ← internal/engine（冲突）

internal/config/settings_test.go
  → 需要 AgentCollaborationConfig                        ← internal/config/settings.go（冲突）
```

复现命令：

```bash
cd /Users/xiaoxingjiang/MilkSU/Coding/milksu-react
export PATH=/opt/homebrew/bin:$PATH
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk   # 本机必需，否则链接会报 arm64e.x1-macos
go build ./... 2>&1 | grep -vE 'tapi error|unknown architecture|^\s|^/Library' | head
```

---

## 三、待解的冲突（14 个文件 / 46 处）

```
 18 处  internal/engine/supervisor.go            +898
  9 处  sidecar/pi/bridge.js                     +407
  4 处  cmd/milksu-backend/app.go                +105
  2 处  sidecar/pi/bridge-destructive-delete.js  +405
  2 处  sidecar/pi/bridge-destructive-delete.test.js +478
  2 处  internal/conversation/store.go            +44
  2 处  cmd/milksu-backend/desktop_rpc.go         +20
  1 处  internal/engine/sidecar.go                +82
  1 处  internal/engine/supervisor_test.go       +141
  1 处  internal/conversation/store_test.go       +74
  1 处  internal/config/settings.go              +248
  1 处  sidecar/pi/bridge-workflow-prompt.js       +5
  1 处  sidecar/dsh/bridge.js                     +46
```

### 另外 5 个文件：两边各自独立新增，不能三方合并，要人工比对增量

（这 7 个文件在共同祖先里都不存在，所以"base"是空的，硬合出来的内容是假的。已退回上游。）

| 文件 | 上游 vs 本地差异 | 处置 |
|---|---|---|
| `cmd/milksu-backend/destructive_inspect.go` | 无差异 | 无需搬 |
| `cmd/milksu-backend/destructive_inspect_test.go` | 无差异 | 无需搬 |
| `internal/engine/supervisor_credentials_test.go` | +112 −28 | 待比对 |
| `internal/engine/supervisor_parking_process_test.go` | +4 −1 | 待比对 |
| `internal/engine/supervisor_parking_test.go` | +158 −228 | 待比对（本地改写过） |
| `sidecar/pi/bridge-hang-guard.js` | **+203 −67** | **待比对（iCloud 预检真实修复）** |
| `sidecar/pi/bridge-hang-guard.test.js` | +158 −120 | 待比对 |

---

## 四、最重要的发现：上游已经把这些文件演进过了

冲突**不能一律用本地版本**，否则会回退上游的改进。实测（`git grep <标识> <commit>`）：

### 上游有、本地没有（直接用上游）

| 标识 | 上游 | 本地 |
|---|---|---|
| `maxParkedSidecarsHardLimit`（停靠池硬上限，防进程泄漏） | 2 文件 | **0** |
| `engineSidecarStoppedEvent`（sidecar 停止事件） | 2 文件 | **0** |

上游 `supervisor.go` 里 `maxParkedSidecars = 3` + 硬上限 + 75 分钟宽限，注释比本地完整；
本地是 `maxParkedSidecars = 6` + `parkedTurnStaleWindow`。**这是两套并行演进的设计。**

### 上游完全没有、确实是本地独有的（值得搬）

| 标识 | 含义 | 上游 | 本地 |
|---|---|---|---|
| `protectedWriteViolation` | 拒绝 agent 写 App 自己受保护的路径 | 0 | 3 |
| `stripFdOnlyRedirections` | 描述符重定向不算"写文件" | 0 | 2 |
| `writesPath` | 按解析后的真实目标判定 shell 写入 | 0 | 2 |
| `parkedTurnStaleWindow` | 停放回合判定 | 0 | 2 |
| `processBusyLocked` | 跑探测的 sidecar 也算忙 | 0 | 1 |
| `parkedSidecarBusy` | 刚收到提示的 sidecar 不许回收 | 0 | 2 |
| `decrementActiveTurns` | 回合统计修正 | 0 | 2 |
| `remotecontrol`（6 文件） | 远端控制整包 | 0 | 6 |
| `crossProject` | 跨对话投递 | 0 | 1 |

> `dataless`（iCloud 预检）两边都有，但上游只有基础版（7 处命中），本地是完整修复（31 处）。

---

## 五、建议的继续方式（两段，风险不同）

### 第一段：sidecar 层（纯 Node，风险低，可测）
- `bridge-protected-paths.js`（已在分支里，直接可用）
- `bridge-visible-progress.js`、`bridge-workflow-prompt.js`、`bridge-stream-delta.js`、`bridge-turn-heartbeat.js`（已在分支里）
- 待人工比对后补：`bridge-hang-guard.js` 的 iCloud 预检增量（+203 −67）
- 待解冲突：`bridge.js`（9 处，含思考增量合并）、`bridge-destructive-delete.js`（2 处，守卫判定）
- 验证：`npm run test:sidecar`

### 第二段：Go 层（风险高，逐个文件、逐个验证）
1. `internal/config/settings.go`（1 处，+248，是**加新配置段**，相对好合）→ 合完能解锁 `app_network.go` 等
2. `internal/engine/supervisor.go`（**18 处，+898**，两套设计合体，最容易悄悄回退上游改进）→ 必须单独做、逐段核对
3. `cmd/milksu-backend/app.go`、`desktop_rpc.go`、`internal/conversation/store.go` 等少量钩子
4. 每合一个文件跑一次 `go build ./... && go test ./internal/engine/ ./internal/config/ ./cmd/milksu-backend/`

---

## 六、怎么查看 / 怎么丢弃

```bash
cd /Users/xiaoxingjiang/MilkSU/Coding/milksu-react
export PATH=/opt/homebrew/bin:$PATH

# 看这个分支改了什么
git diff --stat main..port/backend
git log --oneline -1 port/backend

# 看某个文件的合并结果（与上游比）
git diff main..port/backend -- internal/remotecontrol/manager.go | head -50

# 看当初的冲突清单（本地文件）
cat /tmp/mksu-audit/port-result.txt
cat /tmp/mksu-audit/merge/measure.tsv | awk -F'\t' '$1=="MOD" && $2>0'

# 完全丢弃这个分支（保留 main 不受影响）
git checkout main && git branch -D port/backend
```

## 七、备份位置

| 内容 | 位置 |
|---|---|
| 搬运开始前的 milksu-react 全量提交历史 | `/Users/xiaoxingjiang/MilkSU/_backups/react/milksu-react-20260917-164124.bundle`（53M，已校验） |
| 搬运开始前的工作树快照 | 同目录 `milksu-react-tree-20260917-164124.tar.gz`（44M） |
| Vue 源码仓库 | `/Users/xiaoxingjiang/MilkSU/Coding/milksu-src`（`debug/window-batch2`，未动） |
| 你的自动备份（每 30 分钟，活着） | `~/MilkSU/_backups/icloud-backup.sh` → iCloud `MilkSU-backups/`；5 个 launchd 任务均 active |

> ⚠️ 已知缺口：自动备份脚本里 `REPO` 写死为 `milksu-src`，**不覆盖 `milksu-react`**。
> 若要长期在这个新基线上干活，建议给备份脚本加一个 `react` 备份集。
