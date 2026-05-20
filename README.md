# RadioMind 🎵

个人 AI 音乐电台 —— 懂你的 AI DJ

## 演示

<div align="center">

### TUI 终端界面

https://github.com/user-attachments/assets/8ca5f3b2-d77c-4bf4-b72a-10dacf9ef1e8

### Web GUI 界面

https://github.com/user-attachments/assets/ea69b9ec-9129-4590-8ab7-9630f0b58da0

</div>

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面层                               │
│                                                                 │
│   ┌──────────────────────┐      ┌──────────────────────────┐   │
│   │     Web PWA          │      │     TUI (terminal-ui.js) │   │
│   │  (public/index.html) │      │     blessed + mpv        │   │
│   │  HTML5 Audio / WebSocket    │     WebSocket + axios    │   │
│   └──────────┬───────────┘      └────────────┬─────────────┘   │
└──────────────┼──────────────────────────────┼─────────────────┘
               │  HTTP / WebSocket             │
┌──────────────▼──────────────────────────────▼─────────────────┐
│                       服务层 (server/)                          │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │               index.js  (Express + WebSocket)           │  │
│   └───┬──────────┬──────────┬──────────┬────────────────────┘  │
│       │          │          │          │                        │
│   ┌───▼──┐  ┌────▼───┐  ┌──▼─────┐ ┌──▼──────────┐           │
│   │Router│  │Context │  │ State  │ │  Scheduler  │           │
│   │意图  │  │Builder │  │ 状态   │ │  节律调度   │           │
│   │分流  │  │提示词  │  │ 记忆   │ │ 定时推荐   │           │
│   └───┬──┘  │组装    │  └──┬─────┘ └─────────────┘           │
│       │     └────┬───┘     │                                   │
│       │          │         │                                   │
│   ┌───▼──────────▼─────────▼──────────────────────────────┐   │
│   │              Claude Adapter (AI 适配器)                 │   │
│   │   优先级: Claude CLI > Anthropic API > 降级处理         │   │
│   └───────────────────────┬────────────────────────────────┘   │
│                           │                                     │
│   ┌───────────────────────▼────────────────────────────────┐   │
│   │              Memory Manager (记忆系统)                   │   │
│   │  appendRaw(实时) → flushSession(摘要+偏好提炼)           │   │
│   │  L1: MEMORY.md   L2: memory/*.md   L3: memory.db(FTS5)  │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│   │  Music API   │  │  Weather API │  │  Playback Service│    │
│   │ 网易云搜索   │  │ Open-Meteo   │  │ 多平台播放URL    │    │
│   └──────────────┘  └──────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
               │                              │
┌──────────────▼──────────────────────────────▼─────────────────┐
│                       数据层 (user/)                            │
│                                                                 │
│   ┌──────────────────┐   ┌──────────────────────────────────┐  │
│   │   MEMORY.md      │   │  playlists.json                  │  │
│   │  ┌─────────────┐ │   │  歌单数据（本地同步）            │  │
│   │  │ 用户信息    │ │   └──────────────────────────────────┘  │
│   │  │ 音乐品味    │ │   ┌──────────────────────────────────┐  │
│   │  │(自动更新)   │ │   │  routines.md / mood-rules.md     │  │
│   │  │ 对话偏好    │ │   │  用户作息和心情规则（手动编辑）  │  │
│   │  │(自动提炼)   │ │   └──────────────────────────────────┘  │
│   │  └─────────────┘ │   ┌──────────────────────────────────┐  │
│   └──────────────────┘   │  state.db.json                   │  │
│   ┌──────────────────┐   │  运行时状态（播放历史/偏好）     │  │
│   │  memory/*.md     │   └──────────────────────────────────┘  │
│   │  每日对话日志    │                                          │
│   └──────────────────┘                                          │
│   ┌──────────────────┐                                          │
│   │  memory.db       │                                          │
│   │  FTS5 全文索引   │                                          │
│   └──────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────────────┐
│                    歌单同步层 (sync/)  [macOS]                   │
│                                                                 │
│   ┌──────────────────────┐   ┌──────────────────────────────┐  │
│   │ NeteaseLocalAdapter  │   │   QQMusicLocalAdapter        │  │
│   │ 读取网易云 SQLite     │   │   读取QQ音乐 SQLite          │  │
│   └──────────────────────┘   └──────────────────────────────┘  │
│                    同步后自动更新 MEMORY.md 品味区块              │
└─────────────────────────────────────────────────────────────────┘
```

## 功能特性

- 🤖 **AI 对话**：自然语言聊天，告诉 AI 你的心情、状态
- 🎧 **智能推荐**：基于天气、时间、心情、歌单自动推荐
- 💬 **主动播报**：像 DJ 一样介绍歌曲
- 🧠 **持久记忆**：跨会话对话记忆，越用越懂你
- 🖥️ **TUI**：终端播放器，支持键盘操作 + mpv 本地播放
- 📱 **PWA**：可安装为桌面应用，支持离线
- ⏰ **节律调度**：早晚自动推荐，小时情绪检查

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 AI（二选一）

**方式 A：Claude Code CLI（推荐，无需 API Key）**

```bash
claude --version  # 确保已安装
```

**方式 B：Anthropic API**

```bash
cp .env.example .env
# 编辑 .env，填入 CLAUDE_API_KEY
```

### 3. 启动网易云 API（可选，提升播放稳定性）

```bash
npm run start:netease-api   # 默认端口 3000
```

### 4. 启动服务

```bash
npm start          # 生产
npm run dev        # 开发（nodemon）
npm run start:all  # 同时启动网易云 API + 主服务
```

### 5. 访问

- **Web**：http://localhost:8080
- **TUI**：`npm run tui`（另开终端）

## 目录结构

```
radiomind/
├── server/
│   ├── index.js                # 主服务入口 (Express + WebSocket)
│   ├── core/
│   │   ├── router.js           # 意图分流
│   │   ├── context-builder.js  # 提示词组装
│   │   ├── claude-adapter.js   # AI 适配器
│   │   ├── memory-manager.js   # 持久化记忆系统
│   │   ├── scheduler.js        # 节律调度
│   │   └── state.js            # 状态管理
│   ├── services/
│   │   ├── music-api.js        # 网易云音乐 API
│   │   ├── playback-service.js # 多平台播放 URL 获取
│   │   ├── weather-api.js      # 天气 (Open-Meteo)
│   │   └── tts-service.js      # TTS 语音
│   └── prompts/
│       └── dj-persona.md       # DJ 角色设定
├── public/                     # PWA 前端
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── manifest.json
│   └── sw.js
├── sync/                       # 歌单同步
│   ├── sync-manager.js
│   ├── adapters/               # 网易云 / QQ音乐 适配器
│   └── index.js
├── scripts/
│   ├── init-config.js
│   └── netease-api.js
├── user/                       # 用户数据（本地，不提交 git）
│   ├── routines.md             # 日常规律（手动编辑）
│   ├── mood-rules.md           # 心情匹配规则（手动编辑）
│   ├── playlists.json          # 歌单数据（同步生成，.gitignore）
│   ├── MEMORY.md               # 长期记忆：品味分析+对话偏好（.gitignore）
│   ├── memory/                 # 每日对话原文+摘要日志（.gitignore）
│   ├── memory.db               # FTS5 全文检索索引（.gitignore）
│   └── state.db.json           # 运行时状态（.gitignore）
├── terminal-ui.js              # TUI 终端播放器
├── package.json
├── .env.example
└── README.md
```

## AI 调用优先级

| 优先级 | 方式 | 说明 |
|--------|------|------|
| 1 | **Claude CLI** (`claude -p`) | Max 订阅，无需 API Key |
| 2 | **Anthropic API** | 需配置 `CLAUDE_API_KEY` |
| 3 | **降级处理** | 返回默认推荐 |

## 记忆系统

采用三层记忆设计：

| 层级 | 文件 | 说明 |
|------|------|------|
| L1 常青 | `user/MEMORY.md` | 每次会话全文注入，手动维护 |
| L2 近期 | `user/memory/YYYY-MM-DD.md` | 自动生成每日对话摘要 |
| L3 历史 | `user/memory.db` | SQLite FTS5 语义检索 |

记忆自动写入触发条件：消息数 ≥ 50 条 / WebSocket 断开 / 每30分钟定时。

**MEMORY.md 自动更新路径：**

| 路径 | 触发时机 | 写入内容 |
|------|---------|---------|
| 歌单同步 | `npm run sync sync` / 每天凌晨3点 | 艺术家TOP20、语言分布、风格标签 |
| 对话提炼 | 每30分钟 flushSession | 对话中明确表达的新偏好（带日期标记） |

## 歌单同步

> ⚠️ **当前仅支持 macOS**，通过读取本地客户端的 SQLite 数据库获取歌单。Windows / Linux 暂不支持。

### 前置条件

| 平台 | 要求 |
|------|------|
| 网易云音乐 | 安装 [网易云音乐 Mac 客户端](https://music.163.com/#/download)，登录并同步歌单 |
| QQ 音乐 | 安装 [QQ音乐 Mac 客户端](https://y.qq.com/download/mac.html)，登录账号 |

数据库路径（自动检测，无需配置）：
- 网易云：`~/Library/Containers/com.netease.163music/Data/Documents/storage/sqlite_storage.sqlite3`
- QQ音乐：`~/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/iUser/{uid}/user.db`

### 同步命令

```bash
npm run sync sync      # 立即同步所有平台
npm run sync status    # 查看同步状态和数据源可用性
npm run sync backup    # 手动备份当前歌单
```

### 首次使用

```bash
# 1. 确认数据源可用
npm run sync status

# 2. 执行同步（同步后自动更新品味分析）
npm run sync sync
```

同步成功后会生成 `user/playlists.json`，并更新 `user/MEMORY.md` 中的品味分析区块。

### 非 macOS 用户

如果你使用 Windows 或 Linux，可以手动创建 `user/playlists.json`，格式参考：

```json
{
  "platforms": {
    "netease-local": {
      "likedSongs": [
        { "id": "123456", "name": "歌曲名", "artist": "艺术家", "album": "专辑" }
      ],
      "playlists": []
    }
  }
}
```

## TUI 快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `← / →` | 上一首 / 下一首 |
| `Tab` | 切换到队列（↑↓ 浏览，Enter 播放） |
| `i` | 进入聊天输入 |
| `+ / -` | 音量调节 |
| `n` | AI 推荐下一首 |
| `h` | 帮助 |
| `q` | 退出 |

TUI 播放需要安装 mpv：

```bash
brew install mpv
```

## API 接口

```
POST /api/chat                  与 AI 对话
GET  /api/next                  获取 AI 推荐
GET  /api/recommendations       批量推荐
POST /api/play                  获取播放 URL（支持多平台）
GET  /api/playlists/:platform   获取指定平台歌单
GET  /api/search?q=             搜索歌曲
GET  /api/song/:id              歌曲信息
GET  /api/lyric/:id             歌词
GET  /api/weather               天气
POST /api/tts                   文字转语音
GET  /api/agent/profile         AI 个人资料
GET  /api/memory/search?q=      搜索历史记忆
POST /api/memory/flush          手动触发记忆归档
GET  /api/memory/hot            查看当前热记忆
WS   /                          WebSocket 实时流
```

## 配置

### 用户档案（手动编辑）

| 文件 | 说明 |
|------|------|
| `user/routines.md` | 作息规律，AI 据此在合适时间推荐 |
| `user/mood-rules.md` | 心情与音乐风格的映射规则 |
| `user/MEMORY.md` | 长期记忆，可手动补充重要偏好 |

### Claude Skills (`.claude/skills/`)

项目内置三个 Skill，自动注入到 AI 上下文：

| Skill | 说明 |
|-------|------|
| `music-library` | 歌单数据路径说明 |
| `weather` | 天气数据使用说明 |
| `calendar` | 日历状态接入模板（需用户自行实现） |

### 环境变量 (`.env`)

```bash
CLAUDE_API_KEY=         # Anthropic API Key（使用 Claude CLI 则不需要）
NETEASE_API_HOST=127.0.0.1
NETEASE_API_PORT=3000
```

## 技术栈

- **后端**：Node.js、Express、WebSocket
- **前端**：Vanilla JS、PWA、Canvas
- **TUI**：blessed
- **AI**：Claude API / Claude Code CLI
- **记忆**：SQLite FTS5
- **音乐**：网易云音乐 API（本地部署）、QQ 音乐本地读取
- **播放**：mpv（TUI）/ HTML5 Audio（Web）

## License

MIT
