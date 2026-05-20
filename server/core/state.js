/**
 * State.js - 状态与记忆管理
 * messages · plays · plan · prefs — 跨重启持久
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class StateManager {
  constructor() {
    this.dataDir = path.join(__dirname, '../../user');
    this.dbPath = path.join(this.dataDir, 'state.db.json');
    this.tastePath = path.join(this.dataDir, 'taste.md');
    this.routinesPath = path.join(this.dataDir, 'routines.md');
    this.playlistsPath = path.join(this.dataDir, 'playlists.json');
    this.moodRulesPath = path.join(this.dataDir, 'mood-rules.md');

    this.ensureDataDir();
    this.loadState();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  loadState() {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.db = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      } catch (e) {
        this.initDefaultState();
      }
    } else {
      this.initDefaultState();
    }
  }

  initDefaultState() {
    this.db = {
      messages: [],
      plays: [],
      plan: {},
      prefs: {
        volume: 0.7,
        autoPlay: true,
        preferredGenres: [],
        dislikedGenres: [],
        preferredArtists: [],
        dislikedArtists: [],
        timeBasedPreferences: {}
      },
      nowPlaying: null,
      currentMood: null,
      lastUpdate: new Date().toISOString()
    };
    this.saveState();
  }

  saveState() {
    this.db.lastUpdate = new Date().toISOString();
    fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2));
  }

  // ===== 当前播放 =====

  getNowPlaying() {
    return this.db.nowPlaying;
  }

  updateNowPlaying(song) {
    if (this.db.nowPlaying) {
      this.recordPlay(this.db.nowPlaying);
    }
    this.db.nowPlaying = {
      ...song,
      startedAt: new Date().toISOString()
    };
    this.saveState();
  }

  // ===== 播放历史 =====

  recordPlay(song) {
    const record = {
      id: uuidv4(),
      songId: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      playedAt: new Date().toISOString(),
      context: song.context || {}
    };
    this.db.plays.unshift(record);

    // 只保留最近500条
    if (this.db.plays.length > 500) {
      this.db.plays = this.db.plays.slice(0, 500);
    }

    this.saveState();
  }

  getPlayHistory(limit = 50) {
    return this.db.plays.slice(0, limit);
  }

  // ===== 记忆系统集成 =====

  setMemoryManager(memoryManager) {
    this.memoryManager = memoryManager;
  }

  // ===== 消息历史 =====

  async addMessage(role, content, metadata = {}) {
    const message = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...metadata
    };
    this.db.messages.push(message);

    // 实时追加原文到当日日志（同步、不依赖 Claude，防止进程退出丢失）
    if (this.memoryManager) {
      this.memoryManager.appendRaw(role, content);
    }

    // 保持消息上限
    if (this.db.messages.length > 100) {
      this.db.messages = this.db.messages.slice(-100);
    }

    this.saveState();
  }

  getRecentMessages(limit = 20) {
    return this.db.messages.slice(-limit);
  }

  // ===== 用户品味 =====

  getUserTaste() {
    const taste = {
      prefs: this.db.prefs,
      favoriteSongs: this.getFavoriteSongs(),
      favoriteArtists: this.getFavoriteArtists(),
      favoriteGenres: this.getFavoriteGenres(),
      listeningPatterns: this.analyzeListeningPatterns(),
      moodHistory: this.getMoodHistory()
    };

    // 读取品味文档
    if (fs.existsSync(this.tastePath)) {
      taste.description = fs.readFileSync(this.tastePath, 'utf8');
    }

    return taste;
  }

  updateUserTaste(updates) {
    this.db.prefs = { ...this.db.prefs, ...updates };
    this.saveState();
  }

  getFavoriteSongs(limit = 20) {
    const feedback = this.db.plays.filter(p => p.feedback?.liked);
    const songCount = {};
    feedback.forEach(p => {
      songCount[p.songId] = (songCount[p.songId] || 0) + 1;
    });

    return Object.entries(songCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, count]) => ({ id, count }));
  }

  getFavoriteArtists(limit = 10) {
    const artistCount = {};
    this.db.plays.forEach(p => {
      if (p.artist) {
        artistCount[p.artist] = (artistCount[p.artist] || 0) + 1;
      }
    });

    return Object.entries(artistCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  getFavoriteGenres() {
    // 从播放历史分析风格偏好
    return this.db.prefs.preferredGenres || [];
  }

  analyzeListeningPatterns() {
    const plays = this.db.plays;
    if (plays.length === 0) return {};

    // 按时间段统计
    const hourDistribution = {};
    const dayDistribution = {};

    plays.forEach(p => {
      const date = new Date(p.playedAt);
      const hour = date.getHours();
      const day = date.getDay();

      hourDistribution[hour] = (hourDistribution[hour] || 0) + 1;
      dayDistribution[day] = (dayDistribution[day] || 0) + 1;
    });

    return {
      totalPlays: plays.length,
      hourDistribution,
      dayDistribution,
      avgDailyPlays: plays.length / Math.max(1, Object.keys(dayDistribution).length)
    };
  }

  // ===== 反馈记录 =====

  recordFeedback(songId, feedback, context = {}) {
    const record = {
      songId,
      feedback,
      context,
      timestamp: new Date().toISOString()
    };

    // 更新对应播放记录的反馈
    const playRecord = this.db.plays.find(p => p.songId === songId);
    if (playRecord) {
      playRecord.feedback = feedback;
    }

    // 更新用户偏好
    if (feedback.liked && playRecord) {
      if (!this.db.prefs.preferredArtists.includes(playRecord.artist)) {
        this.db.prefs.preferredArtists.push(playRecord.artist);
      }
    }

    if (feedback.disliked && playRecord) {
      if (!this.db.prefs.dislikedArtists.includes(playRecord.artist)) {
        this.db.prefs.dislikedArtists.push(playRecord.artist);
      }
    }

    this.saveState();
  }

  recordSkip(songId, context = {}) {
    if (songId) {
      this.recordFeedback(songId, { skipped: true, reason: context.reason }, context);
    }
  }

  async recordSearch(query, results) {
    await this.addMessage('search', query, { results: results.map(r => r.id) });
  }

  // ===== 心情状态 =====

  getCurrentMood() {
    return this.db.currentMood;
  }

  setCurrentMood(mood, reason = '') {
    this.db.currentMood = {
      mood,
      reason,
      timestamp: new Date().toISOString()
    };
    this.saveState();
  }

  getMoodHistory() {
    return this.db.messages
      .filter(m => m.metadata?.mood)
      .slice(-20);
  }

  // ===== 播放计划 =====

  setPlan(plan) {
    this.db.plan = {
      ...plan,
      updatedAt: new Date().toISOString()
    };
    this.saveState();
  }

  getPlan() {
    return this.db.plan;
  }

  // ===== 歌单 =====

  getPlaylist() {
    if (fs.existsSync(this.playlistsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.playlistsPath, 'utf8'));
        // 从 playlists.json 中提取所有歌曲
        const songs = [];
        const seen = new Set();

        if (data.platforms) {
          for (const platform of Object.values(data.platforms)) {
            // 添加喜欢的歌曲
            if (platform.likedSongs) {
              for (const song of platform.likedSongs) {
                const key = `${song.name}-${song.artist}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  songs.push(song);
                }
              }
            }
            // 添加歌单中的歌曲
            if (platform.playlists) {
              for (const playlist of platform.playlists) {
                if (playlist.tracks) {
                  for (const song of playlist.tracks) {
                    const key = `${song.name}-${song.artist}`;
                    if (!seen.has(key)) {
                      seen.add(key);
                      songs.push(song);
                    }
                  }
                }
              }
            }
          }
        }

        return songs;
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  updatePlaylist(songs) {
    fs.writeFileSync(this.playlistsPath, JSON.stringify(songs, null, 2));
  }

  // ===== 日常规律 =====

  getRoutines() {
    if (fs.existsSync(this.routinesPath)) {
      return fs.readFileSync(this.routinesPath, 'utf8');
    }
    return '';
  }

  // ===== 心情规则 =====

  getMoodRules() {
    if (fs.existsSync(this.moodRulesPath)) {
      return fs.readFileSync(this.moodRulesPath, 'utf8');
    }
    return '';
  }

  // ===== 自动生成用户标签 =====

  getUserTags() {
    const tags = new Set();
    const playlist = this.getPlaylist();
    const plays = this.db.plays;
    const prefs = this.db.prefs;

    // 从歌单风格分析
    const genreKeywords = {
      'JAZZ+HIPHOP': ['爵士', '嘻哈', 'jazz', 'hiphop', 'hip-hop'],
      'NEO-CLASSICAL': ['古典', '钢琴', '小提琴', 'classic', 'piano'],
      '90S华语': ['90年代', '经典老歌', '怀旧'],
      'HIP-HOP': ['说唱', 'rap', '嘻哈', 'hiphop'],
      '柴可夫斯基&EMINEM': ['交响乐', '摇滚', 'eminem'],
      'J-ROCK': ['日系', 'j-rock', 'japanese'],
      '下雨白噪音': ['白噪音', '雨声', 'ambient'],
      'POST-PUNK': ['后朋', 'post-punk', 'punk'],
      'SHIBUYA-KEI': ['涩谷系', 'shibuya', 'j-pop'],
    };

    // 分析歌单中的标签
    playlist.forEach(song => {
      const text = `${song.name} ${song.artist} ${song.genre || ''} ${(song.tags || []).join(' ')}`.toLowerCase();

      Object.entries(genreKeywords).forEach(([tag, keywords]) => {
        if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
          tags.add(tag);
        }
      });
    });

    // 从播放历史分析
    const playCount = plays.length;
    if (playCount > 100) tags.add('重度音乐爱好者');
    else if (playCount > 50) tags.add('音乐发烧友');
    else if (playCount > 10) tags.add('音乐探索者');

    // 从偏好分析
    if (prefs.preferredArtists?.length > 5) {
      tags.add('忠实粉丝型');
    }

    // 从播放时段分析
    const hourDistribution = {};
    plays.forEach(p => {
      const hour = new Date(p.playedAt).getHours();
      hourDistribution[hour] = (hourDistribution[hour] || 0) + 1;
    });

    const nightPlays = (hourDistribution[22] || 0) + (hourDistribution[23] || 0) + (hourDistribution[0] || 0);
    if (nightPlays > plays.length * 0.3) {
      tags.add('夜猫子');
    }

    // 从反馈分析
    const likedCount = plays.filter(p => p.feedback?.liked).length;
    if (likedCount > 10) {
      tags.add('品味挑剔');
    }

    // 默认标签
    if (tags.size === 0) {
      tags.add('音乐探索者');
      tags.add('正在形成品味');
    }

    return Array.from(tags).slice(0, 8); // 最多返回8个标签
  }

  // ===== 获取 Agent 个人资料 =====

  getAgentProfile() {
    const taste = this.getUserTaste();
    const tags = this.getUserTags();
    const playCount = this.db.plays.length;

    // 获取自定义 Agent 名字，默认为 RadioMind
    const agentName = this.db.prefs.agentName || 'RadioMind';

    // 生成动态签名
    const taglines = [
      '一开机我就打碟',
      'Your mood is my prompt',
      'I hate algorithm. I have taste.',
      '24/7 在线打碟',
      '懂你的音乐品味',
    ];

    // 根据播放历史选择最合适的签名
    let tagline = taglines[0];
    if (playCount > 50) tagline = taglines[2];
    else if (playCount > 20) tagline = taglines[3];

    // 生成动态 bio
    const favoriteArtists = taste.favoriteArtists?.slice(0, 3).map(a => a.name).join('、') || '未知';
    const bioLines = [
      `你的私人 AI DJ，专注${tags[0] || '音乐'}品味`,
      `最近常听：${favoriteArtists}`,
      'Your mood is my prompt.',
      'I hate algorithm. I have taste.',
    ];

    return {
      name: agentName,
      tagline,
      bio: bioLines,
      tags,
      stats: {
        onAir: '24/7',
        genres: tags.length > 3 ? '∞' : tags.length,
        listener: 1,
        totalPlays: playCount,
      },
    };
  }

  // 设置 Agent 名字
  setAgentName(name) {
    if (name && name.trim()) {
      this.db.prefs.agentName = name.trim();
      this.saveState();
      return true;
    }
    return false;
  }

  // 获取 Agent 名字
  getAgentName() {
    return this.db.prefs.agentName || 'RadioMind';
  }
}

module.exports = StateManager;
