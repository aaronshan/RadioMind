/**
 * QQ音乐适配器
 * 由于QQ音乐没有官方开放API，使用模拟方式或第三方服务
 */

const BaseAdapter = require('./base');
const fs = require('fs');
const path = require('path');

class QQMusicAdapter extends BaseAdapter {
  constructor() {
    super('QQ音乐');
    this.dataPath = path.join(__dirname, '../../user/qqmusic-import.json');
  }

  async fetch(config) {
    // QQ音乐需要通过 cookie 或导出文件获取
    // 这里提供几种方式：

    // 方式1: 从导出文件读取
    if (fs.existsSync(this.dataPath)) {
      console.log('  📄 从导出文件导入...');
      const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
      return data.map(s => this.formatSong(s));
    }

    // 方式2: 提示用户如何导出
    console.log(`
  ⚠️  QQ音乐需要通过以下方式导入:

  方式1 - 浏览器导出:
    1. 打开 music.qq.com 并登录
    2. 进入歌单页面
    3. 按 F12 打开控制台
    4. 粘贴以下代码并执行:

    const songs = [...document.querySelectorAll('.songlist__item')].map(s => ({
      id: s.dataset.id || Math.random().toString(36),
      name: s.querySelector('.songlist__songname_text')?.textContent?.trim(),
      artist: s.querySelector('.songlist__artist')?.textContent?.trim(),
      album: s.querySelector('.songlist__album')?.textContent?.trim(),
      duration: 0
    }));
    console.log(JSON.stringify(songs, null, 2));

    5. 复制输出的 JSON 保存到:
       ${this.dataPath}

  方式2 - 使用第三方工具:
    - Music Lake: https://musiclake.app/
    - 将歌单导出为 JSON 格式

  方式3 - 手动整理:
    创建一个 JSON 文件: ${this.dataPath}
    格式:
    [
      {
        "id": "1",
        "name": "歌曲名",
        "artist": "艺术家",
        "album": "专辑",
        "duration": 240000
      }
    ]
    `);

    throw new Error('需要手动导入QQ音乐歌单');
  }
}

module.exports = QQMusicAdapter;
