#!/usr/bin/env node
/**
 * 网易云音乐歌单同步脚本
 * 用法: node scripts/sync-netease.js <用户ID>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = process.env.NETEASE_API_BASE || 'https://netease-cloud-music-api.vercel.app';

// 简单封装 HTTP 请求
function request(url) {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : API_BASE + url;
    const parsed = new URL(fullUrl);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

async function syncUserPlaylists(userId) {
  console.log(`🎵 正在同步用户 ${userId} 的歌单...\n`);

  try {
    // 1. 获取用户歌单列表
    const userData = await request(`/user/playlist?uid=${userId}`);

    if (!userData.playlist || userData.playlist.length === 0) {
      console.log('❌ 未找到歌单，请检查用户ID');
      return;
    }

    console.log(`✅ 找到 ${userData.playlist.length} 个歌单`);

    // 2. 获取所有歌曲
    const allSongs = [];
    const processedIds = new Set();

    for (const playlist of userData.playlist.slice(0, 5)) { // 只取前5个歌单
      console.log(`\n📂 正在同步歌单: ${playlist.name} (${playlist.trackCount} 首)`);

      try {
        const detail = await request(`/playlist/detail?id=${playlist.id}`);

        if (detail.playlist && detail.playlist.tracks) {
          for (const track of detail.playlist.tracks) {
            // 去重
            if (processedIds.has(track.id)) continue;
            processedIds.add(track.id);

            allSongs.push({
              id: track.id,
              name: track.name,
              artist: track.ar.map(a => a.name).join(', '),
              album: track.al.name,
              duration: track.dt,
              picUrl: track.al.picUrl,
              // 从歌单名推测风格标签
              tags: inferTags(playlist.name, track)
            });
          }
        }
      } catch (e) {
        console.log(`  ⚠️  歌单 ${playlist.name} 同步失败: ${e.message}`);
      }
    }

    console.log(`\n✅ 共同步 ${allSongs.length} 首歌曲`);

    // 3. 保存到文件
    const outputPath = path.join(__dirname, '../user/playlists.json');
    fs.writeFileSync(outputPath, JSON.stringify(allSongs, null, 2));

    console.log(`💾 已保存到: ${outputPath}`);

    // 4. 更新 taste.md
    await updateTasteFile(allSongs);

    console.log('\n🎉 同步完成！重启服务器后生效');

  } catch (error) {
    console.error('❌ 同步失败:', error.message);
  }
}

// 推测歌曲标签
function inferTags(playlistName, track) {
  const tags = [];

  // 从歌单名推测
  const nameLower = playlistName.toLowerCase();
  if (nameLower.includes('喜欢')) tags.push('收藏');
  if (nameLower.includes('云音乐')) tags.push('推荐');

  // 从歌曲风格推测（这里简化处理，实际可以调用音频分析API）
  const genreKeywords = {
    '摇滚': ['摇滚', 'rock', 'band'],
    '流行': ['流行', 'pop'],
    '民谣': ['民谣', 'folk'],
    '说唱': ['说唱', 'rap', 'hiphop'],
    '电子': ['电子', 'electronic', 'edm'],
    '古典': ['古典', 'classic', '钢琴'],
    '爵士': ['爵士', 'jazz'],
  };

  const text = `${track.name} ${track.al.name}`.toLowerCase();
  for (const [genre, keywords] of Object.entries(genreKeywords)) {
    if (keywords.some(k => text.includes(k))) {
      tags.push(genre);
    }
  }

  return tags.length > 0 ? tags : ['音乐'];
}

// 更新 taste.md 文件
async function updateTasteFile(songs) {
  const tastePath = path.join(__dirname, '../user/taste.md');

  // 分析喜欢的艺术家
  const artistCount = {};
  songs.forEach(s => {
    const artists = s.artist.split(', ');
    artists.forEach(a => {
      artistCount[a] = (artistCount[a] || 0) + 1;
    });
  });

  const topArtists = Object.entries(artistCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  // 分析风格
  const allTags = songs.flatMap(s => s.tags);
  const tagCount = {};
  allTags.forEach(t => {
    tagCount[t] = (tagCount[t] || 0) + 1;
  });

  const topGenres = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  const content = `# 用户音乐品味档案

## 基本信息
- **歌单数量**: ${songs.length} 首
- **主要偏好语言**: 华语、英语
- **常听年代**: 2000s-2020s

## 喜欢的风格
${topGenres.map(g => `- ${g}`).join('\n')}

## 喜欢的艺术家
${topArtists.map(a => `- ${a}`).join('\n')}

## 收藏标签
- 网易云音乐同步
- 私人FM推荐

*自动更新时间: ${new Date().toLocaleString()}*
`;

  fs.writeFileSync(tastePath, content);
  console.log(`📝 已更新品味档案: ${tastePath}`);
}

// 主程序
const userId = process.argv[2];

if (!userId) {
  console.log(`
🎵 网易云音乐歌单同步工具

用法:
  node scripts/sync-netease.js <网易云用户ID>

获取用户ID方法:
  1. 打开网易云音乐网页版
  2. 进入你的个人主页
  3. 查看URL: https://music.163.com/#/user/home?id=XXXXX
  4. 复制 XXXXX 部分

示例:
  node scripts/sync-netease.js 123456789
`);
  process.exit(1);
}

syncUserPlaylists(userId);
