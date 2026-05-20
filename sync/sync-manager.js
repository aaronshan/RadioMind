/**
 * 歌单同步管理器 (增强版)
 * 支持多平台：本地数据库 + 远程API
 * 支持增量同步、定时任务、自动合并
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// 适配器
const NeteaseAdapter = require('./adapters/netease');
const NeteaseLocalAdapter = require('./adapters/netease-local');
const QQMusicAdapter = require('./adapters/qqmusic');
const QQMusicLocalAdapter = require('./adapters/qqmusic-local');

class SyncManager {
  constructor() {
    this.configPath = path.join(__dirname, 'config.json');
    this.dataDir = path.join(__dirname, '../user');
    this.backupDir = path.join(__dirname, 'backups');

    // 注册所有适配器
    this.adapters = {
      netease: new NeteaseAdapter(),
      'netease-local': new NeteaseLocalAdapter(),
      qqmusic: new QQMusicAdapter(),
      'qqmusic-local': new QQMusicLocalAdapter(),
    };

    this.tasks = [];
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    }
    return {
      sources: [],
      settings: {
        autoSync: true,
        syncOnStartup: true,
        backupBeforeSync: true,
        maxBackups: 5,
        mergeStrategy: 'union' // union: 并集, intersect: 交集, local-first: 本地优先
      }
    };
  }

  saveConfig(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * 扫描可用的本地数据源
   */
  scanLocalSources() {
    console.log('🔍 扫描本地数据源...\n');

    const sources = [];

    // 检查网易云音乐本地
    const neteaseLocal = this.adapters['netease-local'];
    const neteaseStatus = neteaseLocal.isAvailable();
    if (neteaseStatus.available) {
      console.log('  ✅ 网易云音乐(本地) - 可用');
      console.log(`     数据库: ${neteaseStatus.dbPath}`);
      sources.push({
        platform: 'netease-local',
        name: '网易云音乐(本地)',
        enabled: true,
        autoDetected: true,
        syncInterval: 3600 // 1小时
      });
    } else {
      console.log('  ❌ 网易云音乐(本地) - 不可用');
      console.log(`     原因: ${neteaseStatus.reason}`);
    }

    // 检查QQ音乐本地
    const qqmusicLocal = this.adapters['qqmusic-local'];
    const qqmusicStatus = qqmusicLocal.isAvailable();
    if (qqmusicStatus.available) {
      console.log('  ✅ QQ音乐(本地) - 可用');
      console.log(`     数据库: ${qqmusicStatus.dbPath}`);
      sources.push({
        platform: 'qqmusic-local',
        name: 'QQ音乐(本地)',
        enabled: true,
        autoDetected: true,
        syncInterval: 3600
      });
    } else {
      console.log('  ❌ QQ音乐(本地) - 不可用');
      console.log(`     原因: ${qqmusicStatus.reason}`);
    }

    console.log('');
    return sources;
  }

  /**
   * 初始化同步任务
   */
  init() {
    const config = this.loadConfig();

    console.log('🔄 同步管理器初始化...\n');

    // 如果没有配置源，自动扫描本地
    if (config.sources.length === 0) {
      const localSources = this.scanLocalSources();
      config.sources = localSources;
      this.saveConfig(config);
    }

    console.log(`📦 配置了 ${config.sources.length} 个数据源`);
    config.sources.forEach(s => {
      const status = s.enabled ? '🟢' : '⚪';
      const type = s.autoDetected ? '[自动]' : '[手动]';
      console.log(`   ${status} ${s.name} ${type}`);
    });
    console.log('');

    // 启动时同步
    if (config.settings.syncOnStartup) {
      console.log('⏳ 启动时同步...\n');
      this.syncAll();
    }

    // 设置定时任务
    if (config.settings.autoSync) {
      this.setupScheduledTasks(config);
    }

    console.log('✅ 同步管理器已启动');
  }

  /**
   * 设置定时同步任务
   */
  setupScheduledTasks(config) {
    // 清理旧任务
    this.tasks.forEach(task => task.stop());
    this.tasks = [];

    // 每小时检查一次是否需要同步
    const task = cron.schedule('0 * * * *', () => {
      console.log(`\n⏰ [${new Date().toLocaleString()}] 定时检查同步...`);
      this.checkAndSync();
    }, {
      timezone: 'Asia/Shanghai'
    });

    this.tasks.push(task);
    console.log('⏰ 定时任务已设置: 每小时检查同步');
  }

  /**
   * 检查并同步
   */
  async checkAndSync() {
    const config = this.loadConfig();
    const now = Date.now();
    let needSync = false;

    for (const source of config.sources) {
      if (!source.enabled) continue;

      const lastSync = source.lastSync ? new Date(source.lastSync).getTime() : 0;
      const intervalMs = (source.syncInterval || 3600) * 1000;

      if (now - lastSync >= intervalMs) {
        console.log(`🔄 ${source.name} 需要同步`);
        await this.syncSource(source);
        needSync = true;
      }
    }

    // 如果有源同步了，执行合并
    if (needSync) {
      await this.mergeAllSources();
    }
  }

  /**
   * 同步所有启用的源
   */
  async syncAll() {
    const config = this.loadConfig();
    let synced = false;

    for (const source of config.sources) {
      if (source.enabled) {
        await this.syncSource(source);
        synced = true;
      }
    }

    // 合并所有源的数据
    if (synced) {
      await this.mergeAllSources();
    }
  }

  /**
   * 同步单个数据源
   */
  async syncSource(source) {
    const adapter = this.adapters[source.platform];
    if (!adapter) {
      console.error(`❌ 不支持的源: ${source.platform}`);
      return;
    }

    console.log(`\n🎵 开始同步: ${source.name}`);
    const startTime = Date.now();

    try {
      // 1. 备份现有数据
      if (this.loadConfig().settings.backupBeforeSync) {
        this.backupData();
      }

      // 2. 从源获取新数据
      const data = await adapter.fetch(source);
      console.log(`  📥 获取到 ${data.likedSongs?.length || 0} 首喜欢歌曲, ${data.playlists?.length || 0} 个歌单`);

      // 3. 保存源数据到临时文件
      const sourceDataPath = path.join(this.dataDir, `source-${source.platform}.json`);
      fs.writeFileSync(sourceDataPath, JSON.stringify(data, null, 2));

      // 4. 更新同步时间
      source.lastSync = new Date().toISOString();
      const config = this.loadConfig();
      const idx = config.sources.findIndex(s => s.platform === source.platform);
      if (idx >= 0) {
        config.sources[idx] = source;
        this.saveConfig(config);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✅ 同步完成 (${duration}s)`);

    } catch (error) {
      console.error(`  ❌ 同步失败: ${error.message}`);
    }
  }

  /**
   * 合并所有源的数据（分开存储策略）
   * 每个平台独立存储，保留原始ID用于播放
   */
  async mergeAllSources() {
    console.log('\n🔄 整理数据源...');

    const config = this.loadConfig();

    // 1. 收集所有源数据（分开存储）
    const platformData = {};
    for (const source of config.sources) {
      const sourcePath = path.join(this.dataDir, `source-${source.platform}.json`);
      if (fs.existsSync(sourcePath)) {
        try {
          const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
          platformData[source.platform] = data;
        } catch (e) {
          console.log(`  ⚠️  读取 ${source.platform} 数据失败`);
        }
      }
    }

    if (Object.keys(platformData).length === 0) {
      console.log('  ⚠️  没有可整理的数据');
      return;
    }

    // 2. 分开存储每个平台的数据（保留原始ID）
    const playlists = {
      platforms: {},
      metadata: {
        platforms: Object.keys(platformData),
        totalSources: Object.keys(platformData).length,
        mergeTime: new Date().toISOString(),
        storageMode: 'separate' // 分开存储
      }
    };

    // 为每个平台创建独立的数据结构
    for (const [platform, data] of Object.entries(platformData)) {
      playlists.platforms[platform] = {
        platform: platform,
        userId: data.userId,
        // 喜欢的歌曲（保留完整平台ID）
        likedSongs: (data.likedSongs || []).map(song => ({
          ...song,
          // 确保有平台ID
          platformId: song.platformId || song.id,
          platform: song.platform || platform.split('-')[0]
        })),
        // 歌单（保留完整平台ID）
        playlists: (data.playlists || []).map(playlist => ({
          ...playlist,
          platform: playlist.platform || platform.split('-')[0],
          // 歌单中的歌曲保留原始ID
          tracks: (playlist.tracks || []).map(track => ({
            ...track,
            platformId: track.platformId || track.id,
            platform: track.platform || platform.split('-')[0]
          }))
        })),
        // 统计信息
        stats: {
          totalSongs: new Set([
            ...(data.likedSongs || []).map(s => s.id),
            ...(data.playlists || []).flatMap(p => p.tracks || []).map(t => t.id)
          ]).size,
          likedCount: (data.likedSongs || []).length,
          playlistCount: (data.playlists || []).length
        }
      };

      console.log(`  📊 ${platform}:`);
      console.log(`     喜欢歌曲: ${playlists.platforms[platform].likedSongs.length}`);
      console.log(`     歌单数量: ${playlists.platforms[platform].playlists.length}`);
      console.log(`     唯一歌曲: ${playlists.platforms[platform].stats.totalSongs}`);
    }

    // 3. 保存分开存储的结果
    const outputPath = path.join(this.dataDir, 'playlists.json');
    fs.writeFileSync(outputPath, JSON.stringify(playlists, null, 2));
    console.log(`\n  💾 已保存到: ${outputPath}`);

    // 4. 更新品味分析（基于分开的数据）
    await this.updateTasteAnalysisSeparate(playlists);
  }

  /**
   * 基于分开存储更新品味分析
   */
  async updateTasteAnalysisSeparate(playlists) {
    const allSongs = [];
    const allArtists = {};
    const genreKeywords = {};
    const platformStats = {};
    const languageCount = { '国语': 0, '粤语': 0, '英语': 0, '日语': 0, '韩语': 0, '纯音乐/器乐': 0 };

    for (const [platform, data] of Object.entries(playlists.platforms)) {
      const platformSongs = [
        ...data.likedSongs,
        ...data.playlists.flatMap(p => p.tracks || [])
      ];
      platformStats[platform] = platformSongs.length;

      for (const song of platformSongs) {
        allSongs.push({ ...song, sourcePlatform: platform });

        // 统计艺术家
        const artists = (song.artist || '').split(/[,/&、]/).map(a => a.trim()).filter(Boolean);
        artists.forEach(a => { allArtists[a] = (allArtists[a] || 0) + 1; });

        // 简单语言判断（基于歌名字符集）
        const name = song.name || '';
        if (/[一-鿿]/.test(name)) {
          // 粤语艺术家关键词
          const cantoPop = ['陈奕迅','张国荣','Beyond','王菲','古巨基','许冠杰'];
          if (cantoPop.some(a => (song.artist || '').includes(a))) languageCount['粤语']++;
          else languageCount['国语']++;
        } else if (/[぀-ヿ]/.test(name)) {
          languageCount['日语']++;
        } else if (/[가-힣]/.test(name)) {
          languageCount['韩语']++;
        } else if (/^[a-zA-Z\s\-'\.]+$/.test(name)) {
          languageCount['英语']++;
        }

        // 专辑名中的风格关键词
        const albumKeywords = ['古典','Jazz','爵士','Folk','民谣','Electronic','电子','R&B','Hip','Pop','Rock','摇滚','Lofi','Piano','钢琴','OST','原声'];
        albumKeywords.forEach(k => {
          if ((song.album || '').includes(k) || (song.name || '').includes(k)) {
            genreKeywords[k] = (genreKeywords[k] || 0) + 1;
          }
        });
      }
    }

    if (allSongs.length === 0) return;

    const topArtists = Object.entries(allArtists)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => `${name}（${count}首）`);

    const topGenres = Object.entries(genreKeywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    const topLanguages = Object.entries(languageCount)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${lang}（${count}首）`);

    const updatedAt = new Date().toLocaleString('zh-CN');
    const tasteBlock = `## 音乐品味（歌单分析，自动更新）
> 最后同步：${updatedAt}，数据来源：${allSongs.length} 首歌曲

### 常听艺术家 TOP 20
${topArtists.join('、')}

### 歌曲语言分布
${topLanguages.join('、')}

### 歌曲风格关键词
${topGenres.length > 0 ? topGenres.join('、') : '（数据不足，待积累）'}

### 歌单规模
${Object.entries(platformStats).map(([p, c]) => `- ${p}：${c} 首`).join('\n')}`;

    // 写入 MEMORY.md，替换"音乐品味"区块（如存在）或追加
    const memoryPath = path.join(this.dataDir, 'MEMORY.md');
    let memory = '';
    if (fs.existsSync(memoryPath)) {
      memory = fs.readFileSync(memoryPath, 'utf8');
    }

    const blockStart = '## 音乐品味（歌单分析，自动更新）';
    const nextBlockPattern = /\n## /g;

    if (memory.includes(blockStart)) {
      // 找到区块起止位置，替换
      const startIdx = memory.indexOf(blockStart);
      let endIdx = memory.length;
      nextBlockPattern.lastIndex = startIdx + blockStart.length;
      const nextMatch = nextBlockPattern.exec(memory);
      if (nextMatch) endIdx = nextMatch.index;
      memory = memory.slice(0, startIdx) + tasteBlock + '\n' + memory.slice(endIdx);
    } else {
      // 追加到文件末尾
      memory = memory.trimEnd() + '\n\n' + tasteBlock + '\n';
    }

    fs.writeFileSync(memoryPath, memory, 'utf8');
    console.log('  📝 MEMORY.md 品味区块已更新');
  }

  /**
   * 获取特定平台的歌曲列表（用于播放）
   */
  getPlatformSongs(platform) {
    const playlistPath = path.join(this.dataDir, 'playlists.json');
    if (!fs.existsSync(playlistPath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
      const platformData = data.platforms[platform];

      if (!platformData) return [];

      // 合并所有歌曲（去重）
      const songMap = new Map();

      // 添加喜欢的歌曲
      for (const song of platformData.likedSongs || []) {
        songMap.set(song.platformId || song.id, song);
      }

      // 添加歌单中的歌曲
      for (const playlist of platformData.playlists || []) {
        for (const song of playlist.tracks || []) {
          songMap.set(song.platformId || song.id, song);
        }
      }

      return Array.from(songMap.values());
    } catch (e) {
      console.error('获取平台歌曲失败:', e.message);
      return [];
    }
  }

  /**
   * 更新品味分析
   */
  async updateTasteAnalysis(merged) {
    const songs = merged.songs || [];
    if (songs.length === 0) return;

    // 分析艺术家
    const artistCount = {};
    songs.forEach(s => {
      const artists = s.artist.split(/[,/&、]/).map(a => a.trim());
      artists.forEach(a => {
        if (a) artistCount[a] = (artistCount[a] || 0) + 1;
      });
    });

    const topArtists = Object.entries(artistCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name]) => name);

    // 分析平台分布
    const platformCount = {};
    songs.forEach(s => {
      const p = s.platform || 'unknown';
      platformCount[p] = (platformCount[p] || 0) + 1;
    });

    // 生成 taste.md
    const tasteContent = `# 用户音乐品味档案

> 自动生成于 ${new Date().toLocaleString()}
> 数据来源: ${songs.length} 首歌曲，${merged.metadata.platforms.length} 个平台

## 基本信息
- **总歌曲数**: ${songs.length} 首
- **喜欢歌曲**: ${merged.likedSongs?.length || 0} 首
- **歌单数量**: ${merged.playlists?.length || 0} 个

## 平台分布
${Object.entries(platformCount).map(([p, c]) => `- **${p}**: ${c} 首 (${Math.round(c/songs.length*100)}%)`).join('\n')}

## 喜欢的艺术家 TOP ${topArtists.length}
${topArtists.map(a => `- ${a}`).join('\n')}

## 同步状态
${merged.metadata.platforms.map(p => `- ✅ ${p}`).join('\n')}

---
*最后同步: ${new Date().toLocaleString()}*
`;

    fs.writeFileSync(path.join(this.dataDir, 'taste.md'), tasteContent);
    console.log('  📝 已更新品味档案');
  }

  /**
   * 添加新的同步源
   */
  addSource(platform, config) {
    const existing = this.loadConfig();

    const idx = existing.sources.findIndex(s => s.platform === platform);
    if (idx >= 0) {
      existing.sources[idx] = { ...existing.sources[idx], ...config, enabled: true };
    } else {
      existing.sources.push({
        platform,
        enabled: true,
        syncInterval: 3600,
        lastSync: null,
        ...config
      });
    }

    this.saveConfig(existing);
    console.log(`✅ 已添加/更新 ${platform} 数据源`);
  }

  /**
   * 备份数据
   */
  backupData() {
    const playlistsPath = path.join(this.dataDir, 'playlists.json');
    if (!fs.existsSync(playlistsPath)) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `playlists-${timestamp}.json`);

    fs.copyFileSync(playlistsPath, backupPath);
    this.cleanOldBackups();

    console.log(`  💾 已备份: ${backupPath}`);
  }

  /**
   * 清理旧备份
   */
  cleanOldBackups() {
    const config = this.loadConfig();
    const maxBackups = config.settings.maxBackups || 5;

    const backups = fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('playlists-'))
      .map(f => ({
        name: f,
        path: path.join(this.backupDir, f),
        time: fs.statSync(path.join(this.backupDir, f)).mtime
      }))
      .sort((a, b) => b.time - a.time);

    if (backups.length > maxBackups) {
      backups.slice(maxBackups).forEach(b => {
        fs.unlinkSync(b.path);
      });
    }
  }

  /**
   * 停止所有任务
   */
  stop() {
    this.tasks.forEach(task => task.stop());
    console.log('🛑 同步管理器已停止');
  }
}

module.exports = SyncManager;
