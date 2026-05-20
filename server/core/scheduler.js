/**
 * Scheduler.js - 节律调度
 * 07:00规划 · 09:00早间 · 小时情绪检查 · 日历hook
 */

const cron = require('node-cron');
const path = require('path');

class Scheduler {
  constructor(router, state, memoryManager = null, syncManager = null) {
    this.router = router;
    this.state = state;
    this.memoryManager = memoryManager;
    this.syncManager = syncManager;
    this.tasks = [];
  }

  /**
   * 启动调度器
   */
  start() {
    console.log('🕐 启动调度器...');

    // 07:00 - 早间规划
    this.schedule('0 7 * * *', () => this.morningPlanning());

    // 09:00 - 早间推荐
    this.schedule('0 9 * * *', () => this.morningRecommendation());

    // 每小时 - 情绪检查
    this.schedule('0 * * * *', () => this.hourlyMoodCheck());

    // 12:00 - 午间音乐
    this.schedule('0 12 * * *', () => this.noonRecommendation());

    // 18:00 - 晚间音乐
    this.schedule('0 18 * * *', () => this.eveningRecommendation());

    // 22:00 - 夜间音乐
    this.schedule('0 22 * * *', () => this.nightRecommendation());

    // 每30分钟 - 定时摘要生成（基于已有原文日志，不依赖 WebSocket 状态）
    this.schedule('*/30 * * * *', () => this.periodicSummaryFlush());

    // 02:00 - 重建 FTS5 索引（确保当天原文日志被索引）
    this.schedule('0 2 * * *', () => this.dailyReindex());

    // 03:00 - 每日歌单同步，更新 taste.md（路径1：定期更新品味）
    this.schedule('0 3 * * *', () => this.dailyTasteUpdate());

    console.log('✅ 调度器已启动');
  }

  /**
   * 每30分钟：对当前 state 消息生成 Claude 摘要写入日志
   * 原文已由 appendRaw 实时写入，此处只做摘要提炼
   */
  async periodicSummaryFlush() {
    if (!this.memoryManager) return;
    try {
      const lastIdx = await this.memoryManager.getLastFlushedIndex();
      const unflushed = this.state.db.messages.slice(lastIdx);
      if (unflushed.length < 5) return;

      await this.memoryManager.flushSession(unflushed);
      await this.memoryManager.setLastFlushedIndex(this.state.db.messages.length);
      console.log('[Scheduler] 定时摘要完成');
    } catch (e) {
      console.error('[Scheduler] 定时摘要失败:', e.message);
    }
  }

  /**
   * 每日定时同步歌单，重新生成 taste.md（品味路径1：定期更新）
   */
  async dailyTasteUpdate() {
    if (!this.syncManager) return;
    try {
      console.log('[Scheduler] 开始每日品味更新（歌单同步）...');
      await this.syncManager.syncAll();
      console.log('[Scheduler] 品味更新完成，taste.md 已更新');
    } catch (e) {
      console.error('[Scheduler] 品味更新失败:', e.message);
    }
  }

  /**
   * 凌晨重建 FTS5 索引，确保当天原文日志可被搜索
   */
  async dailyReindex() {
    if (!this.memoryManager) return;
    try {
      const today = this.memoryManager.getDailyLogPath(this.memoryManager.getDateStr());
      const fs = require('fs');
      if (fs.existsSync(today)) {
        await this.memoryManager.indexMemoryFile(today);
        console.log('[Scheduler] 当天日志索引完成');
      }
    } catch (e) {
      console.error('[Scheduler] 日志重索引失败:', e.message);
    }
  }

