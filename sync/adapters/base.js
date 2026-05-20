/**
 * 同步适配器基类
 */

class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * 获取歌单数据
   * @param {Object} config 配置信息
   * @returns {Promise<Array>} 歌曲列表
   */
  async fetch(config) {
    throw new Error('Must implement fetch method');
  }

  /**
   * 格式化歌曲数据
   */
  formatSong(raw) {
    return {
      id: raw.id,
      name: raw.name,
      artist: raw.artist,
      album: raw.album || '',
      duration: raw.duration || 0,
      picUrl: raw.picUrl || '',
      tags: raw.tags || []
    };
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseAdapter;
