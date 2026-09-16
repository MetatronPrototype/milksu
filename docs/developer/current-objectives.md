# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-09-16
>
> 本页只回答“当前处于什么阶段、下一条完成线是什么”。实现以当前代码、测试、Git 历史和原生 App 为准。
> 可下载安装包只写在 README，本页不写「当前最新版是」版本号或 hash。

## 工作规则

1. 先读当前代码、Git、本文件、[文档状态](document-status.md)和[当前系统](../architecture/current-system.md)。
2. 新能力写当前干净模型，不为已放弃设计写迁移或兼容层。
3. 上游优先：平台/Pi → 固定 Skill、MCP、插件或 CLI → 最小自有实现。不另造通用 harness。
4. Provider Key 不进模型上下文、工具输出、日志、诊断、文档或普通文件。Git 只推授权远端。
5. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果和危险大目录删除确认。
6. CTF、CVE、实验室、Coding 同级。通用循环优先共享 Pi；领域事实、Judge、Memory 由 MilkSU 持有。
7. UI/Runtime 修复回写本页。未打包或未经用户验收的不得写成已发行。产品 UI 只写在 `AGENTS.md`。
8. 发版后更新 README 下载徽章和当前状态。流程见 [三端打包与发版流程](release-process.md)。
9. 尚未实现不是禁止。真边界只覆盖 Key、未授权外部目标、Judge，以及把 smoke 写成完成。

## 当前阶段与基线

| 项目 | 当前事实 |
| --- | --- |
| 阶段 | 内测迭代 / Agent Runtime 与跨平台发行收敛。不再按 M3/M4 组织。 |
| 历史基线 | M3 product-loop 已在 `108e0e3`（2026-08-05）合并，仅供追溯。 |
| 当前开发 | 新对话可选 Pi 或 DeepSeek Harness；设置 → 模型「默认运行时」只改新对话 kernel，不改写旧会话。出厂默认官方 DeepSeek Flash、默认运行时 DSH。工作树 DSH 钉 `0.1.6-alpha.1`（内核，不是 UI 参考；原厂 GUI 是 `dsh web`）。Pi 子 Agent 默认主工作区、父回合阻塞；DSH 可在 Multitask 下用 ACP `session/new` 开子会话并继续主对话。Working 短胶囊对 Pi / DSH 同一套信息架构。Computer Use 由模型列窗 / 认窗 / 锁定。产品回归入口 `npm run test:product-loop`。产品 UI 语言和工作树 renderer 是 React + shadcn，见 `AGENTS.md`。最近一次正式安装包 `v26.915.1` 仍是 Vue + Felinic。未做：新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。宽作业用 `recon-authorized-target` Skill，不造 typed sweep。 |
| 平台边界 | macOS DMG 签名公证；Windows 安装器未代码签名，打入 CUA Driver `0.27.0`；Linux 发共用 DEB 与 tarball，GNOME Portal 已进包，无 Secret Service / 本地 OCR；Hyprland/Xorg Computer Use 不可用。Windows/Linux 窗口铬尚未真机验收。安装包见 README。 |
| 发行流水 | 干净已推送的 `main` 上跑一次 canonical 验证；三端走 GitHub-hosted。`macos-release` 仅限 `main`，dispatch 后立即签名。正式包装 OTA 到私有 R2 并发布 current pointer；GitHub Release 不上 updater ZIP。 |

## 已发行

