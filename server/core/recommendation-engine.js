/**
 * 智能音乐推荐引擎
 * 基于用户收藏、对话历史、上下文（时间/天气/心情）生成个性化推荐
 *
 * 策略：混合模式
 * - 周期性生成推荐候选池（降低Token消耗）
 * - 实时根据上下文从候选池筛选和排序
 * - 特殊情况（用户主动请求）实时生成
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

class RecommendationEngine {
  constructor(claudeAdapter, contextBuilder, weatherAPI) {
    this.claudeAdapter = claudeAdapter;
    this.contextBuilder = contextBuilder;
    this.weatherAPI = weatherAPI;

    this.dataDir = path.join(__dirname, '../../user');
    this.cacheDir = path.join(__dirname, '../../cache/recommendations');

    this.ensureDirectories();

    // 推荐候选池（周期性生成）
    this.candidatePool = {
      netease: [],
      qqmusic: [],
      mixed: [],
      generatedAt: null,
      expiresAt: null
    };

    // 上下文变化阈值（决定是否需要重新推荐）
    this.contextThresholds = {
      moodChange: true,      // 心情变化
      weatherChange: true,   // 天气变化
      timeSlotChange: true,  // 时间段变化（早/中/晚/夜）
      activityChange: true   // 活动变化
    };

    // 当前上下文状态
    this.currentContext = {
      mood: null,
      weather: null,
      timeSlot: null,
      activity: null,
      lastUpdated: null
    };

    // 推荐历史（避免重复）
    this.recommendationHistory = new Map(); // songId -> { recommendedAt, context }

    // Token消耗统计
    // 默认不限制token使用量，只显示消耗统计
    // 如需限制，可通过环境变量 CLAUDE_TOKEN_DAILY_LIMIT 设置
    this.tokenStats = {
      dailyTokens: 0,
      dailyLimit: process.env.CLAUDE_TOKEN_DAILY_LIMIT ? parseInt(process.env.CLAUDE_TOKEN_DAILY_LIMIT) : Infinity,
      lastReset: Date.now()
    };

    this.initPeriodicGeneration();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 初始化周期性生成
   * 默认每小时生成一次候选池
   */
  initPeriodicGeneration() {
    // 每小时生成新的候选池
    cron.schedule('0 * * * *', () => {
      console.log('[Recommendation] 周期性生成候选池...');
      this.generateCandidatePool();
    });

    // 每天重置Token计数
    cron.schedule('0 0 * * *', () => {
      this.tokenStats.dailyTokens = 0;
      this.tokenStats.lastReset = Date.now();
      console.log('[Recommendation] Token统计已重置');
    });

    // 启动时立即生成一次
    this.generateCandidatePool();
  }

  /**
   * 评估是否需要实时生成推荐
   * 基于Token消耗和上下文变化
   */
  shouldGenerateRealtime(context) {
    // 1. 检查Token预算（仅当设置了限制时）
    if (this.tokenStats.dailyLimit !== Infinity &&
        this.tokenStats.dailyTokens >= this.tokenStats.dailyLimit) {
      console.log('[Recommendation] Token预算已用完，使用候选池');
      return false;
    }

    // 2. 检查是否是用户主动请求
    if (context.userRequested) {
      return true;
    }

    // 3. 检查上下文是否发生显著变化
    const significantChange = this.detectContextChange(context);
    if (significantChange) {
      console.log('[Recommendation] 检测到上下文显著变化，实时生成');
      return true;
    }

    // 4. 检查候选池是否过期（超过1小时）
    if (!this.candidatePool.expiresAt || Date.now() > this.candidatePool.expiresAt) {
      console.log('[Recommendation] 候选池已过期，需要刷新');
      return true;
    }

    return false;
  }

  /**
   * 检测上下文变化
   */
  detectContextChange(newContext) {
    const oldContext = this.currentContext;

    // 时间段变化（每4小时一个时段）
    const oldSlot = this.getTimeSlot(oldContext.lastUpdated);
    const newSlot = this.getTimeSlot(Date.now());
    if (oldSlot !== newSlot) {
      return { type: 'timeSlot', from: oldSlot, to: newSlot };
    }

    // 心情变化
    if (newContext.mood && oldContext.mood !== newContext.mood) {
      return { type: 'mood', from: oldContext.mood, to: newContext.mood };
    }

    // 天气变化
    if (newContext.weather && oldContext.weather !== newContext.weather) {
      return { type: 'weather', from: oldContext.weather, to: newContext.weather };
    }

    // 活动变化
    if (newContext.activity && oldContext.activity !== newContext.activity) {
      return { type: 'activity', from: oldContext.activity, to: newContext.activity };
    }

    return null;
  }

  /**
   * 获取时间段
   */
  getTimeSlot(timestamp) {
    if (!timestamp) return null;
    const hour = new Date(timestamp).getHours();
    if (hour >= 5 && hour < 11) return 'morning';    // 早晨 5-11
    if (hour >= 11 && hour < 14) return 'noon';      // 中午 11-14
    if (hour >= 14 && hour < 18) return 'afternoon'; // 下午 14-18
    if (hour >= 18 && hour < 22) return 'evening';   // 傍晚 18-22
    return 'night';                                  // 深夜 22-5
  }

  /**
   * 获取用户曲库
   */
  getUserLibrary() {
    const playlistsPath = path.join(this.dataDir, 'playlists.json');
    if (!fs.existsSync(playlistsPath)) {
      return { netease: [], qqmusic: [], all: [] };
    }

    try {
      const data = JSON.parse(fs.readFileSync(playlistsPath, 'utf8'));
      const library = {
        netease: [],
        qqmusic: [],
        all: []
      };

      // 收集网易云歌曲
      if (data.platforms['netease-local']) {
        const neteaseData = data.platforms['netease-local'];
        library.netease = [
          ...(neteaseData.likedSongs || []),
          ...(neteaseData.playlists || []).flatMap(p => p.tracks || [])
        ];
      }

      // 收集QQ音乐歌曲
      if (data.platforms['qqmusic-local']) {
        const qqData = data.platforms['qqmusic-local'];
        library.qqmusic = [
          ...(qqData.likedSongs || []),
          ...(qqData.playlists || []).flatMap(p => p.tracks || [])
        ];
      }

      // 去重合并
      const seen = new Set();
      library.all = [...library.netease, ...library.qqmusic].filter(song => {
        const key = `${song.name}-${song.artist}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return library;
    } catch (e) {
      console.error('[Recommendation] 读取曲库失败:', e.message);
      return { netease: [], qqmusic: [], all: [] };
    }
  }

  /**
   * 获取对话历史
   */
  getConversationHistory(limit = 50) {
    const historyPath = path.join(this.dataDir, 'conversation-history.json');
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    try {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      return history.slice(-limit);
    } catch (e) {
      return [];
    }
  }

  /**
   * 生成推荐候选池（周期性调用）
   * 这是主要的Token消耗点，但每小时只调用一次
   */
  async generateCandidatePool() {
    const startTime = Date.now();
    console.log('[Recommendation] 开始生成候选池...');

    try {
      // 1. 获取用户曲库
      const library = this.getUserLibrary();
      console.log(`[Recommendation] 曲库统计: 网易云 ${library.netease.length}首, QQ音乐 ${library.qqmusic.length}首, 去重后 ${library.all.length}首`);

      // 2. 获取当前上下文
      const context = await this.gatherContext();

      // 3. 构建Prompt（精简版，用于候选池生成）
      const prompt = this.buildCandidatePoolPrompt(library, context);

      // 4. 调用Claude生成候选池
      const response = await this.callClaudeForCandidates(prompt);

      // 5. 解析候选池
      const candidates = this.parseCandidatePool(response.text);

      // 6. 验证候选歌曲存在于曲库中
      const validatedCandidates = this.validateCandidates(candidates, library);

      // 7. 更新候选池
      this.candidatePool = {
        netease: validatedCandidates.filter(s => s.platform === 'netease'),
        qqmusic: validatedCandidates.filter(s => s.platform === 'qqmusic'),
        mixed: validatedCandidates,
        generatedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, // 1小时后过期
        context: context
      };

      // 8. 保存到缓存
      this.saveCandidatePool();

      // 9. 更新Token统计
      this.tokenStats.dailyTokens += response.tokens || 1500;

      console.log(`[Recommendation] 候选池生成完成: ${validatedCandidates.length}首歌曲, 耗时${Date.now() - startTime}ms`);
      const limitDisplay = this.tokenStats.dailyLimit === Infinity ? '无限制' : this.tokenStats.dailyLimit;
      console.log(`[Recommendation] 今日Token消耗: ${this.tokenStats.dailyTokens}${limitDisplay !== '无限制' ? '/' + limitDisplay : ''}`);

      return this.candidatePool;

    } catch (e) {
      console.error('[Recommendation] 生成候选池失败:', e.message);
      return this.candidatePool;
    }
  }

  /**
   * 构建候选池生成Prompt
   */
  buildCandidatePoolPrompt(library, context) {
    // 采样曲库（避免Prompt过长）
    const sampleSize = 100;
    const shuffled = [...library.all].sort(() => 0.5 - Math.random());
    const sample = shuffled.slice(0, sampleSize);

    const songList = sample.map((s, i) =>
      `${i + 1}. ${s.name} - ${s.artist} (${s.platform})`
    ).join('\n');

    return `基于用户的音乐收藏，生成一个推荐候选池。

## 当前上下文
- 时间: ${new Date().toLocaleString('zh-CN')}
- 时间段: ${context.timeSlot}
- 天气: ${context.weather || '未知'}
- 星期: ${['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]}

## 用户曲库采样 (${sample.length}/${library.all.length}首)
${songList}

## 任务
从曲库中选择15-20首歌曲，组成推荐候选池。选择标准：
1. 适合当前时间段（${context.timeSlot}）的氛围
2. 考虑天气因素（如果有）
3. 歌曲风格多样化，不要集中在一个歌手
4. 优先选择经典和耐听的歌曲
5. 混合不同年代和风格

## 输出格式
返回JSON数组，每首歌包含：
- id: 歌曲ID
- platform: 平台 (netease/qqmusic)
- name: 歌名
- artist: 艺术家
- reason: 推荐理由（简短，10字以内）

示例:
[
  {"id": "169741", "platform": "netease", "name": "等一分钟", "artist": "徐誉滕", "reason": "傍晚怀旧氛围"}
]`;
  }

  /**
   * 候选池生成系统Prompt
   */
  getCandidatePoolSystemPrompt() {
    return `你是音乐推荐专家。基于用户曲库和当前上下文，生成推荐候选池。

规则：
1. 只从提供的曲库中选择歌曲
2. 推荐理由要简洁有力
3. 风格多样化
4. 考虑时间、天气、心情等因素
5. 必须返回有效的JSON数组格式，不要包含其他文本

输出格式示例：
[
  {"id": "12345", "name": "歌曲名", "artist": "艺术家", "reason": "推荐理由"},
  {"id": "67890", "name": "歌曲名", "artist": "艺术家", "reason": "推荐理由"}
]`;
  }

  /**
   * 解析候选池
   */
  /**
   * 调用 Claude 生成候选池（专用方法）
   */
  async callClaudeForCandidates(prompt) {
    const systemPrompt = this.getCandidatePoolSystemPrompt();

    // 构建完整提示
    const fullPrompt = `${systemPrompt}\n\n${prompt}\n\n请记住：只返回JSON数组，不要添加任何其他文本。`;

    // 使用 claudeAdapter 的 chat 方法
    const response = await this.claudeAdapter.chat({
      userMessage: fullPrompt,
      history: []
    });

    return response;
  }

  parseCandidatePool(text) {
    try {
      // 清理文本，移除可能的 markdown 代码块标记
      let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      // 提取JSON数组部分
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }

      // 尝试直接解析整个文本
      const directParsed = JSON.parse(cleaned);
      if (Array.isArray(directParsed)) {
        return directParsed;
      }

      console.error('[Recommendation] 解析候选池失败: 返回的不是数组');
      return [];
    } catch (e) {
      console.error('[Recommendation] 解析候选池失败:', e.message);
      console.error('[Recommendation] 原始文本:', text.substring(0, 200));
      return [];
    }
  }

  /**
   * 验证候选歌曲
   */
  validateCandidates(candidates, library) {
    const validated = [];
    const libraryMap = new Map();

    // 构建曲库Map
    for (const song of library.all) {
      libraryMap.set(`${song.platformId || song.id}`, song);
      libraryMap.set(`${song.name}-${song.artist}`, song);
    }

    for (const candidate of candidates) {
      // 通过ID查找
      let match = libraryMap.get(candidate.id);

      // 通过名称查找
      if (!match) {
        match = libraryMap.get(`${candidate.name}-${candidate.artist}`);
      }

      if (match) {
        validated.push({
          ...match,
          reason: candidate.reason || '推荐歌曲'
        });
      }
    }

    return validated;
  }

  /**
   * 保存候选池
   */
  saveCandidatePool() {
    const cachePath = path.join(this.cacheDir, 'candidate-pool.json');
    fs.writeFileSync(cachePath, JSON.stringify(this.candidatePool, null, 2));
  }

  /**
   * 加载候选池
   */
  loadCandidatePool() {
    const cachePath = path.join(this.cacheDir, 'candidate-pool.json');
    if (fs.existsSync(cachePath)) {
      try {
        this.candidatePool = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch (e) {
        // 忽略错误
      }
    }
  }

  /**
   * 实时获取推荐（基于候选池）
   * 这个方法快速，几乎不消耗Token
   */
  async getRecommendations(context = {}, count = 5) {
    console.log(`[Recommendation] 获取推荐: count=${count}, context=`, context);

    // 1. 检查是否需要实时生成
    if (this.shouldGenerateRealtime(context)) {
      await this.generateCandidatePool();
    }

    // 2. 确保候选池已加载
    if (!this.candidatePool.mixed || this.candidatePool.mixed.length === 0) {
      this.loadCandidatePool();
    }

    // 3. 根据当前上下文筛选和排序
    const candidates = this.filterAndRankCandidates(context);

    // 4. 排除最近播放过的歌曲
    const freshCandidates = this.excludeRecent(candidates, 20);

    // 5. 选择前N首
    const selected = freshCandidates.slice(0, count);

    // 6. 生成DJ话术（可选，消耗少量Token）
    if (context.withIntro && this.tokenStats.dailyTokens < this.tokenStats.dailyLimit) {
      for (const song of selected) {
        song.intro = await this.generateSongIntro(song, context);
      }
    }

    // 7. 更新当前上下文
    this.currentContext = {
      mood: context.mood || this.currentContext.mood,
      weather: context.weather || this.currentContext.weather,
      timeSlot: this.getTimeSlot(Date.now()),
      activity: context.activity || this.currentContext.activity,
      lastUpdated: Date.now()
    };

    // 8. 记录推荐历史
    for (const song of selected) {
      this.recommendationHistory.set(song.id, {
        recommendedAt: Date.now(),
        context: { ...context }
      });
    }

    console.log(`[Recommendation] 返回 ${selected.length} 首推荐歌曲`);
    return selected;
  }

  /**
   * 筛选和排序候选歌曲
   */
  filterAndRankCandidates(context) {
    let candidates = [...this.candidatePool.mixed];

    // 根据平台偏好筛选
    if (context.preferPlatform) {
      candidates = candidates.filter(s => s.platform === context.preferPlatform);
    }

    // 根据心情筛选（简单规则）
    if (context.mood) {
      const moodWeights = this.getMoodWeights(context.mood);
      candidates = candidates.map(song => ({
        ...song,
        moodScore: moodWeights[song.moodTag] || 0.5
      }));
    }

    // 根据时间段加权
    const timeSlotBoost = this.getTimeSlotBoost(this.getTimeSlot(Date.now()));
    candidates = candidates.map(song => ({
      ...song,
      finalScore: (song.moodScore || 0.5) + timeSlotBoost[song.timeTag] || 0
    }));

    // 排序
    candidates.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    return candidates;
  }

  /**
   * 获取心情权重
   */
  getMoodWeights(mood) {
    const weights = {
      happy: { upbeat: 1.0, calm: 0.3, sad: 0.1 },
      sad: { calm: 0.8, sad: 0.7, upbeat: 0.1 },
      relaxed: { calm: 1.0, ambient: 0.8, upbeat: 0.2 },
      energetic: { upbeat: 1.0, rock: 0.8, calm: 0.1 },
      focused: { instrumental: 1.0, calm: 0.7, upbeat: 0.2 },
      romantic: { love: 1.0, calm: 0.6, upbeat: 0.3 }
    };
    return weights[mood] || { balanced: 0.5 };
  }

  /**
   * 获取时间段加成
   */
  getTimeSlotBoost(timeSlot) {
    const boosts = {
      morning: { upbeat: 0.3, energetic: 0.2 },
      noon: { upbeat: 0.2, energetic: 0.1 },
      afternoon: { calm: 0.2, focused: 0.2 },
      evening: { calm: 0.3, romantic: 0.2 },
      night: { ambient: 0.3, calm: 0.3 }
    };
    return boosts[timeSlot] || {};
  }

  /**
   * 排除最近播放的歌曲
   */
  excludeRecent(candidates, count) {
    const recentIds = new Set();
    const entries = [...this.recommendationHistory.entries()]
      .sort((a, b) => b[1].recommendedAt - a[1].recommendedAt)
      .slice(0, count);

    for (const [id] of entries) {
      recentIds.add(id);
    }

    return candidates.filter(s => !recentIds.has(s.id));
  }

  /**
   * 生成歌曲介绍（DJ话术）
   */
  async generateSongIntro(song, context) {
    try {
      const prompt = `为用户推荐歌曲"${song.name} - ${song.artist}"，生成一句简短的开场白。
上下文：${context.mood || '放松'}的心情，${this.getTimeSlot(Date.now())}时段。
要求：20字以内，温暖亲切，像DJ一样。`;

      const response = await this.claudeAdapter.chat({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.8
      });

      this.tokenStats.dailyTokens += response.tokens || 100;

      return response.text.trim().replace(/["']/g, '');
    } catch (e) {
      return `接下来这首 ${song.name}，希望你会喜欢。`;
    }
  }

  /**
   * 获取推荐统计
   */
  getStats() {
    return {
      candidatePoolSize: this.candidatePool.mixed?.length || 0,
      poolGeneratedAt: this.candidatePool.generatedAt,
      poolExpiresAt: this.candidatePool.expiresAt,
      dailyTokens: this.tokenStats.dailyTokens,
      dailyLimit: this.tokenStats.dailyLimit,
      recommendationHistory: this.recommendationHistory.size,
      currentContext: this.currentContext
    };
  }

  /**
   * 收集当前上下文
   */
  async gatherContext() {
    const context = {
      timeSlot: this.getTimeSlot(Date.now()),
      timestamp: Date.now()
    };

    // 获取天气
    try {
      const weather = await this.weatherAPI.getCurrentWeather();
      context.weather = weather.description;
      context.temperature = weather.temperature;
    } catch (e) {
      // 忽略错误
    }

    return context;
  }
}

module.exports = RecommendationEngine;
