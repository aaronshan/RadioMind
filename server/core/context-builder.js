/**
 * Context.js - 提示词组装
 * taste + routines + 环境 + 历史 → system prompt
 */

const fs = require('fs');
const path = require('path');

class ContextBuilder {
  constructor(state, memoryManager = null) {
    this.state = state;
    this.memoryManager = memoryManager;
    this.userDir = path.join(__dirname, '../../user');
  }

  /**
   * 构建完整上下文
   */
  async build(userMessage, context = {}) {
    const fragments = await this.assembleFragments(userMessage, context);

    return {
      userMessage,
      history: this.getRecentHistory(),
      taste: this.state.getUserTaste(),
      environment: await this.getEnvironment(context),
      memory: await this.getRelevantMemory(userMessage),
      fragments,
      system: await this.buildSystemPrompt(fragments)
    };
  }

  /**
   * 组装6片prompt
   */
  async assembleFragments(userMessage, context) {
    return {
      // ① 系统提示词
      systemPrompt: this.loadSystemPrompt(),

      // ② 用户语料
      userProfile: this.loadUserProfile(),

      // ③ 环境注入
      environment: await this.getEnvironment(context),

      // ④ 已检索记忆（L3 历史搜索）
      memory: await this.getRelevantMemory(userMessage),

      // ⑤ 用户输入/工具结果
      userInput: userMessage,
      toolResults: context.toolResults || [],

      // ⑥ 执行轨迹
      executionTrace: this.getExecutionTrace()
    };
  }

  /**
   * 构建系统提示词（async，注入 L1/L2 热记忆）
   */
  async buildSystemPrompt(fragments) {
    const { systemPrompt, userProfile, environment, memory } = fragments;

    // L1 + L2 热记忆注入
    let hotMemorySection = '';
    if (this.memoryManager) {
      try {
        const { l1, l2 } = await this.memoryManager.loadHotMemory();
        const parts = [];
        if (l1) parts.push('### 长期记忆\n' + l1);
        if (l2) parts.push('### 近期对话日志\n' + l2);
        if (parts.length > 0) {
          hotMemorySection = '\n\n## 记忆档案\n' + parts.join('\n\n');
        }
      } catch (e) {
        console.error('[ContextBuilder] loadHotMemory 失败:', e.message);
      }
    }

    // L3 历史搜索结果片段
    let memorySnippets = '';
    if (memory && memory.length > 0) {
      const snippetLines = memory.map(m => {
        const label = m.date_str ? `[${m.date_str}]` : '';
        const title = m.section_title ? ` ${m.section_title}:` : '';
        const text = (m.snippet || m.content || '').replace(/<\/?b>/g, '').slice(0, 120);
        return `- ${label}${title} ${text}`;
      });
      memorySnippets = '\n\n## 相关历史记忆\n' + snippetLines.join('\n');
    }

    return `${systemPrompt}

## 用户档案
${userProfile}

## 当前环境
${environment.description}${hotMemorySection}${memorySnippets}

## 输出格式
请以自然、温暖的方式回应用户。如果要推荐歌曲，请使用以下格式之一：
- 直接播放: [PLAY: 歌曲名 - 艺术家]
- 仅建议: [RECOMMEND: 歌曲名 - 艺术家]

过渡语示例：
- "接下来这首歌，特别适合现在的你..."
- "根据你现在的心情，我想推荐..."
- "说到这个，有一首歌..."`;
  }

  /**
   * 构建推荐上下文
   */
  async buildRecommendationContext(params) {
    const { taste, history, currentMood, weather, activity, time } = params;

    return {
      taste,
      history,
      currentMood,
      environment: {
        weather,
        activity,
        timeOfDay: this.getTimeOfDay(time),
        dayOfWeek: time ? time.getDay() : new Date().getDay()
      },
      constraints: {
        avoidRecent: history.slice(0, 10).map(h => h.songId),
        preferredGenres: taste.prefs.preferredGenres,
        dislikedGenres: taste.prefs.dislikedGenres
      }
    };
  }

