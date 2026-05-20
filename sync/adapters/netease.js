/**
 * 网易云音乐适配器
 */

const https = require('https');
const BaseAdapter = require('./base');

class NeteaseAdapter extends BaseAdapter {
  constructor() {
    super('网易云音乐');
    this.apiBase = 'https://netease-cloud-music-api.vercel.app';
  }

  async fetch(config) {
    const { userId } = config;
    if (!userId) {
      throw new Error('需要提供网易云用户ID');
    }

    console.log(`  🔗 连接网易云 API...`);

    // 1. 获取用户歌单列表
    const playlists = await this.request(`/user/playlist?uid=${userId}`);
    if (!playlists.playlist || playlists.playlist.length === 0) {
      throw new Error('未找到歌单');
    }

    console.log(`  📂 发现 ${playlists.playlist.length} 个歌单`);

    // 2. 获取所有歌曲（限制前5个歌单）
    const allSongs = [];
    const processedIds = new Set();

    for (const playlist of playlists.playlist.slice(0, 5)) {
      console.log(`  📥 正在获取: ${playlist.name} (${playlist.trackCount}首)`);

      try {
        const detail = await this.request(`/playlist/detail?id=${playlist.id}`);

        if (detail.playlist && detail.playlist.tracks) {
          for (const track of detail.playlist.tracks) {
            if (processedIds.has(track.id)) continue;
            processedIds.add(track.id);

            allSongs.push(this.formatSong({
              id: track.id,
              name: track.name,
              artist: track.ar.map(a => a.name).join(', '),
              album: track.al?.name || '',
              duration: track.dt,
              picUrl: track.al?.picUrl || '',
              tags: this.inferTags(playlist.name, track)
            }));
          }
        }

        // 避免请求过快
        await this.sleep(500);

      } catch (e) {
        console.log(`    ⚠️  歌单 ${playlist.name} 获取失败`);
      }
    }

    return allSongs;
  }

  request(path) {
    return new Promise((resolve, reject) => {
      const url = path.startsWith('http') ? path : this.apiBase + path;
      const parsed = new URL(url);

      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('JSON parse error'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  inferTags(playlistName, track) {
    const tags = [];

    // 从歌单名推测
    const nameMap = {
      '我喜欢': '收藏',
      '云音乐': '推荐',
      '飙升': '热门',
      '新歌': '新歌',
      '热歌': '热歌',
    };

    for (const [key, tag] of Object.entries(nameMap)) {
      if (playlistName.includes(key)) {
        tags.push(tag);
        break;
      }
    }

    // 从歌曲信息推测
    const text = `${track.name} ${track.al?.name || ''}`.toLowerCase();

    const genreMap = {
      '摇滚': ['摇滚', 'rock'],
      '流行': ['流行', 'pop'],
      '民谣': ['民谣', 'folk'],
      '说唱': ['说唱', 'rap', 'hiphop'],
      '电子': ['电子', 'dj', 'remix'],
      '古典': ['古典', '钢琴', '小提琴'],
      '爵士': ['爵士', 'jazz'],
      '古风': ['古风', '戏腔', '中国风'],
    };

    for (const [genre, keywords] of Object.entries(genreMap)) {
      if (keywords.some(k => text.includes(k))) {
        tags.push(genre);
        break;
      }
    }

    return tags.length > 0 ? tags : ['音乐'];
  }
}

module.exports = NeteaseAdapter;
