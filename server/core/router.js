/**
 * Router.js - 意图分流层
 * 简单指令直连 · 音乐走ncm · 自然语言走claude
 */

class Router {
  constructor(state, musicAPI, claudeAdapter, contextBuilder, weatherAPI, recommendationEngine) {
    this.state = state;
    this.musicAPI = musicAPI;
    this.claudeAdapter = claudeAdapter;
    this.contextBuilder = contextBuilder;
    this.weatherAPI = weatherAPI;
    this.recommendationEngine = recommendationEngine;
  }

  /**
   * 处理聊天消息 - 意图识别与分流
   */
  async handleChat(message, context = {}) {
    const intent = this.parseIntent(message);

    switch (intent.type) {
      case 'direct_command':
        return this.handleDirectCommand(intent, context);

      case 'music_search':
        return this.handleMusicSearch(intent, context);

      case 'natural_language':
      default:
        return this.handleNaturalLanguage(message, context);
    }
  }

  /**
   * 流式聊天处理
   */
  async handleStreamingChat(message, context, onChunk) {
    const fullContext = await this.contextBuilder.build(message, context);

    await this.claudeAdapter.streamChat(fullContext, (chunk) => {
      onChunk(chunk);
    });
  }

  /**
   * 意图解析
   */
  parseIntent(message) {
    const lowerMsg = message.toLowerCase().trim();

    // 直接指令模式
    const directCommands = [
      { pattern: /^(播放|pause|stop|跳过|下一首|上一首|暂停|停止)/, type: 'direct_command' },
      { pattern: /^(音量|volume)\s*(\+|\-|大|小|up|down)/, type: 'direct_command' },
    ];

    for (const cmd of directCommands) {
      if (cmd.pattern.test(lowerMsg)) {
        return {
          type: 'direct_command',
          action: lowerMsg,
          raw: message
        };
      }
    }

    // 音乐搜索模式
    const musicPatterns = [
      /^(搜索|search|找|来首|我想听|播放).*(歌|音乐|song)/,
      /^(放|play)\s*《.*》/,
      /^(点歌|切歌)/,
    ];

    for (const pattern of musicPatterns) {
      if (pattern.test(lowerMsg)) {
        return {
          type: 'music_search',
          query: message.replace(/^(搜索|search|找|来首|我想听|播放|放|点歌)/, '').trim(),
          raw: message
        };
      }
    }

    // 自然语言模式（默认）
    return {
      type: 'natural_language',
      raw: message
    };
  }

  /**
   * 处理直接指令
   */
  async handleDirectCommand(intent, context) {
    const action = intent.action;

    if (/^(播放|play)/.test(action)) {
      return {
        type: 'command',
        action: 'play',
        message: '继续播放'
      };
    }

    if (/^(暂停|pause|停止|stop)/.test(action)) {
      return {
        type: 'command',
        action: 'pause',
        message: '已暂停'
      };
    }

    if (/^(跳过|下一首|next)/.test(action)) {
      const nextSong = await this.getNextRecommendation(context);
      return {
        type: 'recommendation',
        action: 'skip',
        song: nextSong,
        message: `为你播放下一首：${nextSong.name} - ${nextSong.artist}`
      };
    }

    return {
      type: 'command',
      action: 'unknown',
      message: '收到指令'
    };
  }

  /**
   * 处理音乐搜索
   */
  async handleMusicSearch(intent, context) {
    const results = await this.musicAPI.search(intent.query, 5);

    if (results.length === 0) {
      return {
        type: 'search_result',
        found: false,
        message: `没有找到与"${intent.query}"相关的歌曲`
      };
    }

    // 记录搜索到用户品味
    await this.state.recordSearch(intent.query, results);

    return {
      type: 'search_result',
      found: true,
      query: intent.query,
      songs: results,
      message: `找到 ${results.length} 首相关歌曲`
    };
  }