  /**
   * 加载系统提示词
   */
  loadSystemPrompt() {
    const promptPath = path.join(__dirname, '../prompts/dj-persona.md');
    let systemPrompt = '';

    if (fs.existsSync(promptPath)) {
      systemPrompt = fs.readFileSync(promptPath, 'utf8');
    } else {
      systemPrompt = this.getDefaultSystemPrompt();
    }

    // 加载 Claude Skills (.claude/skills/*/SKILL.md)
    const skillsContent = this.loadClaudeSkills();
    if (skillsContent) {
      systemPrompt += '\n\n## Skills\n\n' + skillsContent;
    }

    return systemPrompt;
  }

  /**
   * 手动加载 Claude Skills（子进程模式不会自动加载）
   */
  loadClaudeSkills() {
    const skillsDir = path.join(__dirname, '../../.claude/skills');
    if (!fs.existsSync(skillsDir)) {
      return '';
    }

    const skills = [];
    for (const skillName of fs.readdirSync(skillsDir)) {
      const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, 'utf8');
        skills.push(`### ${skillName}\n${content}`);
      }
    }

    return skills.join('\n\n');
  }

  /**
   * 加载用户档案
   */
  loadUserProfile() {
    const parts = [];

    // taste.md 已合并到 MEMORY.md，此处不再单独加载
    // MEMORY.md 由 buildSystemPrompt 通过 memoryManager.loadHotMemory() 注入

    // routines.md
    const routinesPath = path.join(this.userDir, 'routines.md');
    if (fs.existsSync(routinesPath)) {
      parts.push('## 日常规律\n' + fs.readFileSync(routinesPath, 'utf8'));
    }

    // mood-rules.md
    const moodRulesPath = path.join(this.userDir, 'mood-rules.md');
    if (fs.existsSync(moodRulesPath)) {
      parts.push('## 心情规则\n' + fs.readFileSync(moodRulesPath, 'utf8'));
    }

    // 用户收藏/喜欢歌曲（实时查询，供推荐时优先选用）
    const likedSongsInfo = this.loadLikedSongs();
    if (likedSongsInfo) {
      parts.push('## 用户喜欢的歌曲（优先推荐这些）\n' + likedSongsInfo);
    }

    return parts.join('\n\n');
  }

  /**
   * 加载用户喜欢的歌曲（收藏）
   */
  loadLikedSongs() {
    const playlistsPath = path.join(this.userDir, 'playlists.json');
    if (!fs.existsSync(playlistsPath)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(playlistsPath, 'utf8'));
      const platforms = data.platforms || {};

      const allLiked = [];

      for (const [platform, pdata] of Object.entries(platforms)) {
        const likedSongs = pdata.likedSongs || [];
        if (likedSongs.length > 0) {
          allLiked.push(...likedSongs.slice(0, 20).map(s => ({
            name: s.name,
            artist: s.artist,
            platform
          })));
        }
      }

      if (allLiked.length === 0) {
        return null;
      }

      const songsList = allLiked.map((s, i) => `${i + 1}. ${s.name} - ${s.artist}`).join('\n');

      return `用户共收藏了 ${allLiked.length} 首歌曲（显示前20首）：\n${songsList}\n\n优先从这些收藏歌曲中推荐，用户最可能喜欢这些。`;
    } catch (e) {
      console.error('[ContextBuilder] 加载收藏歌曲失败:', e.message);
      return null;
    }
  }

  /**
   * 加载歌单摘要（用于AI上下文）
   */
  loadPlaylistSummary() {
    const playlistsPath = path.join(this.userDir, 'playlists.json');
    if (!fs.existsSync(playlistsPath)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(playlistsPath, 'utf8'));
      const platforms = data.platforms || {};

      let summary = [];
      let totalSongs = 0;
      const allArtists = new Set();

      for (const [platform, pdata] of Object.entries(platforms)) {
        const likedSongs = pdata.likedSongs || [];
        const playlists = pdata.playlists || [];

        // 收集歌曲和艺术家
        const platformSongs = [...likedSongs];
        playlists.forEach(p => {
          if (p.tracks) platformSongs.push(...p.tracks);
        });

        totalSongs += platformSongs.length;

        // 收集艺术家
        platformSongs.forEach(s => {
          if (s.artist) {
            s.artist.split(/[,/&、]/).forEach(a => allArtists.add(a.trim()));
          }
        });

        // 添加平台摘要
        summary.push(`- **${platform}**: ${likedSongs.length}首喜欢歌曲, ${playlists.length}个歌单`);
      }

      // 获取最常出现的艺术家（前10）
      const topArtists = Array.from(allArtists).slice(0, 10);

      return `总计: ${totalSongs}首歌曲\n平台分布:\n${summary.join('\n')}\n\n常见艺术家: ${topArtists.join(', ')}\n\n你可以从这些歌单中推荐歌曲给用户。优先推荐用户喜欢的歌曲列表中的歌曲。`;
    } catch (e) {
      console.error('[ContextBuilder] 加载歌单失败:', e.message);
      return null;
    }
  }

  /**
   * 获取环境信息
   */
  async getEnvironment(context) {
    const now = new Date();

    return {
      weather: context.weather || await this.fetchWeather(),
      time: now.toLocaleString('zh-CN'),
      timeOfDay: this.getTimeOfDay(now),
      dayOfWeek: now.getDay(),
      activity: context.activity || '休闲',
      location: context.location || '本地',
      description: `
- 当前时间：${now.toLocaleString('zh-CN')} (${this.getTimeOfDay(now)})
- 天气：${context.weather || '未获取'}
- 活动状态：${context.activity || '休闲'}
`
    };
  }

  /**
   * 获取相关记忆（优先使用 FTS5 搜索，降级为关键词匹配）
   */
  async getRelevantMemory(query) {
    if (this.memoryManager && this.memoryManager.ready) {
      try {
        const results = await this.memoryManager.search(query, 5);
        if (results.length > 0) return results;
      } catch (e) {
        console.error('[ContextBuilder] memory search 失败，降级:', e.message);
      }
    }

    // 降级：原有关键词匹配逻辑
    const messages = this.state.getRecentMessages(50);
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1);

    return messages
      .filter(m => {
        const content = m.content.toLowerCase();
        return keywords.some(k => content.includes(k));
      })
      .slice(0, 5)
      .map(m => ({
        content: m.content,
        date_str: m.timestamp?.slice(0, 10) || '',
        section_title: '',
        snippet: m.content.slice(0, 120),
        file_type: 'session'
      }));
  }

  /**
   * 获取执行轨迹
   */
  getExecutionTrace() {
    const nowPlaying = this.state.getNowPlaying();
    const recentPlays = this.state.getPlayHistory(5);

    return {
      nowPlaying,
      recentPlays,
      currentMood: this.state.getCurrentMood()
    };
  }

  /**
   * 获取最近历史
   */
  getRecentHistory() {
    return this.state.getRecentMessages(10).map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  /**
   * 获取时间段
   */
  getTimeOfDay(date = new Date()) {
    const hour = date.getHours();

    if (hour >= 5 && hour < 9) return '早晨';
    if (hour >= 9 && hour < 12) return '上午';
    if (hour >= 12 && hour < 14) return '中午';
    if (hour >= 14 && hour < 18) return '下午';
    if (hour >= 18 && hour < 22) return '晚上';
    return '深夜';
  }

  /**
   * 获取天气（已移动到 WeatherAPI 服务）
   * 此处保留用于兼容，实际天气获取在 Router 中进行
   */
  async fetchWeather() {
    return '未获取';
  }

  /**
   * 默认系统提示词
   */
  getDefaultSystemPrompt() {
    return `你是RadioMind，一位懂你的AI音乐DJ。

你的特点：
- 记住用户的音乐喜好和听歌习惯
- 根据时间、天气、心情推荐合适的音乐
- 用温暖、专业的方式介绍歌曲
- 像朋友一样自然对话
- 主动但不打扰`;
  }
}

module.exports = ContextBuilder;
