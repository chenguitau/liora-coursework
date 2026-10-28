# Liora / StellarPick — 源码说明

本目录收录两套源码：自动化渗透测试系统 **Liora（灵探）** 与仿真靶场 **星澜优选（StellarPick）**。设计文档、截图与实验记录不在本目录内。

```
Liora-StellarPick/
├─ README.md      # 本文件
├─ Liora/         # 自动化渗透测试系统：Go 后端 + React 前端
└─ StellarPick/   # 仿真靶场：Juice Shop 基座 + 星澜业务层
```

两套源码相互独立，可分别构建与运行。

---

## 一、项目简介

Liora 是一套由大语言模型驱动的自动化渗透测试系统。它把一次测试拆成目标、意图与证据：

- **探索图**记录测试状态：goal / intent / fact / finding / digest 五类节点，`derived_from`、`yields`、`spawns`、`proves` 四类边；
- **Planner–Worker 闭环**推进执行：Planner 只在确有新方向时补充意图，Worker 领取一条意图执行并回写结果；
- **证据链裁决结论**：每条漏洞绑定 baseline / proof / verification / supporting 流量快照，正文按 SHA-256 内容寻址存储；
- **规则拦截与审批**约束边界：PreToolUse 钩子在工具执行前匹配规则，命中后放行、拒绝或挂起等待裁决。

系统采用 Go 后端、React 前端与内嵌 SQLite，可构建为单二进制。实验在自建电商仿真靶场星澜优选上完成，靶场预置 10 条漏洞（V01–V10），覆盖注入、跨站脚本、访问控制、身份认证、CSRF、业务逻辑与文件上传七类；三轮端到端任务于 2026-10-27 完成，分别耗时 43 / 62 / 75 分钟，共登记 85 条 finding、302 条证据绑定。

---

## 二、Liora（自动化渗透测试系统）

### 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Go 1.26.x，标准库 HTTP，SSE 实时通道 |
| 前端 | React 19、Mantine 8、React Router 7、Rsbuild、Tailwind v4 |
| 数据 | 内嵌 SQLite（WAL），证据正文按内容寻址存于文件系统 |
| 模型 | OpenAI 兼容接口，多模型池化路由与调用记录 |

### 目录

| 目录 | 作用 |
|---|---|
| `cmd/liora` | 程序入口与启动装配 |
| `server` | HTTP/SSE 接口、路由、认证、任务编排 |
| `agent` | Planner / Worker / 主 Agent，目标拆解、报告与复测 Agent |
| `db` | SQLite 表结构与数据访问 |
| `intercept` | PreToolUse / PostToolUse 钩子、规则匹配、审批生命周期 |
| `guard` | 操作约束与范围校验 |
| `traffic` | 流量代理与请求/响应快照 |
| `evidence` | 证据正文存储（SHA-256 内容寻址） |
| `report` | 报告渲染（Markdown / ZIP / CSV / JSON） |
| `llmpool`、`llmrec` | 多模型接入路由、调用记录与用量统计 |
| `mcphttp`、`skills` | MCP 工具接入与内置技能（`api-recon`、`playwright-cli`） |
| `web` | React 前端源码 |

### 环境与运行

- Go 1.26.3 及以上；Node.js 22.12 及以上与 npm。

```bash
cd Liora
go mod download
cd web && npm ci && cd ..

# 开发模式：后端 8787、前端 5173
go run ./cmd/liora -addr 127.0.0.1:8787
cd web && npm run dev
```

Windows 下可直接运行 `dev.bat`（开发）或 `start.bat`（生产）。浏览器访问 `http://127.0.0.1:5173`。

首次启动会在 `data/` 下创建 SQLite 数据库 `liora.db`，登录页提示创建管理员密码；模型供应商、Agent 与工具在界面中配置。单二进制构建见 `build.sh` 与 `Dockerfile`。

> 本轮实验使用 `deepseek-flash`（profile: `deepseek-2`，OpenAI 兼容接口）。仓库不包含任何 API Key 或凭据。

---

## 三、StellarPick（仿真靶场）

### 概况

| 项 | 内容 |
|---|---|
| 名称 | 星澜优选（StellarPick），电商仿真靶场 |
| 基座 | OWASP Juice Shop v20.4.0-SNAPSHOT（Angular 22），hash 路由 |
| 规模 | 42 个 API 端点、18 条前端路由、9 个演示账号、21 件商品（含 1 件隐藏）、10 个预置订单、3 条工单、4 条商家申请、2 条评价 |
| 预置漏洞 | V01–V10，覆盖注入、跨站脚本、访问控制、身份认证、CSRF、业务逻辑、文件上传七类 |
| 配置 | `vendor/juice-shop/config/stellarpick.yml` |
| 业务路由 | `vendor/juice-shop/routes/stellarpick.ts`、`routes/lab.ts` |
| 种子数据 | `vendor/juice-shop/data/datacreator.ts`、`data/labRuntime.ts` |
| 漏洞真值 | `docs/ground-truth.json` |

### 环境与运行

- Node.js ≥ 22.22.3（见 `package.json` 的 `engines`）
- 构建 `sqlite3` 原生模块需要本机 C/C++ 构建工具
- Windows PowerShell 5.1+ 或 Linux bash

```bash
cd StellarPick
# Linux
./deploy.sh && ./start.sh      # reset.sh 重置靶场数据
# Windows
deploy.ps1 ; start.ps1 ; reset.ps1
```

默认监听 `127.0.0.1:8081`。首次启动按种子重建 SQLite；订单、购物车与工单保存在 `lab-runtime.json`，内存态数据重启后回到种子状态。

> 访问地址以实际部署为准：配置域名为 `stellarpick.example`，可以是域名、虚拟机 IP 或本机回环；实验环境地址为 `http://192.168.197.133`（nginx 80 反代 Node 8081）。SQLite 为单写者，同一时刻只允许一个 Node 进程服务该库。

### 自检

```bash
npm run verify   # 10/10 + 7/7 + 18/18
npm run audit    # verify + a11y + perf + mobile
```

---

## 四、两套源码的关系

Liora 负责发起测试，StellarPick 是测试目标。三轮实验中，Liora 通过 HTTP 访问靶场，按任务目标分别做全量检测、端点逐项核查与全面检测；每条结论对应靶场 V01–V10 中的具体入口。靶场运行在独立实例（虚拟机）上，与 Liora 单向交互，不共享数据库。

| 模块 | 位置 |
|---|---|
| 探索图与 Planner–Worker 闭环 | `Liora/agent/`；`Liora/db/` 中 explorations、exploration_nodes、exploration_edges |
| 证据链与复测 | `Liora/traffic/`、`Liora/evidence/`；finding_traffic_bindings、finding_retests |
| 安全拦截与审批 | `Liora/intercept/`、`Liora/guard/` |
| 数据库访问层 | `Liora/db/` |
| 报告与前端 | `Liora/report/`、`Liora/web/src` |
| 靶场配置与预置漏洞 | `StellarPick/vendor/juice-shop/config/stellarpick.yml`、`routes/stellarpick.ts`、`docs/ground-truth.json` |

---

## 五、说明

- 上游提交：Liora `720dd78`，StellarPick `2f9863b`。
- 靶场中的账号、商品、订单、商家与评价均为虚构演示数据，演示口令只用于本地演练。
- 本项目仅用于授权的本地仿真环境；仓库与截图中不含真实凭据、客户数据或生产地址。
- 设计文档、系统截图与实测记录不随源码归档；静态演示站点由独立的演示工程构建，二者均不在本目录内。
