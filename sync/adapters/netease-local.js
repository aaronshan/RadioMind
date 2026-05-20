/**
 * 网易云音乐本地数据库适配器 (macOS)
 * 读取本地客户端SQLite数据库获取歌单数据
 */

const fs = require('fs');
const path = require('path');

class NeteaseLocalAdapter {
  constructor() {
    this.name = '网易云音乐(本地)';
    this.platform = 'netease-local';
  }

  /**
   * 检测是否可用（macOS + 已安装网易云音乐 + 有数据）
   */
  isAvailable() {
    if (process.platform !== 'darwin') {
      return { available: false, reason: '仅支持macOS' };
    }

    const dbPath = this.getDatabasePath();
    if (!fs.existsSync(dbPath)) {
      return { available: false, reason: '未找到网易云音乐本地数据库，请先登录并同步歌单' };
    }

    return { available: true, dbPath };
  }

  /**
   * 获取数据库路径
   */
  getDatabasePath() {
    const home = process.env.HOME;
    return path.join(
      home,
      'Library/Containers/com.netease.163music/Data/Documents/storage/sqlite_storage.sqlite3'
    );
  }

  /**
   * 获取用户ID
   */
  getUserId() {
    try {
      const plistPath = path.join(
        process.env.HOME,
        'Library/Preferences/com.netease.163music.plist'
      );
      if (!fs.existsSync(plistPath)) return null;

      // 使用plutil解析plist
      const { execSync } = require('child_process');
      const output = execSync(`plutil -extract MAMUserIDCache xml1 -o - "${plistPath}"`, { encoding: 'utf8' });

      // 解析XML提取用户ID
      const match = output.match(/<string>(\d+)<\/string>/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取用户歌单ID列表
   */
  async getPlaylistIds(db) {
    return new Promise((resolve, reject) => {
      db.get('SELECT pids FROM web_user_playlist LIMIT 1', (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (!row || !row.pids) {
          resolve([]);
          return;
        }
        // pids格式: "uid,playlistId1,playlistId2,..."
        const ids = row.pids.split(',').filter(id => id && !id.includes('"'));
        resolve(ids);
      });
    });
  }

  /**
   * 获取歌单详情
   */
  async getPlaylistDetails(db, playlistId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT playlist FROM web_playlist WHERE pid = ?', [playlistId], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (!row || !row.playlist) {
          resolve(null);
          return;
        }
        try {
          const data = JSON.parse(row.playlist);
          resolve({
            id: data.id,
            name: data.name,
            cover: data.coverImgUrl,
            trackCount: data.trackCount,
            description: data.description,
            tags: data.tags || [],
            createTime: data.createTime,
            updateTime: data.updateTime
          });
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  /**
   * 获取歌单中的歌曲
   */
  async getPlaylistTracks(db, playlistId) {
    return new Promise((resolve, reject) => {
      // web_playlist_track 表: pid, tid, version, order
      // 先获取所有歌曲ID (tid)
      db.all('SELECT tid FROM web_playlist_track WHERE pid = ? ORDER BY "order"', [playlistId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        if (rows.length === 0) {
          resolve([]);
          return;
        }

        // 获取所有歌曲ID
        const trackIds = rows.map(r => r.tid);

        // 查询web_track表获取歌曲详情（优先）
        // web_track表: tid, version, track
        const placeholders = trackIds.map(() => '?').join(',');
        db.all(`SELECT track FROM web_track WHERE tid IN (${placeholders})`, trackIds, (err2, trackRows) => {
          if (err2 || !trackRows || trackRows.length === 0) {
            // 尝试track表 (track表使用id作为主键)
            db.all(`SELECT track FROM track WHERE id IN (${placeholders})`, trackIds, (err3, fallbackRows) => {
              if (err3) {
                resolve([]);
                return;
              }
              resolve(this.parseTracks(fallbackRows));
            });
            return;
          }

          resolve(this.parseTracks(trackRows));
        });
      });
    });
  }

  /**
   * 解析歌曲数据
   */
  parseTracks(rows) {
    const tracks = [];
    for (const row of rows) {
      if (!row.track) continue;
      try {
        const data = JSON.parse(row.track);
        tracks.push({
          // 平台原始ID
          id: data.id,
          platformId: data.id,
          platform: 'netease',
          name: data.name,
          artist: data.ar?.map(a => a.name).join(', ') || data.artists?.map(a => a.name).join(', ') || '未知艺术家',
          album: data.al?.name || data.album?.name || '',
          duration: data.dt || data.duration || 0,
          picUrl: data.al?.picUrl || data.album?.picUrl || '',
          // 播放相关
          playable: true,
          playUrl: null // 按需获取
        });
      } catch (e) {
        // 忽略解析失败的
      }
    }
    return tracks;
  }

  /**
   * 获取我喜欢音乐（特殊歌单）
   */
  async getLikedTracks(db) {
    return new Promise((resolve, reject) => {
      // 获取用户歌单ID列表
      this.getPlaylistIds(db).then(async (playlistIds) => {
        // 查找specialType=5的歌单
        for (const pid of playlistIds) {
          try {
            const detail = await this.getPlaylistDetails(db, pid);
            if (detail && detail.name === '我喜欢的音乐') {
              const tracks = await this.getPlaylistTracks(db, pid);
              resolve(tracks);
              return;
            }
          } catch (e) {}
        }
        resolve([]);
      }).catch(reject);
    });
  }

  /**
   * 主入口：获取所有歌单和歌曲
   */
  async fetch(config = {}) {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = this.getDatabasePath();

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(new Error(`无法打开数据库: ${err.message}`));
          return;
        }
      });

      const result = {
        userId: this.getUserId(),
        platform: this.platform,
        likedSongs: [],
        playlists: []
      };

      db.serialize(async () => {
        try {
          // 1. 获取我喜欢的音乐
          console.log('  💚 读取"我喜欢的音乐"...');
          result.likedSongs = await this.getLikedTracks(db);
          console.log(`     找到 ${result.likedSongs.length} 首喜欢的歌曲`);

          // 2. 获取所有歌单ID
          const playlistIds = await this.getPlaylistIds(db);
          console.log(`  📂 发现 ${playlistIds.length} 个歌单`);

          // 3. 获取每个歌单的详情和歌曲
          for (const pid of playlistIds.slice(0, 10)) { // 限制前10个歌单
            try {
              const detail = await this.getPlaylistDetails(db, pid);
              if (!detail) continue;

              console.log(`  📥 读取歌单: ${detail.name} (${detail.trackCount}首)`);

              // 跳过"我喜欢的音乐"，因为已经单独获取
              if (detail.name === '我喜欢的音乐') continue;

              const tracks = await this.getPlaylistTracks(db, pid);

              result.playlists.push({
                ...detail,
                tracks: tracks
              });
            } catch (e) {
              console.log(`     ⚠️  读取失败: ${e.message}`);
            }
          }

          db.close();
          resolve(result);

        } catch (e) {
          db.close();
          reject(e);
        }
      });
    });
  }
}

module.exports = NeteaseLocalAdapter;
