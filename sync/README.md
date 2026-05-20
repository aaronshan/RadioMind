# 歌单同步系统 (Playlist Sync System)

支持从本地音乐客户端直接读取歌单数据，自动合并多平台数据。

## 特性

- 🔌 **本地数据库读取** - 直接读取网易云音乐、QQ音乐客户端的SQLite数据库
- 🔄 **智能合并** - 自动去重合并多平台歌单
- ⏰ **定时同步** - 每小时自动检查并同步
- 💾 **增量更新** - 只同步变化的数据
- 🛡️ **自动备份** - 同步前自动备份

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 扫描本地数据源

```bash
npm run sync:scan
```

这个命令会检测你的Mac上是否安装了网易云音乐和QQ音乐，并检查是否可以读取它们的数据库。

### 3. 初始化配置

```bash
npm run sync:init
```

自动配置所有可用的本地数据源。

### 4. 执行首次同步

```bash
npm run sync
```

读取本地数据库，合并数据，生成 `user/playlists.json`。

### 5. 启动自动同步服务（可选）

```bash
npm run sync:start
```

每小时自动检查并同步本地数据库的变化。

## 可用命令

```bash
# 扫描可用数据源
npm run sync:scan

# 初始化配置
npm run sync:init

# 执行同步
npm run sync

# 仅同步本地数据源
npm run sync:local

# 合并所有已同步的数据
npm run sync:merge

# 查看同步状态
npm run sync:status

# 测试本地数据源读取
npm run sync:test

# 启动自动同步服务
npm run sync:start

# 手动备份
npm run sync backup
```

## 数据来源

### 网易云音乐 (本地)

**数据库位置:**
```
~/Library/Containers/com.netease.163music/Data/Documents/storage/sqlite_storage.sqlite3
```

**读取的数据:**
- 我喜欢的音乐
- 用户创建的歌单
- 歌单中的歌曲（歌名、艺术家、专辑、时长）

**要求:**
- macOS系统
- 已安装网易云音乐客户端
- 已登录账号
- 客户端已同步过歌单

### QQ音乐 (本地)

**数据库位置:**
```
~/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/qqmusic.sqlite
```

**读取的数据:**
- 我喜欢
- 用户创建的歌单
- 歌单中的歌曲信息

**要求:**
- macOS系统
- 已安装QQ音乐客户端
- 已登录账号

## 数据合并策略

系统会自动合并来自多个平台的数据：

- **歌曲去重** - 基于"歌名-艺术家"的组合进行去重
- **平台标记** - 每首歌标记来源平台
- **喜欢歌曲** - 单独维护一个"我喜欢的"列表

合并后的数据保存在 `user/playlists.json`：

```json
{
  "songs": [...],        // 所有唯一歌曲
  "likedSongs": [...],   // 喜欢的歌曲
  "playlists": [...],    // 歌单列表
  "metadata": {
    "platforms": ["netease-local", "qqmusic-local"],
    "totalSources": 2,
    "mergeTime": "2024-01-15T10:30:00Z"
  }
}
```

## 配置文件

配置文件位于 `sync/config.json`：

```json
{
  "sources": [
    {
      "platform": "netease-local",
      "name": "网易云音乐(本地)",
      "enabled": true,
      "autoDetected": true,
      "syncInterval": 3600
    }
  ],
  "settings": {
    "autoSync": true,
    "syncOnStartup": true,
    "backupBeforeSync": true,
    "maxBackups": 5,
    "mergeStrategy": "union"
  }
}
```

## 故障排除

### 无法读取数据库

1. **确保客户端已关闭** - 有些客户端在运行时会锁定数据库
2. **检查权限** - 确保有访问 `~/Library/Containers` 的权限
3. **重新登录客户端** - 有时需要重新登录来刷新本地数据

### 找不到数据源

```bash
# 测试本地数据源
npm run sync:test
```

### 手动指定数据源

如果自动扫描失败，可以手动添加：

```bash
npm run sync add-netease-local
npm run sync add-qqmusic-local
```

## 技术细节

- 使用 `sqlite3` 模块读取本地数据库
- 适配器模式支持多平台扩展
- 使用 `node-cron` 实现定时任务
- 增量同步减少I/O开销

## 注意事项

- ⚠️ 仅支持 **macOS** 系统（使用Mac App的沙盒路径）
- ⚠️ 只读取数据，不会修改本地数据库
- ⚠️ 首次同步前请确保客户端已完全同步云端数据
