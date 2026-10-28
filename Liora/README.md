# Liora · 灵探

Liora（灵探）是一个 AI 辅助的自动化渗透测试平台，后端使用 Go 与内嵌 SQLite，前端使用 React 19 + React Router + Mantine + Rsbuild，可构建为单二进制运行。

## 功能

- 驾驶舱总览：任务运行态势、Agent 编排、实时事件流与漏洞分布。
- 自动化测试任务：任务分类、目标与范围、运行控制、执行过程与操作约束。
- AI 配置与工具调用：模型供应商、Agent、工具、Skills 与 MCP 配置。
- 结果与运行管理：资产、探索链路、漏洞、证据、报告、审批记录、日志与 Token 用量。

## 功能状态说明

以下能力在当前版本中仅部分实现或未提供界面入口，不应视为已完成功能：

- **命令面板（⌘K）**：已在提交 `d9c7b03` 中从顶栏移除，当前界面没有入口；组件与相关 E2E 用例已一并移除。
- **主题预设与字体切换**：偏好项可被读取和持久化，但界面没有切换入口；预设样式文件已移除，选择预设不会改变主题外观。
- **布局偏好（侧栏/导航样式）**：偏好值会写入根节点属性，但当前界面没有侧栏或可切换导航样式，设置不产生视觉效果。
- **noa 上下文压缩**：实验功能，默认关闭，仅可通过接口/配置开启，界面未提供开关。
- **任务模板**：当前版本没有任务模板功能；Agent 提示词模板与自定义工具命令模板是另外两项独立能力。

## 环境要求

- Go 1.26.3 或更高版本（见 `go.mod`）。
- Node.js 22.12 或更高版本，npm（见 `web/package.json` 的 `engines`）。

## 安装

```bash
cd web
npm ci
cd ..
go mod download
```

Windows 可运行 `dev.bat`，脚本会在缺少前端依赖时自动执行 `npm ci`。

## 运行

### Windows 一键启动

```powershell
.\dev.bat
```

启动后访问 <http://127.0.0.1:5173>。首次登录账号为 `Liora`，按页面提示创建管理员密码。

### 手动启动

终端一启动后端：

```powershell
go run ./cmd/liora -addr 127.0.0.1:8787
```

终端二启动前端：

```powershell
cd web
$env:LIORA_API = "http://127.0.0.1:8787"
npm run dev
```

访问 <http://127.0.0.1:5173>。

### 构建内嵌版本

```powershell
cd web
npm run build:embed
cd ..
go build -tags embedui -o liora.exe ./cmd/liora
.\start.bat -addr 127.0.0.1:8787
```

访问 <http://127.0.0.1:8787>。Linux/macOS 可执行：

```bash
LIORA_OUTPUT=./liora ./build.sh
./start.sh
```

## 配置

环境变量需在启动前设置，或写入 `config.json`；程序不会自动加载 `.env`。

| 变量 | 用途 |
| --- | --- |
| `LIORA_CONFIG` | 配置文件路径 |
| `LIORA_SQLITE_PATH` | SQLite 数据库路径 |
| `LIORA_SKILL_DIR` | Skills 目录 |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 模型供应商密钥，留空可在界面配置 |
| `LIORA_LLM_PROVIDER` / `LIORA_LLM_MODEL` | 默认模型供应商与模型 |
| `LIORA_LLM_BASE_URL` / `LIORA_LLM_PROXY` | 模型接口地址与代理 |
| `LIORA_LLM_STREAM` | 是否默认流式调用 |

服务端配置可复制 `config.example.json` 为 `config.json`。前端开发代理变量见 `web/.env.example`。常用启动参数为 `-addr`、`-data`、`-key-dir`，可通过 `-h` 查看全部参数。

## 目录结构

```text
agent/        Agent 运行时与工具编排
cmd/liora/    程序入口
config/       配置加载
db/           SQLite 数据层与 schema
evidence/     证据存储
guard/        操作约束
intercept/    拦截与审查
llmpool/      LLM 连接池与故障转移
llmrec/       LLM 调用记录
mcphttp/      MCP HTTP 客户端
report/       报告生成
server/       HTTP 与 SSE 服务
sidequestion/ 旁路问答
skills/       运行时 Skill 定义
traffic/      流量采集
web/          React 前端
data/         运行期数据（自动创建）
```

## 开发提示

`data/` 存放运行期数据，不属于源码。任务执行过程中可能把目标站点的源码（含 `.go` 文件）写入 `data/tasks/`，此时在仓库根执行 `go build ./...` 或 `go test ./...` 会把它们当成项目包一并编译并报错。请按包路径构建与测试，例如：

```bash
go build ./agent/... ./cmd/... ./config/... ./db/... ./evidence/... ./guard/... ./intercept/... ./llmpool/... ./llmrec/... ./mcphttp/... ./report/... ./server/... ./sidequestion/... ./traffic/...
go test ./agent/... ./cmd/... ./config/... ./db/... ./evidence/... ./guard/... ./intercept/... ./llmpool/... ./llmrec/... ./mcphttp/... ./report/... ./server/... ./sidequestion/... ./traffic/...
```

## 许可证

仓库根目录未提供许可证文件。`web/LICENSE` 为前端模板附带的 MIT 许可证（版权人为上游模板作者 Mohammed Arham Khan），`web/src/assets/fonts/LICENSE.txt` 为 Geist 字体的 SIL Open Font License 1.1 许可证。
