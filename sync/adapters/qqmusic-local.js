/**
 * QQ音乐本地数据库适配器 (macOS)
 * 读取本地客户端SQLite数据库获取歌单数据
 */

const fs = require('fs');
const path = require('path');

class QQMusicLocalAdapter {
  constructor() {
    this.name = 'QQ音乐(本地)';
    this.platform = 'qqmusic-local';
  }

  /**
   * 检测是否可用
   */
  isAvailable() {
    if (process.platform !== 'darwin') {
      return { available: false, reason: '仅支持macOS' };
    }

    const dbPath = this.getDatabasePath();
    if (!dbPath || !fs.existsSync(dbPath)) {
      return { available: false, reason: '未找到QQ音乐本地数据库，请先登录' };
    }

    return { available: true, dbPath };
  }

  /**
   * 获取数据库路径
   * QQ音乐使用用户ID作为子目录
   */
  getDatabasePath() {
    const home = process.env.HOME;
    const baseDir = path.join(
      home,
      'Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac'
    );

    if (!fs.existsSync(baseDir)) return null;

    // 查找用户目录 (通常是iUser/11529...)
    const iUserDir = path.join(baseDir, 'iUser');
    if (fs.existsSync(iUserDir)) {
      const userDirs = fs.readdirSync(iUserDir).filter(d => d.startsWith('11529'));
      if (userDirs.length > 0) {
        return path.join(iUserDir, userDirs[0], 'user.db');
      }
    }

    // 备用：使用主数据库
    const mainDb = path.join(baseDir, 'qqmusic.sqlite');
    if (fs.existsSync(mainDb)) return mainDb;

    return null;
  }