更早的 tag 见 [GitHub Releases](https://github.com/MilkSU-Official/milksu/releases)，本页不复述。

最近一次正式包装源 `d37b957`（`26.915.1`）：Pi `bash` 缺省 600 秒；非活跃 Sidecar 停靠保活；凭据轮换惰性、撤回立即停；writer 只在模型委托写入时准备；思考收进「过程」。Windows 安装器仍未代码签名。

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.915.1>

| 平台 | Workflow | 安装包 | 大小 | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS ARM64 | `34873453613` | `MilkSU-macOS-arm64-26.915.1.dmg` | 300,728,583 B | `f5f39a9349e6bc892237aab9ddfce938a9bf9a7f30c159213449e9303c52ffda` |
| Windows x64 | `34873457848` | `MilkSU-Windows-x64-26.915.1-Setup.exe` | 238,824,009 B | `15aaf941a66a774f0cf38f81dccc4985ef4e9fdaff43fcf56b8659d507e9127f` |
| Linux x64 DEB | `34873461697` | `MilkSU-Linux-x64-26.915.1.deb` | 213,799,724 B | `cfaddcb225b1fd1a24f4755339475418088f67d84d812b8716f77494ae61f890` |
| Linux x64 tarball | `34873461697` | `MilkSU-Linux-x64-26.915.1.tar.gz` | 264,788,231 B | `17bd5593e460373e00e556d4ae3caacab405d3df083250ecfbe73414075b48df` |

## 未打进 GitHub 安装包

- 新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。
- Computer Use 已改为模型列窗 / 认窗 / 锁定；选窗器仍是可选人工面。宽作业走 `recon-authorized-target` Skill，不造 typed sweep。均未进安装包。
- DSH `bash` 没有 MilkSU 侧超时上界（工具在 harness 进程内，不要在客户端复刻第二套循环）。
- DSH `0.1.6-alpha.1`、产品回归 `npm run test:product-loop`、`desktop-surface`（Computer Use 优先，不可用降级隔离浏览器）均未进安装包。不要把 `test:dsh-complete-loop` 当主入口。工作树打包已把 DSH host plugin 打成独立 ESM（`bundleDshHostPlugin`；Sidecar `package.json` 是 CommonJS，不能只拷 `host-plugin.mjs` 再 import `permission.js`），下一包装才会进安装包。产品回归 CDP 只附着产品主窗，不附着标题带 fixture 的隔离浏览器页。
- DSH host plugin 不再 required-inject `agents` / `compaction`（会话回收会卸 fiber，`ctx.effect` / `ctx.on` 在 inactive context 上炸成 ACP `Internal error: cannot create effect on inactive context`）。IPC listen 与 subagent 订阅只在 fiber 还能挂 effect 时注册；dispatch 用 `ctx.get()`。工作树已修，本地 adhoc `desktop:build` 已打进 `MilkSU.app`；GitHub 安装包尚未含此修复。
- 设置占用原侧栏并即时落盘、居中命令面板、作曲栏模型/Git 芯片已进 `main`，未进安装包。
- 正式版与同通道 adhoc Stable 共用 Electron userData；主题 `light` / `dark` 就是外观。工作树已用阻塞 `theme-boot.js` 在打包 CSS 前套存储值，并把 `nativeTheme.themeSource` 钉到同一 mode，避免设置页跟系统 `prefers-color-scheme` 反转；亮色 `--hover-2` 加深以便能看见。未进安装包。未改 AGENTS.md 设计语言。
- 新对话未发送前，作曲栏草稿和模型/运行时/项目芯片跟空会话走：去设置或其他页再回来仍在。未进安装包。
- DSH 发送消息只复用已打开的隔离浏览器，不再 Ensure；问候 / 闲聊不会弹右栏。未进安装包。
- 设置 → 模型「默认运行时」；作曲栏加号 Multitask（仅 DSH 可开并行）；对话下方 Working 短胶囊（折叠「进行中」或「进行中 · N」，不拉满作曲栏；点开才是 overlay 列表；Pi 与 DSH 同一套，主 thread 不再内嵌 sub-agent 大方板）。DSH 模型自己拉起的 `subagent` 经 ACP `tool_call` 与 host `ctx.subagents` 投影进同一 roster，可停单个/全部。未进安装包。
- Agent Harness：DSH 没有 Cursor 那种 `run_in_background` Task。ACP `session/prompt` 要等到 `whenIdle`（含子代理）才结算，所以主对话继续发走 host `Agent.followup`。作曲栏停止键只在父回合还在生成、压缩或中止时出现（`composerShowsStop`：`parent` / `compacting` / `aborting`）。DSH Working 或 ACP 还在 `whenIdle` 但父文本已结算 / Working 已空时相位是 `working` 或 `idle`，按钮是 Send，并 `finishRun` 清掉 `runningIds`。加号 Multitask 才是另开 ACP 子会话。Pi 的 `subagent` 仍阻塞父工具。产品回归 `composer-runtime` 覆盖这些相位和默认运行时 / 忙碌发送 / 模型 / 界面语言落盘。不要升 Pi 来假装能并行。
- 2026-09-16 对照钉住的原厂 `dsh web`（`@deepseek-ai/dsh@0.1.6-alpha.1`，默认 `127.0.0.1:3080`；本次 `--port 3088 --no-open`）。原厂 GUI 是 web profile + Session Controller，不是 ACP。点过：内测声明「继续」、新会话、选择/添加工作区（无工作区时加号和发送禁用；本机目录选择走 Host 原生文件夹窗，浏览器自动化进不去）、标准/PTC/极简/创造预设、设置（通用 / 模型 / 插件 / Agent 预设 / 已归档；权限「仅可查看 / 工作区内修改 / 完全权限」；繁忙发送「排队发送 / 插话发送」）。ACP 文档写明 slash command 面只给 CLI/Web，不给 ACP。MilkSU 已通过 ACP/host 投影 followup、`session/new` Multitask、subagent roster、stop、compact、审批。不要复刻原厂 web 皮肤、Queue dock、Jobs 顶栏、slash 目录或 Agent preset 切换器。
- 工作树已把同进程 DSH host 投影补到 `ctx.commands` list/execute、`ctx.planMode` / 官方 `/plan`、`ctx.goals` / `/goal`、`Agent.inbox` 排队、`ctx.jobs`。未知 `/` 按官方 adapter 拒绝，不当事先写好的 prompt。DSH 计划芯片走 `planMode`（引导 + `exit_plan_mode` 可见确认），不再用 Pi `executionMode` 的「不修改文件」文案。忙碌发送设置默认插话（followup），可选排队（inbox 下一回合）。jobs 进现有 Working，可停。未复刻 child transcript、preset、插件清单、归档、Schedule。未进安装包。
- 准备 writer 时按停止，有时同时出现「本轮已停止。」和「Agent 运行失败」。合同只留前者。
- macOS OTA ZIP 须先把 sidecar 许可证改成属主可写，否则 ShipIt 可能装完仍是旧版。已装的 26.912.3 在下一包装进包前仍用 GitHub DMG。

## 当前产品事实

- Coding / CTF / CVE / 实验室共用 Pi 文件、Shell、自动压缩（80% 空闲与 `/compact` 同一路径）和完整工作循环。工具结果进模型前走 Pi `tool_result` 截断。不扫描用户句子做意图路由。
- MilkSU 只持会话目录、凭据隔离、桌面授权、领域事实/Judge，以及危险大目录删除二次确认。
- 账户 TokenFlux 与本机 Provider 共用可调用目录；附件原图进当前回合。网页查证复用 Pi `web_search` / `web_fetch`。
- 桌面壳是 Electron/Chromium。工作树产品 UI 是 React + shadcn。最近一次正式安装包 `v26.915.1` 仍挂 Vue + Felinic。隔离浏览器、Browser Use、Computer Use 是三个表面；面板折叠不停止 Session。产物在各 OS 文档目录 `MilkSU/{Coding,CTF,CVE,Lab}`。
- 产品 UI 只写在 `AGENTS.md`。

## 当前完成线

1. 功能改动后按 [产品回归循环](product-regression-loop.md) 跑 `npm run test:product-loop`；失败回 P0。安装包上的 Pi / 实验室靶机仍由用户真机看。
2. 用户要求发下一版时：升版本号 → 干净已推送的 `main` 跑 `release:verify` → 新的三端回执。不挪已发出的 tag。

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 产品回归 | 改对话 / 引擎 / DSH / 隔离浏览器后跑 `npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。Settings「评测」不替代这条。C9 / C15 / C16 / C20 已确认；DSH A/B/C 已复验。 |
| P0 | React + shadcn | 工作树 renderer 已是 React + shadcn（`main.tsx`）。新页和重构只走这条。不再跟 DSH web GUI，不再加 Felinic / Vue SFC。Desktop RPC 与 Go 不动。细节优化看下面「迁移残留」。 |
| P0 | Pi Runtime 用户验收 | 跨目录读写、CTF/CVE 交接、长输出续跑、重启恢复；无 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | 下一版三端回执 | 新版本号、同一 source commit、三端产物、SHA-256 与平台验收。安装包见 README。 |
| P1 | OTA / current pointer | 侧栏蓝色「更新」一点即下载并重启；有任务在跑时先确认退出并落盘后续跑；安装失败可见；CI 上传后发布 current pointer。 |
| P1 | Wide lab recon | `bg_status` 熔断与最多 4 条子 Agent lane 已进包。宽作业用 `recon-authorized-target` Skill，不另造 typed sweep。 |
| P1 | 安全工具真实任务 | IDA / capa 已有设置与健康检查；用受控样本留回执。不把 HexStrike 做成默认 MCP。 |
| P1 | Obelisk 学习记录 | 先定义可归因事实，再独立页面；不恢复已删的单会话图谱。 |
| 未接线 | 同一作业 vs 新业务 | 当前 CVE/实验室复用同一会话和 `report.md`。 |
| 未接线 | CTF 比赛模式 | 对着一场比赛打，不走练习题库。尚未设计准入。 |
| 未接线 | 实验室红队模式 | 另开学习面，不是对外红队。尚未设计准入。 |

CVE：点进档案复现，Agent 改 `report.md`。实验室：独立入口，练习包起本机 Docker / AVD 或用户给地址，活报告 + 对话小窗。环境契约见 [靶机、环境经纪与活靶面](/architecture/target-environments)。

### React 迁移残留（行为 / 风格，留给细节优化）

行为可能和旧 Vue + Felinic 不一致：

- Settings / Profile / Eval / Vuln / Lab 本地状态走 `createStore` + `useStore` / `useStoreRuntime`，页面订阅读稳定 snapshot。
- Dialog / Select / Dropdown / Switch 从 Felinic `v-model` 换成 Radix `open` + `onOpenChange`。点遮罩关闭、Esc、焦点陷阱、Select 受控值可能和旧的不一样。
- 已访问的 CTF / CVE / Lab 会留在树上用 `display:none` 藏起来（相当于旧 KeepAlive）。对话右栏是 `ContextRail`。`CodingComposerControls` 不再补 `[data-button]::before`。侧栏搜索和 Cmd/Ctrl+K 打开居中命令面板（齐平搜索、全部/会话/设置/命令、最近会话加点/工作区/相对时间）；对话行右侧显示相对活跃时间，悬停钉选/归档、右键菜单，没有三点按钮；钉选分组用图钉，项目文件夹开合换图标。作曲栏模型芯片先出一级菜单（模型 / 推理强度 / 上下文 / 运行时），点开不展开二级，悬停才出二级，二级按窗口限高滚动；Git 芯片是可搜索、限高滚动、可从查询创建分支的 popover；设置页默认/subagent 仍是单个可搜索 popover；图片附件用缩略图，`@` 走现有选文件 RPC；短时失败用 toast，审批/凭据/表单错误仍用 Alert。
- Vite / 浏览器 demo 没有 `window.milksu`。设置页不再把 `desktop runtime is unavailable` 当成产品错误；完整设置和插件列表要 Electron。

风格（C：shadcn 结构 + Cursor Light / Cursor Dark，彩蛋后加）：

- `index.css` 夜间是页面 `#181818` / 侧栏 `#141414`，浅色是页面 `#fcfcfc` / 侧栏 `#f3f3f3`，页底和侧栏用 70–90% 透明度透出一丝桌面。macOS `under-window` vibrancy，Windows acrylic，Linux 仍不透明。菜单/对话框保持不透明。不要再用 zinc-950 `#09090b` 或纯白 `#ffffff` 当页底。`ak-ui.css` / `beautiful-chrome.css` 已从树上删掉，不要当现行语言加回来。
- 设置页跟 Cursor：设置分类占用原来那一列侧栏，不要再叠第二列导航。内容是一组 `SettingsSection` / `SettingsRow`，右侧控件与行标签同一字号、同一高度。改完即存，不要页脚「保存并验证」。不要再套第二层卡片或评测 workbench。LIVE/AUTH 彩蛋未加回。
- 产品入口是 `main.tsx`；`@felinic/ui` / Vue 已从 `app/` 生产依赖拿掉。Felinic submodule `packages/ui` 已卸载，不进 renderer。

## 不要重复打开

只在新复现、自动化失败或用户明确要求时重开：已撤单会话图谱；Wails/CEF；workspace-only 文件工具；Security Bridge / `continue_ctf_job`；关键词意图路由；自建计费；把 dirty HEAD 写成已发版；M3/M4 台账。

## 领域与文档

- CTF：模型只提 Candidate；成功只来自 Judge 或用户确认。
- CVE：完成面是复现报告，不是「复现成功」。
- 实验室：未知洞探测，不是对外红队，也不是 CTF 环境包。
- Memory：用户能力事实必须能链到 Judge、正式 Evidence 或用户确认。
- 依赖方向：`React → Preload / RPC → Application Service → Domain / Runtime → Adapter`。工作树入口是 `main.tsx`；最近一次正式安装包仍是 Vue 入口。
- 触碰 `CTFPage.tsx`、`app.go`、`bridge-policy.js`、`browsercap/manager.go` 或 Runner/Recovery 时，不往热点文件再加一份通用 harness。
