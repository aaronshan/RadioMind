/**
 * TTS Service - 文字转语音服务
 * 用于语音播报歌曲介绍
 * 支持多种 TTS 提供商：Fish Audio / 浏览器 TTS
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class TTSService {
  constructor() {
    this.enabled = process.env.TTS_ENABLED === 'true';
    this.provider = process.env.TTS_PROVIDER || 'browser'; // 'fish', 'browser', 'none'
    this.fishApiKey = process.env.FISH_API_KEY;
    this.cacheDir = path.join(__dirname, '../../cache/tts');

    this.ensureCacheDir();
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 检查 TTS 是否可用
   */
  isAvailable() {
    if (!this.enabled) return false;

    if (this.provider === 'fish') {
      return !!this.fishApiKey;
    }

    return true;
  }

  /**
   * 生成语音
   * @param {string} text - 要转换的文字
   * @param {Object} options - 选项
   * @returns {Promise<Object>} - 语音数据或URL
   */
  async synthesize(text, options = {}) {
    if (!this.isAvailable()) {
      return { available: false, reason: 'TTS not enabled' };
    }

    switch (this.provider) {
      case 'fish':
        return this.synthesizeWithFish(text, options);
      case 'browser':
        return this.synthesizeWithBrowser(text, options);
      default:
        return { available: false, reason: 'Unknown TTS provider' };
    }
  }

  /**
   * 使用 Fish Audio TTS
   * 参考: https://fish.audio/
   */
  async synthesizeWithFish(text, options = {}) {
    if (!this.fishApiKey) {
      return { available: false, reason: 'Fish API key not configured' };
    }

    try {
      // 生成缓存文件名
      const hash = this.hashText(text);
      const cachePath = path.join(this.cacheDir, `${hash}.mp3`);

      // 检查缓存
      if (fs.existsSync(cachePath)) {
        console.log('[TTS] Using cached audio:', cachePath);
        return {
          available: true,
          url: `/cache/tts/${hash}.mp3`,
          cached: true
        };
      }

      // 调用 Fish Audio API
      const audioBuffer = await this.callFishAPI(text, options);

      // 保存到缓存
      fs.writeFileSync(cachePath, audioBuffer);

      return {
        available: true,
        url: `/cache/tts/${hash}.mp3`,
        cached: false
      };

    } catch (error) {
      console.error('[TTS] Fish synthesis error:', error.message);
      return { available: false, reason: error.message };
    }
  }

  /**
   * 调用 Fish Audio API
   */
  callFishAPI(text, options) {
    return new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({
        text,
        reference_id: options.voiceId || 'default',
        format: 'mp3'
      });

      const requestOptions = {
        hostname: 'api.fish.audio',
        port: 443,
        path: '/v1/tts',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.fishApiKey}`
        },
        timeout: 30000
      };

      const req = https.request(requestOptions, (res) => {
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('TTS API timeout'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 浏览器 TTS（返回文本，由前端使用 Web Speech API）
   */
  synthesizeWithBrowser(text, options = {}) {
    return {
      available: true,
      provider: 'browser',
      text: text,
      // 建议的语音参数
      voice: {
        lang: 'zh-CN',
        rate: options.rate || 1.0,
        pitch: options.pitch || 1.0,
        volume: options.volume || 1.0
      }
    };
  }

  /**
   * 生成歌曲介绍的 TTS
   */
  async generateSongIntro(song, context = {}) {
    const introText = this.buildIntroText(song, context);
    return this.synthesize(introText, { rate: 0.9 });
  }

  /**
   * 构建歌曲介绍文本
   */
  buildIntroText(song, context = {}) {
    const parts = [];

    // 开场白
    if (context.segue) {
      parts.push(context.segue);
    } else {
      const segues = [
        '接下来这首歌',
        '下面为你播放',
        '来听这首'
      ];
      parts.push(segues[Math.floor(Math.random() * segues.length)]);
    }

    // 歌曲信息
    parts.push(`${song.name}`);

    if (song.artist) {
      parts.push(`由 ${song.artist} 演唱`);
    }

    // 推荐理由
    if (context.reason) {
      parts.push(context.reason);
    }

    return parts.join('，') + '。';
  }

  /**
   * 清理过期缓存
   */
  cleanCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
    // 默认清理7天前的缓存
    const files = fs.readdirSync(this.cacheDir);
    const now = Date.now();

    files.forEach(file => {
      const filePath = path.join(this.cacheDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        console.log('[TTS] Cleaned cache:', file);
      }
    });
  }

  /**
   * 文本哈希（用于缓存文件名）
   */
  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

module.exports = TTSService;