  /**
   * 获取用户ID
   */
  getUserId() {
    const dbPath = this.getDatabasePath();
    if (!dbPath) return null;

    const match = dbPath.match(/iUser\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * 从user.db获取歌单列表
   */
  async getPlaylistsFromUserDb(dbPath) {
    const sqlite3 = require('sqlite3').verbose();

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      const playlists = [];

      db.serialize(() => {
        // 查询用户创建的歌单
        db.all(`SELECT folderid, folderName, folderCount, folderdesc,
                folderTimeTag, foldertype
                FROM USERFOLDERINFO
                WHERE folderid > 0
                ORDER BY folderTimeTag DESC`, (err, rows) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }

          for (const row of rows) {
            if (row.folderCount > 0) {
              playlists.push({
                id: row.folderid,
                name: row.folderName,
                description: row.folderdesc || '',
                trackCount: row.folderCount,
                createTime: row.folderTimeTag * 1000,
                type: row.foldertype === 2 ? 'created' : 'system'
              });
            }
          }

          db.close();
          resolve(playlists);
        });
      });
    });
  }

  /**
   * 从主数据库获取歌单
   */
  async getPlaylistsFromMainDb(dbPath) {
    const sqlite3 = require('sqlite3').verbose();

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      const playlists = [];

      db.serialize(() => {
        // NEWFOLDERS表包含歌单信息
        db.all(`SELECT folderid, folderName, foldercount, folderdesc,
                createTime, foldertype
                FROM NEWFOLDERS
                WHERE foldercount > 0
                ORDER BY createTime DESC`, (err, rows) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }

          for (const row of rows) {
            // 过滤系统歌单（下载、播放历史等）
            const systemNames = ['正在下载', '下载成功', '播放历史', '导入音乐'];
            if (systemNames.includes(row.folderName)) continue;

            playlists.push({
              id: row.folderid,
              name: row.folderName,
              description: row.folderdesc || '',
              trackCount: row.foldercount,
              createTime: row.createTime * 1000,
              type: row.foldertype === 1 ? 'liked' : 'created'
            });
          }

          db.close();
          resolve(playlists);
        });
      });
    });
  }

  /**
   * 获取歌单中的歌曲
   */
  async getPlaylistTracks(dbPath, folderId, folderName, folderCount) {
    const sqlite3 = require('sqlite3').verbose();
    const isMainDb = dbPath.includes('qqmusic.sqlite');

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      const tracks = [];

      db.serialize(() => {
        // 对于"我喜欢"等特殊歌单，需要通过歌曲数量来找到正确的seq
        let seqQuery;
        if (folderName && folderName.includes('我喜欢')) {
          // 通过歌曲数量匹配找到seq
          seqQuery = `SELECT seq FROM NEWFOLDERSONGS
                      GROUP BY seq
                      HAVING count(*) = ${folderCount}
                      ORDER BY seq DESC
                      LIMIT 1`;
        } else {
          // 普通歌单：直接通过folderid（大部分情况下seq=folderid）
          seqQuery = `SELECT ${folderId} as seq`;
        }

        db.get(seqQuery, (err, row) => {
          if (err || !row) {
            db.close();
            resolve([]);
            return;
          }

          const seq = row.seq;

          let query;
          if (isMainDb) {
            // 主数据库：通过NEWFOLDERSONGS关联
            // seq是分组键，id是歌曲ID
            query = `SELECT s.id, s.name, s.singer, s.album, s.K_SONG_RESERVEINT21 as duration
                     FROM SONGS s
                     JOIN NEWFOLDERSONGS fs ON s.id = fs.id
                     WHERE fs.seq = ${seq}`;
          } else {
            // 用户数据库
            query = `SELECT s.id, s.name, s.singer, s.album, s.duration
                     FROM SONGINFO s
                     JOIN USERFOLDERSONGINFO fs ON s.id = fs.id
                     WHERE fs.seq = ${seq}`;
          }

          db.all(query, (err2, rows) => {
            if (err2) {
              db.close();
              reject(err2);
              return;
            }

            for (const row of rows) {
              tracks.push({
                // 平台原始ID（重要：用于播放）
                id: row.id,
                platformId: row.id,
                platform: 'qqmusic',
                name: row.name,
                artist: row.singer || '未知艺术家',
                album: row.album || '',
                duration: (row.duration || 0) * 1000, // 转换为毫秒
                // 播放相关
                playable: true,
                playUrl: null, // 按需获取
                // 本地文件信息（如果有）
                localFile: row.file || null
              });
            }

            db.close();
            resolve(tracks);
          });
        });
      });
    });
  }

  /**
   * 获取我喜欢的音乐（特别处理）
   */
  async getLikedTracks(dbPath) {
    // QQ音乐的"我喜欢"通常是歌单名包含"喜欢"
    try {
      const playlists = await this.getPlaylistsFromMainDb(dbPath);
      // 优先找"我喜欢"，其次是"我喜欢..."
      const likedPlaylist = playlists.find(p => p.name === '我喜欢') ||
                            playlists.find(p => p.name.includes('我喜欢'));

      if (likedPlaylist) {
        console.log(`     找到"${likedPlaylist.name}"歌单，${likedPlaylist.trackCount}首`);
        return await this.getPlaylistTracks(dbPath, likedPlaylist.id, likedPlaylist.name, likedPlaylist.trackCount);
      }

      return [];
    } catch (e) {
      console.log(`     获取失败: ${e.message}`);
      return [];
    }
  }

  /**
   * 主入口：获取所有歌单和歌曲
   */
  async fetch(config = {}) {
    const dbPath = this.getDatabasePath();
    const mainDbPath = path.join(
      process.env.HOME,
      'Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/qqmusic.sqlite'
    );

    const result = {
      userId: this.getUserId(),
      platform: this.platform,
      likedSongs: [],
      playlists: []
    };

    try {
      // 1. 获取我喜欢的音乐
      console.log('  💚 读取"我喜欢的音乐"...');
      if (fs.existsSync(mainDbPath)) {
        result.likedSongs = await this.getLikedTracks(mainDbPath);
      }
      console.log(`     找到 ${result.likedSongs.length} 首喜欢的歌曲`);

      // 2. 获取歌单列表
      let playlists = [];
      if (fs.existsSync(mainDbPath)) {
        playlists = await this.getPlaylistsFromMainDb(mainDbPath);
      }
      console.log(`  📂 发现 ${playlists.length} 个歌单`);

      // 3. 获取每个歌单的歌曲
      for (const playlist of playlists.slice(0, 10)) { // 限制前10个
        try {
          console.log(`  📥 读取歌单: ${playlist.name} (${playlist.trackCount}首)`);

          const tracks = await this.getPlaylistTracks(mainDbPath, playlist.id, playlist.name, playlist.trackCount);

          result.playlists.push({
            ...playlist,
            tracks
          });
        } catch (e) {
          console.log(`     ⚠️  读取失败: ${e.message}`);
        }
      }

      return result;

    } catch (e) {
      throw new Error(`读取QQ音乐本地数据库失败: ${e.message}`);
    }
  }
}

module.exports = QQMusicLocalAdapter;