  /**
   * 处理自然语言 - 走Claude大脑
   */
  async handleNaturalLanguage(message, context) {
    const fullContext = await this.contextBuilder.build(message, context);

    const response = await this.claudeAdapter.chat(fullContext);

    // 解析AI响应中的推荐
    const recommendation = this.extractRecommendation(response);

    if (recommendation) {
      // 获取歌曲详情
      const songDetails = await this.musicAPI.search(recommendation.songQuery, 1);
      if (songDetails.length > 0) {
        return {
          type: 'ai_recommendation',
          message: response.text,
          reasoning: response.reasoning,
          song: songDetails[0],
          shouldPlay: recommendation.shouldPlay
        };
      }
    }

    return {
      type: 'ai_chat',
      message: response.text,
      reasoning: response.reasoning
    };
  }

  /**
   * 获取下一首推荐（使用智能推荐引擎）
   */
  async getNextRecommendation(context = {}) {
    // 使用推荐引擎获取推荐
    if (this.recommendationEngine) {
      const recommendations = await this.recommendationEngine.getRecommendations(context, 1);
      if (recommendations.length > 0) {
        const song = recommendations[0];
        return {
          ...song,
          reason: song.reason || '为你推荐',
          intro: song.intro || null
        };
      }
    }

    // 回退到旧逻辑
    return this.getNextRecommendationLegacy(context);
  }

  /**
   * 旧的推荐逻辑（回退用）
   */
  async getNextRecommendationLegacy(context = {}) {
    const taste = this.state.getUserTaste();
    const history = this.state.getPlayHistory(20);
    const currentMood = context.mood || this.state.getCurrentMood();

    let weather = context.weather;
    if (!weather && this.weatherAPI) {
      try {
        const weatherData = await this.weatherAPI.getCurrentWeather();
        weather = weatherData.description;
      } catch (e) {
        console.log('[Router] Failed to get weather:', e.message);
      }
    }

    const recommendContext = await this.contextBuilder.buildRecommendationContext({
      taste,
      history,
      currentMood,
      weather,
      activity: context.activity,
      time: new Date()
    });

    const recommendation = await this.claudeAdapter.getRecommendation(recommendContext);

    const searchQuery = `${recommendation.song} ${recommendation.artist || ''}`;
    const songs = await this.musicAPI.search(searchQuery.trim(), 3);

    if (songs.length > 0) {
      return {
        ...songs[0],
        reason: recommendation.reason,
        context: recommendation.context
      };
    }

    return this.getRandomFromPlaylist();
  }

  /**
   * 获取多首推荐歌曲（使用智能推荐引擎）
   */
  async getMultipleRecommendations(count = 5, context = {}) {
    // 使用推荐引擎获取批量推荐
    if (this.recommendationEngine) {
      try {
        const recommendations = await this.recommendationEngine.getRecommendations(context, count);
        return recommendations;
      } catch (e) {
        console.error('[Router] Recommendation engine error:', e.message);
        // 回退到旧逻辑
      }
    }

    // 旧逻辑（回退）
    const recommendations = [];
    const usedQueries = new Set();

    for (let i = 0; i < count; i++) {
      try {
        const rec = await this.getNextRecommendationLegacy(context);
        if (rec) {
          const query = `${rec.name}-${rec.artist}`;
          if (!usedQueries.has(query)) {
            usedQueries.add(query);
            recommendations.push(rec);
          }
        }
      } catch (e) {
        console.error('[Router] Recommendation error:', e.message);
      }
    }

    return recommendations;
  }

  /**
   * 处理跳过请求
   */
  async handleSkip(context) {
    // 记录跳过原因
    this.state.recordSkip(this.state.getNowPlaying()?.id, context);
    return this.getNextRecommendation(context);
  }

  /**
   * 从AI响应中提取推荐
   */
  extractRecommendation(response) {
    // 解析格式: [PLAY: 歌曲名 - 艺术家] 或 [RECOMMEND: ...]
    const playMatch = response.text.match(/\[PLAY:\s*(.+?)\]/i);
    if (playMatch) {
      return {
        songQuery: playMatch[1],
        shouldPlay: true
      };
    }

    const recMatch = response.text.match(/\[RECOMMEND:\s*(.+?)\]/i);
    if (recMatch) {
      return {
        songQuery: recMatch[1],
        shouldPlay: false
      };
    }

    return null;
  }

  /**
   * 从用户歌单随机获取
   */
  getRandomFromPlaylist() {
    const playlist = this.state.getPlaylist();
    if (playlist.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * playlist.length);
    return playlist[randomIndex];
  }
}

module.exports = Router;