  /**
   * 创建定时任务
   */
  schedule(cronExpression, handler) {
    const task = cron.schedule(cronExpression, async () => {
      try {
        console.log(`[Scheduler] Running task at ${new Date().toLocaleString()}`);
        await handler();
      } catch (error) {
        console.error('[Scheduler] Task error:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    this.tasks.push(task);
  }

  /**
   * 早间规划 - 生成今日播放计划
   */
  async morningPlanning() {
    console.log('[Scheduler] 早间规划');

    const plan = {
      date: new Date().toDateString(),
      morning: { mood: '活力', genres: ['流行', '摇滚', '电子'] },
      noon: { mood: '轻松', genres: ['爵士', '轻音乐'] },
      afternoon: { mood: '专注', genres: ['纯音乐', 'Lo-Fi'] },
      evening: { mood: '放松', genres: ['R&B', '民谣'] },
      night: { mood: '安静', genres: ['古典', '氛围音乐'] }
    };

    this.state.setPlan(plan);

    // 主动推荐
    await this.pushRecommendation({
      type: 'morning_plan',
      message: '早上好！我已经为你规划了今天的音乐安排。早上来些活力满满的歌如何？'
    });
  }

  /**
   * 早间推荐
   */
  async morningRecommendation() {
    console.log('[Scheduler] 早间推荐');

    const recommendation = await this.router.getNextRecommendation({
      mood: '活力',
      activity: '工作',
      timeOfDay: 'morning'
    });

    await this.pushRecommendation({
      type: 'morning',
      message: '早上好！来首活力满满的歌开始新的一天吧！',
      song: recommendation
    });
  }

  /**
   * 小时情绪检查
   */
  async hourlyMoodCheck() {
    const hour = new Date().getHours();

    // 工作时间才检查 (9-18点)
    if (hour < 9 || hour > 18) return;

    console.log('[Scheduler] 情绪检查');

    // 基于播放历史分析当前情绪
    const recentPlays = this.state.getPlayHistory(5);
    const skipRate = this.analyzeSkipRate(recentPlays);

    if (skipRate > 0.6) {
      // 跳过率高，可能当前推荐不符合心情
      await this.pushRecommendation({
        type: 'mood_adjustment',
        message: '感觉你今天心情有些变化，要不要试试不同风格的音乐？'
      });
    }
  }

  /**
   * 午间推荐
   */
  async noonRecommendation() {
    console.log('[Scheduler] 午间推荐');

    const recommendation = await this.router.getNextRecommendation({
      mood: '轻松',
      activity: '休息',
      timeOfDay: 'noon'
    });

    await this.pushRecommendation({
      type: 'noon',
      message: '午休时间到！来首轻松的音乐放松一下。',
      song: recommendation
    });
  }

  /**
   * 晚间推荐
   */
  async eveningRecommendation() {
    console.log('[Scheduler] 晚间推荐');

    const recommendation = await this.router.getNextRecommendation({
      mood: '放松',
      activity: '下班',
      timeOfDay: 'evening'
    });

    await this.pushRecommendation({
      type: 'evening',
      message: '下班啦！辛苦了一天，来首舒缓的音乐放松一下吧。',
      song: recommendation
    });
  }

  /**
   * 夜间推荐
   */
  async nightRecommendation() {
    console.log('[Scheduler] 夜间推荐');

    const recommendation = await this.router.getNextRecommendation({
      mood: '安静',
      activity: '休息',
      timeOfDay: 'night'
    });

    await this.pushRecommendation({
      type: 'night',
      message: '夜深了，一首安静的歌陪伴你入眠。晚安！',
      song: recommendation
    });
  }

  /**
   * 分析跳过率
   */
  analyzeSkipRate(plays) {
    if (plays.length === 0) return 0;

    const skipped = plays.filter(p => p.feedback?.skipped).length;
    return skipped / plays.length;
  }

  /**
   * 推送推荐
   */
  async pushRecommendation(data) {
    // 这里可以通过WebSocket推送给客户端
    console.log('[Scheduler] Push:', data);

    // 记录到计划
    const plan = this.state.getPlan();
    plan.lastRecommendation = {
      ...data,
      timestamp: new Date().toISOString()
    };
    this.state.setPlan(plan);
  }

  /**
   * 获取今日计划
   */
  getTodayPlan() {
    const plan = this.state.getPlan();
    const now = new Date();
    const hour = now.getHours();

    let currentSlot = 'morning';
    if (hour >= 12 && hour < 14) currentSlot = 'noon';
    else if (hour >= 14 && hour < 18) currentSlot = 'afternoon';
    else if (hour >= 18 && hour < 22) currentSlot = 'evening';
    else if (hour >= 22 || hour < 5) currentSlot = 'night';

    return {
      ...plan,
      currentSlot,
      currentTime: now.toLocaleString('zh-CN'),
      nextEvent: this.getNextEvent(hour)
    };
  }

  /**
   * 获取下一个事件
   */
  getNextEvent(currentHour) {
    const events = [
      { hour: 7, name: '早间规划' },
      { hour: 9, name: '早间推荐' },
      { hour: 12, name: '午间音乐' },
      { hour: 18, name: '晚间音乐' },
      { hour: 22, name: '夜间音乐' }
    ];

    for (const event of events) {
      if (event.hour > currentHour) {
        return event;
      }
    }

    return events[0]; // 明天的第一个事件
  }

  /**
   * 停止调度器
   */
  stop() {
    this.tasks.forEach(task => task.stop());
    console.log('🛑 调度器已停止');
  }
}

module.exports = Scheduler;
