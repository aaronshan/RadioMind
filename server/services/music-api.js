/**
 * NeteaseCloudMusicApi - 音乐服务
 * 歌曲检索 · 直链 · 歌词 · 推荐
 */

const axios = require('axios');

class MusicAPI {
  constructor() {
    // 使用配置的API地址（本地或自定义外部地址）
    this.baseURL = process.env.NETEASE_API_BASE
      || `http://${process.env.NETEASE_API_HOST || '127.0.0.1'}:${process.env.NETEASE_API_PORT || 3000}`;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log(`[MusicAPI] 使用API: ${this.baseURL}`);
  }

  /**
   * 发送请求
   */
  async request(config) {
    return await this.client.request(config);
  }

  /**
   * 搜索歌曲
   */
  async search(keywords, limit = 10, type = 1) {
    try {
      const response = await this.request({
        method: 'get',
        url: '/search',
        params: { keywords, limit, type }
      });

      if (response.data?.result?.songs) {
        return response.data.result.songs.map(song => this.formatSong(song));
      }

      return [];
    } catch (error) {
      console.error('Search error:', error.message);
      // 返回模拟数据以便测试
      return this.getMockSongs(keywords, limit);
    }
  }

  /**
   * 获取歌曲URL
   */
  async getSongUrl(id, br = 320000) {
    try {
      const response = await this.request({
        method: 'get',
        url: '/song/url',
        params: { id, br }
      });

      if (response.data?.data?.[0]?.url) {
        return response.data.data[0].url;
      }

      return null;
    } catch (error) {
      console.error('Get song URL error:', error.message);
      return null;
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(id) {
    try {
      const response = await this.request({
        method: 'get',
        url: '/lyric',
        params: { id }
      });

      return {
        lrc: response.data?.lrc?.lyric || '',
        tlyric: response.data?.tlyric?.lyric || '',
        romalrc: response.data?.romalrc?.lyric || ''
      };
    } catch (error) {
      console.error('Get lyric error:', error.message);
      return { lrc: '', tlyric: '', romalrc: '' };
    }
  }

  /**
   * 获取歌曲详情
   */
  async getSongDetail(ids) {
    try {
      const idString = Array.isArray(ids) ? ids.join(',') : ids;
      const response = await this.request({
        method: 'get',
        url: '/song/detail',
        params: { ids: idString }
      });

      if (response.data?.songs) {
        return response.data.songs.map(song => this.formatSong(song));
      }

      return [];
    } catch (error) {
      console.error('Get song detail error:', error.message);
      return [];
    }
  }

  /**
   * 获取推荐歌单
   */
  async getRecommendPlaylists(limit = 10) {
    try {
      const response = await this.request({
        method: 'get',
        url: '/personalized',
        params: { limit }
      });

      return response.data?.result || [];
    } catch (error) {
      console.error('Get recommend playlists error:', error.message);
      return [];
    }
  }

  /**
   * 获取推荐歌曲
   */
  async getRecommendSongs() {
    try {
      const response = await this.request({
        method: 'get',
        url: '/recommend/songs'
      });

      if (response.data?.data?.dailySongs) {
        return response.data.data.dailySongs.map(song => this.formatSong(song));
      }

      return [];
    } catch (error) {
      console.error('Get recommend songs error:', error.message);
      return [];
    }
  }

  /**
   * 获取歌单详情
   */
  async getPlaylistDetail(id) {
    try {
      const response = await this.request({
        method: 'get',
        url: '/playlist/detail',
        params: { id }
      });

      return response.data?.result || null;
    } catch (error) {
      console.error('Get playlist detail error:', error.message);
      return null;
    }
  }

  /**
   * 获取热门搜索
   */
  async getHotSearch() {
    try {
      const response = await this.request({
        method: 'get',
        url: '/search/hot'
      });

      return response.data?.result?.hots || [];
    } catch (error) {
      console.error('Get hot search error:', error.message);
      return [];
    }
  }

  /**
   * 格式化歌曲数据
   */
  formatSong(song) {
    return {
      id: song.id,
      name: song.name,
      artist: song.ar?.map(a => a.name).join(', ') || song.artists?.map(a => a.name).join(', ') || '未知艺术家',
      album: song.al?.name || song.album?.name || '未知专辑',
      duration: song.dt || song.duration || 0,
      picUrl: song.al?.picUrl || song.album?.picUrl || '',
      url: null // 需要通过 getSongUrl 获取
    };
  }

  /**
   * 模拟歌曲数据（用于测试）
   */
  getMockSongs(keywords, limit) {
    const mockSongs = [
      { id: 1, name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269000, picUrl: '' },
      { id: 2, name: '七里香', artist: '周杰伦', album: '七里香', duration: 299000, picUrl: '' },
      { id: 3, name: '稻香', artist: '周杰伦', album: '魔杰座', duration: 223000, picUrl: '' },
      { id: 4, name: '夜曲', artist: '周杰伦', album: '十一月的萧邦', duration: 226000, picUrl: '' },
      { id: 5, name: '告白气球', artist: '周杰伦', album: '周杰伦的床边故事', duration: 215000, picUrl: '' },
      { id: 6, name: '演员', artist: '薛之谦', album: '初学者', duration: 261000, picUrl: '' },
      { id: 7, name: '认真的雪', artist: '薛之谦', album: '薛之谦', duration: 258000, picUrl: '' },
      { id: 8, name: '成都', artist: '赵雷', album: '成都', duration: 335000, picUrl: '' },
      { id: 9, name: '南山南', artist: '马頔', album: '孤岛', duration: 293000, picUrl: '' },
      { id: 10, name: '理想三旬', artist: '陈鸿宇', album: '浓烟下的诗歌电台', duration: 208000, picUrl: '' }
    ];

    // 根据关键词过滤
    const filtered = mockSongs.filter(song =>
      song.name.toLowerCase().includes(keywords.toLowerCase()) ||
      song.artist.toLowerCase().includes(keywords.toLowerCase())
    );

    return filtered.slice(0, limit);
  }
}

module.exports = MusicAPI;
