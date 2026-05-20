/**
 * Aaron Music Agent - 主服务器入口
 * 个人AI音乐电台 - 像DJ一样播报
 */

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const Router = require('./core/router');
const StateManager = require('./core/state');
const Scheduler = require('./core/scheduler');
const MusicAPI = require('./services/music-api');
const WeatherAPI = require('./services/weather-api');
const TTSService = require('./services/tts-service');
const PlaybackService = require('./services/playback-service');
const SyncManager = require('../sync/sync-manager');
const RecommendationEngine = require('./core/recommendation-engine');
const ClaudeAdapter = require('./core/claude-adapter');
const ContextBuilder = require('./core/context-builder');
const MemoryManager = require('./core/memory-manager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 全局状态
const state = new StateManager();
const musicAPI = new MusicAPI();
const weatherAPI = new WeatherAPI();
const ttsService = new TTSService();
const playbackService = new PlaybackService();
const syncManager = new SyncManager();
const claudeAdapter = new ClaudeAdapter();
const memoryManager = new MemoryManager(path.join(__dirname, '../user'), claudeAdapter);
const contextBuilder = new ContextBuilder(state, memoryManager);
const recommendationEngine = new RecommendationEngine(claudeAdapter, contextBuilder, weatherAPI);
const router = new Router(state, musicAPI, claudeAdapter, contextBuilder, weatherAPI, recommendationEngine);

// 注入记忆管理器
state.setMemoryManager(memoryManager);

// 异步初始化记忆系统
memoryManager.initDB().then(() => {
  console.log('🧠 记忆系统已初始化');
}).catch(e => {
  console.error('⚠️  记忆系统初始化失败（降级运行）:', e.message);
});

// 调度器
const scheduler = new Scheduler(router, state, memoryManager, syncManager);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// TTS 缓存文件服务
app.use('/cache/tts', express.static(path.join(__dirname, '../cache/tts')));

// ===== API路由 =====

// 聊天接口 - 主交互入口
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    const userId = req.headers['x-user-id'] || 'default';

    const result = await router.handleChat(message, {
      userId,
      ...context
    });

    res.json(result);
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取当前播放状态
app.get('/api/now', (req, res) => {
  res.json(state.getNowPlaying());
});

// 获取下一首推荐（智能推荐）
app.get('/api/next', async (req, res) => {
  try {
    const { mood, weather, activity, platform } = req.query;
    const nextSong = await router.getNextRecommendation({
      mood,
      weather,
      activity,
      preferPlatform: platform
    });
    res.json(nextSong);
  } catch (error) {
    console.error('Next API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取智能推荐（批量）
app.post('/api/recommendations/smart', async (req, res) => {
  try {
    const { count = 5, mood, weather, activity, platform, withIntro = false } = req.body;

    const recommendations = await recommendationEngine.getRecommendations({
      mood,
      weather,
      activity,
      preferPlatform: platform,
      withIntro,
      userRequested: true  // 用户主动请求，确保实时生成
    }, count);

    res.json({
      success: true,
      count: recommendations.length,
      recommendations,
      context: {
        mood,
        weather,
        activity,
        timeSlot: recommendationEngine.getTimeSlot(Date.now())
      },
      stats: recommendationEngine.getStats()
    });
  } catch (error) {
    console.error('Smart recommendations API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取推荐统计
app.get('/api/recommendations/stats', (req, res) => {
  try {
    const stats = recommendationEngine.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Recommendation stats API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 刷新推荐候选池（手动触发）
app.post('/api/recommendations/refresh', async (req, res) => {
  try {
    await recommendationEngine.generateCandidatePool();
    const stats = recommendationEngine.getStats();
    res.json({
      success: true,
      message: '候选池已刷新',
      stats
    });
  } catch (error) {
    console.error('Refresh recommendations API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取多首推荐歌曲（批量推荐）
app.get('/api/recommendations', async (req, res) => {
  try {
    const { count = 5, mood, weather, activity } = req.query;
    const context = { mood, weather, activity };
    const recommendations = await router.getMultipleRecommendations(
      parseInt(count),
      context
    );
    res.json({
      count: recommendations.length,
      songs: recommendations
    });
  } catch (error) {
    console.error('Recommendations API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取用户品味档案
app.get('/api/taste', (req, res) => {
  res.json(state.getUserTaste());
});

// 更新用户品味
app.post('/api/taste', (req, res) => {
  const updates = req.body;
  state.updateUserTaste(updates);
  res.json({ success: true, taste: state.getUserTaste() });
});

// 获取今日播放计划
app.get('/api/plan/today', (req, res) => {
  res.json(scheduler.getTodayPlan());
});

// 搜索歌曲
app.get('/api/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    const results = await musicAPI.search(q, parseInt(limit));
    res.json(results);
  } catch (error) {
    console.error('Search API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取歌曲URL（兼容旧接口 - 默认网易云）
app.get('/api/song/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { platform = 'netease' } = req.query;

    const playInfo = await playbackService.getPlayUrl(platform, id, { br: 320000 });
    res.json({
      id,
      platform,
      url: playInfo.url,
      bitrate: playInfo.bitrate,
      type: playInfo.type,
      expireAt: playInfo.expireAt
    });
  } catch (error) {
    console.error('Song URL API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 播放接口 - 支持多平台
app.post('/api/play', async (req, res) => {
  try {
    const { platform, songId, bitrate = 320000 } = req.body;

    if (!platform || !songId) {
      return res.status(400).json({ error: 'Missing platform or songId' });
    }

    const playInfo = await playbackService.getPlayUrl(platform, songId, { br: bitrate });

    res.json({
      success: true,
      platform,
      songId,
      playUrl: playInfo.url,
      bitrate: playInfo.bitrate,
      type: playInfo.type,
      expireAt: playInfo.expireAt,
      note: playInfo.note || null
    });
  } catch (error) {
    console.error('Play API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取特定平台的歌单（用于播放）
app.get('/api/playlists/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    const songs = syncManager.getPlatformSongs(platform);

    res.json({
      platform,
      count: songs.length,
      songs
    });
  } catch (error) {
    console.error('Get platform songs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 播放历史
app.get('/api/history', (req, res) => {
  const { limit = 50 } = req.query;
  res.json(state.getPlayHistory(parseInt(limit)));
});

// 记录播放反馈
app.post('/api/feedback', (req, res) => {
  const { songId, feedback, context } = req.body;
  state.recordFeedback(songId, feedback, context);
  res.json({ success: true });
});

// 获取歌词
app.get('/api/lyric/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const lyric = await musicAPI.getLyric(id);
    res.json({ id, lyric });
  } catch (error) {
    console.error('Lyric API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取天气
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon, city } = req.query;
    let weather;

    if (city) {
      weather = await weatherAPI.getWeatherByCity(city);
    } else {
      weather = await weatherAPI.getCurrentWeather(
        lat ? parseFloat(lat) : undefined,
        lon ? parseFloat(lon) : undefined
      );
    }

    res.json(weather);
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// TTS 文字转语音
app.post('/api/tts', async (req, res) => {
  try {
    const { text, options = {} } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await ttsService.synthesize(text, options);
    res.json(result);
  } catch (error) {
    console.error('TTS API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// TTS 生成歌曲介绍
app.post('/api/tts/intro', async (req, res) => {
  try {
    const { song, context = {} } = req.body;

    if (!song) {
      return res.status(400).json({ error: 'Song info is required' });
    }

    const result = await ttsService.generateSongIntro(song, context);
    res.json(result);
  } catch (error) {
    console.error('TTS intro API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Agent 个人资料（自动生成标签）
app.get('/api/agent/profile', (req, res) => {
  try {
    const profile = state.getAgentProfile();
    res.json(profile);
  } catch (error) {
    console.error('Agent profile API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取/设置 Agent 名字
app.get('/api/agent/name', (req, res) => {
  res.json({ name: state.getAgentName() });
});

app.post('/api/agent/name', (req, res) => {
  const { name } = req.body;
  if (state.setAgentName(name)) {
    res.json({ success: true, name: state.getAgentName() });
  } else {
    res.status(400).json({ error: 'Invalid name' });
  }
});

// ===== 记忆系统 API =====

app.get('/api/memory/search', async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q) return res.status(400).json({ error: '缺少 q 参数' });
    const results = await memoryManager.search(q, parseInt(limit));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/memory/flush', async (req, res) => {
  try {
    const lastIdx = await memoryManager.getLastFlushedIndex();
    const unflushed = state.db.messages.slice(lastIdx);
    if (unflushed.length < 2) {
      return res.json({ success: false, message: '消息太少，无需 flush' });
    }
    const summary = await memoryManager.flushSession(unflushed, true);
    await memoryManager.setLastFlushedIndex(state.db.messages.length);
    res.json({ success: true, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/memory/hot', async (req, res) => {
  try {
    const hot = await memoryManager.loadHotMemory();
    res.json(hot);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/memory/reindex', async (req, res) => {
  try {
    await memoryManager.reindexAll();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== WebSocket 实时流 =====

wss.on('connection', (ws, req) => {
  console.log('Client connected to WebSocket');

  // 发送当前状态
  ws.send(JSON.stringify({
    type: 'state',
    data: state.getNowPlaying()
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'chat':
          // 流式聊天响应
          await router.handleStreamingChat(data.message, data.context, (chunk) => {
            ws.send(JSON.stringify({
              type: 'chat_stream',
              data: chunk
            }));
          });
          break;

        case 'play':
          state.updateNowPlaying(data.song);
          // 广播给所有客户端
          broadcast({ type: 'now_playing', data: data.song });
          break;

        case 'skip':
          const nextSong = await router.handleSkip(data.context);
          ws.send(JSON.stringify({ type: 'recommendation', data: nextSong }));
          break;

        case 'feedback':
          state.recordFeedback(data.songId, data.feedback, data.context);
          break;

        case 'request_recommendation':
          const recommendation = await router.getNextRecommendation(data.context);
          ws.send(JSON.stringify({ type: 'recommendation', data: recommendation }));
          break;
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // 原文已由 appendRaw 实时写入当日日志，摘要由定时任务（每30分钟）异步生成
  });
});

function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// 启动调度器
scheduler.start();

// 错误处理
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`
🎵 Aaron Music Agent 已启动
========================
本地访问: http://localhost:${PORT}

API文档:
  对话 & 推荐
    POST /api/chat              - 与AI对话
    GET  /api/next              - 获取推荐
    GET  /api/recommendations   - 批量推荐

  播放控制（支持多平台）
    POST /api/play              - 播放歌曲 {platform, songId}
    GET  /api/song/:id          - 获取歌曲URL
    GET  /api/playlists/:platform - 获取平台歌单 (netease-local, qqmusic-local)

  用户数据
    GET  /api/taste             - 用户品味
    GET  /api/now               - 当前播放
    GET  /api/history           - 播放历史

  其他
    GET  /api/weather           - 获取天气
    GET  /api/plan/today        - 今日计划
    WS   /stream                - 实时流
========================
  `);
});

module.exports = { app, server, wss };
