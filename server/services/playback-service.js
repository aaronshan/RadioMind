/**
 * 统一播放服务
 * 支持多平台：网易云、QQ音乐
 * 按需获取播放链接，支持本地/远程混合
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class PlaybackService {
  constructor() {
    // 使用配置的API地址，优先本地，可配置外部
    this.neteaseBaseURL = process.env.NETEASE_API_BASE
      || `http://${process.env.NETEASE_API_HOST || '127.0.0.1'}:${process.env.NETEASE_API_PORT || 3000}`;

    this.neteaseClient = axios.create({
      baseURL: this.neteaseBaseURL,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // QQ音乐API（需要配置）
    this.qqmusicCookie = process.env.QQMUSIC_COOKIE || '';
    this.qqmusicUin = process.env.QQMUSIC_UIN || '';

    console.log(`[PlaybackService] 使用API: ${this.neteaseBaseURL}`);
  }

  /**
   * 获取歌曲播放链接（通用入口）
   * @param {string} platform - 平台: 'netease' | 'qqmusic'
   * @param {string|number} songId - 歌曲ID
   * @param {object} options - 选项
   * @returns {Promise<{url: string, platform: string, expireAt?: number}>}
   */
  async getPlayUrl(platform, songId, options = {}) {
    switch (platform) {
      case 'netease':
      case 'netease-local':
        return this.getNeteasePlayUrl(songId, options);

      case 'qqmusic':
      case 'qqmusic-local':
        return this.getQQMusicPlayUrl(songId, options);

      default:
        throw new Error(`不支持的平台: ${platform}`);
    }
  }

  /**
   * 获取网易云播放链接
   * 使用配置的API（本地或自定义外部地址）
   */
  async getNeteasePlayUrl(songId, options = {}) {
    const { br = 320000 } = options;

    try {
      const response = await this.neteaseClient.get('/song/url', {
        params: { id: songId, br }
      });

      const songData = response.data?.data?.[0];

      if (!songData || !songData.url) {
        throw new Error('未获取到播放链接');
      }

      // 检查是否VIP歌曲
      if (songData.code === -110 || songData.freeTrialInfo) {
        console.log(`[Playback] 网易云歌曲 ${songId} 可能是VIP歌曲，尝试获取试听版本`);
        // 尝试降低音质
        if (br > 128000) {
          return this.getNeteasePlayUrl(songId, { br: 128000 });
        }
      }

      return {
        url: songData.url,
        platform: 'netease',
        bitrate: songData.br || br,
        size: songData.size,
        md5: songData.md5,
        type: songData.type || 'mp3',
        // 网易链接通常有效期较长（约7天）
        expireAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      };

    } catch (error) {
      console.error('[Playback] 网易云播放链接获取失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取QQ音乐播放链接
   * 方案1: 使用本地文件（如果有下载）
   * 方案2: 使用第三方API
   * 方案3: 引导用户手动获取（备用）
   */
  async getQQMusicPlayUrl(songId, options = {}) {
    const { useLocal = true } = options;

    // 方案1: 尝试使用本地文件
    if (useLocal) {
      const localPath = this.findQQMusicLocalFile(songId);
      if (localPath) {
        // 注意: .mgg格式需要解密，这里返回提示
        if (localPath.endsWith('.mgg') || localPath.endsWith('.mggl')) {
          console.log(`[Playback] QQ音乐本地文件是加密格式: ${localPath}`);
          // 可以尝试转换为可播放格式，或提示用户
        } else if (localPath.endsWith('.flac') || localPath.endsWith('.mp3')) {
          // 已下载的未加密文件可以直接播放
          return {
            url: `file://${localPath}`,
            platform: 'qqmusic',
            local: true,
            path: localPath
          };
        }
      }
    }

    // 方案2: 使用第三方API（如果有配置）
    if (this.qqmusicCookie) {
      try {
        return await this.getQQMusicUrlViaAPI(songId);
      } catch (e) {
        console.log('[Playback] QQ音乐API获取失败，使用备用方案');
      }
    }

    // 方案3: 搜索网易云同名歌曲
    console.log('[Playback] 尝试在网易云搜索同名歌曲...');
    const fallbackUrl = await this.searchAndPlayFromNetease(songId);
    if (fallbackUrl) {
      return fallbackUrl;
    }

    throw new Error('QQ音乐播放链接获取失败，请尝试下载歌曲到本地或使用网易云版本');
  }

  /**
   * 查找QQ音乐本地文件
   */
  findQQMusicLocalFile(songId) {
    const possiblePaths = [
      path.join(process.env.HOME, 'Music/QQMusic'),
      path.join(process.env.HOME, 'Music/iMusic'),
    ];

    for (const basePath of possiblePaths) {
      if (!fs.existsSync(basePath)) continue;

      // 搜索文件
      try {
        const files = this.findFilesRecursive(basePath, songId);
        if (files.length > 0) {
          // 优先返回非加密格式
          const unencrypted = files.find(f =>
            f.endsWith('.flac') || f.endsWith('.mp3') || f.endsWith('.m4a')
          );
          return unencrypted || files[0];
        }
      } catch (e) {
        // 忽略错误
      }
    }

    return null;
  }

  /**
   * 递归查找文件
   */
  findFilesRecursive(dir, songId) {
    const results = [];

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          results.push(...this.findFilesRecursive(fullPath, songId));
        } else if (file.includes(songId)) {
          results.push(fullPath);
        }
      }
    } catch (e) {
      // 忽略权限错误
    }

    return results;
  }

  /**
   * 通过第三方API获取QQ音乐链接
   * 需要配置Cookie
   */
  async getQQMusicUrlViaAPI(songId) {
    // 这里可以使用第三方服务
    // 例如: https://api.qqmusic.com/... (需要替换为实际可用的API)

    // 示例实现（需要配置真实的API）
    const apiUrl = process.env.QQMUSIC_API_URL;
    if (!apiUrl) {
      throw new Error('未配置QQ音乐API');
    }

    const response = await axios.get(apiUrl, {
      params: { id: songId, type: 'song' },
      headers: {
        'Cookie': this.qqmusicCookie
      },
      timeout: 10000
    });

    if (response.data?.url) {
      return {
        url: response.data.url,
        platform: 'qqmusic',
        expireAt: Date.now() + 2 * 60 * 60 * 1000 // QQ链接通常2小时过期
      };
    }

    throw new Error('API未返回有效链接');
  }

  /**
   * 搜索网易云同名歌曲（备用方案）
   */
  async searchAndPlayFromNetease(qqSongId) {
    try {
      // 从本地数据库获取歌曲信息
      const songInfo = await this.getQQMusicSongInfo(qqSongId);
      if (!songInfo) return null;

      // 搜索网易云
      const searchRes = await this.neteaseClient.get('/search', {
        params: {
          keywords: `${songInfo.name} ${songInfo.artist}`,
          limit: 3,
          type: 1
        }
      });

      const songs = searchRes.data?.result?.songs;
      if (!songs || songs.length === 0) return null;

      // 取第一个结果获取播放链接
      const neteaseSong = songs[0];
      const playUrl = await this.getNeteasePlayUrl(neteaseSong.id, { br: 128000 });

      return {
        ...playUrl,
        platform: 'netease-fallback',
        originalPlatform: 'qqmusic',
        originalId: qqSongId,
        note: `原QQ音乐歌曲，已切换至网易云版本: ${neteaseSong.name}`
      };

    } catch (e) {
      return null;
    }
  }

  /**
   * 从本地数据库获取QQ音乐歌曲信息
   */
  async getQQMusicSongInfo(songId) {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(
      process.env.HOME,
      'Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/qqmusic.sqlite'
    );

    return new Promise((resolve, reject) => {
      if (!fs.existsSync(dbPath)) {
        resolve(null);
        return;
      }

      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
      db.get('SELECT name, singer FROM SONGS WHERE id = ?', [songId], (err, row) => {
        db.close();
        if (err || !row) {
          resolve(null);
        } else {
          resolve({ name: row.name, artist: row.singer });
        }
      });
    });
  }

  /**
   * 批量获取播放链接
   */
  async getBatchPlayUrls(songs) {
    const results = [];

    for (const song of songs) {
      try {
        const playInfo = await this.getPlayUrl(song.platform, song.id, { br: 128000 });
        results.push({
          ...song,
          playUrl: playInfo.url,
          playInfo
        });
      } catch (e) {
        results.push({
          ...song,
          playUrl: null,
          error: e.message
        });
      }
    }

    return results;
  }

  /**
   * 检查播放链接是否有效
   */
  async checkUrlValid(url) {
    try {
      const response = await axios.head(url, { timeout: 5000 });
      return response.status === 200;
    } catch (e) {
      return false;
    }
  }
}

module.exports = PlaybackService;
