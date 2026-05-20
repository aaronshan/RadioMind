/**
 * 初始化配置文件
 * 运行: node scripts/init-config.js
 */

const fs = require('fs');
const path = require('path');

const userDir = path.join(__dirname, '../user');

// 确保用户目录存在
if (!fs.existsSync(userDir)) {
  fs.mkdirSync(userDir, { recursive: true });
  console.log('✅ Created user directory');
}

// 创建默认文件
const defaultFiles = {
  'taste.md': `# 用户音乐品味档案

## 基本信息
- **主要偏好语言**: 华语、英语
- **常听年代**: 2000s-2020s

## 喜欢的风格
- 流行音乐 (Pop)
- 民谣 (Folk)
- 轻摇滚 (Soft Rock)
- R&B
- 轻音乐 / 钢琴曲

## 不喜欢的风格
- 重金属
- 过于嘈杂的电子音乐
- 过于悲伤的情歌（深夜除外）

## 喜欢的艺术家
- 周杰伦
- 陈奕迅
- 林俊杰

## 特殊偏好
- 喜欢有故事性的歌词
- 偏爱旋律优美的歌曲
- 工作时喜欢听纯音乐
- 下雨天喜欢听抒情歌
`,

  'routines.md': `# 用户日常规律

## 工作日作息
- **07:00** - 起床，需要活力音乐唤醒
- **09:00-12:00** - 工作，需要专注音乐
- **12:00-13:00** - 午休，轻松音乐
- **13:00-18:00** - 工作，保持精力
- **18:00-19:00** - 通勤/下班，放松音乐
- **19:00-22:00** - 休闲时光，多样化音乐
- **22:00后** - 准备休息，安静音乐

## 周末作息
- 起床时间较晚，约9-10点
- 下午常进行户外活动或运动
- 晚上可能有社交活动

## 特殊场景
- **运动**（跑步/健身）- 需要节奏感强的音乐
- **阅读** - 需要纯音乐或轻音乐
- **做家务** - 可以听流行或摇滚
- **睡前** - 30分钟安静音乐，自动降低音量
`,

  'mood-rules.md': `# 心情-音乐匹配规则

## 心情分类与推荐

### 开心 / Happy
- **推荐风格**: 流行、轻摇滚、电子
- **节奏**: 中等偏快
- **推荐语**: "心情不错！来首更开心的歌延续这份快乐！"

### 平静 / Calm
- **推荐风格**: 民谣、轻音乐、钢琴曲
- **节奏**: 缓慢
- **推荐语**: "享受这份宁静..."

### 专注 / Focus
- **推荐风格**: 纯音乐、古典、环境音
- **节奏**: 平稳无强烈起伏
- **推荐语**: "专注时刻，不打扰的音乐陪伴你..."

## 时间匹配
- **早晨**: 清新、活力的音乐，帮助唤醒
- **深夜**: 安静、不打扰的音乐，陪伴入眠
`,

  'playlists.json': '[]'
};

// 创建文件
Object.entries(defaultFiles).forEach(([fileName, content]) => {
  const filePath = path.join(userDir, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(`✅ Created ${fileName}`);
  } else {
    console.log(`⏭️ ${fileName} already exists`);
  }
});

// 创建 .env 文件
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  const envContent = `# Claude API配置
CLAUDE_API_KEY=your_claude_api_key_here
CLAUDE_MODEL=claude-sonnet-4-6

# 服务器配置
PORT=8080
NODE_ENV=development

# 天气API配置 (可选)
WEATHER_API_KEY=

# TTS配置 (可选)
TTS_ENABLED=false
`;
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Created .env file (please edit with your API keys)');
} else {
  console.log('⏭️ .env file already exists');
}

console.log('\n🎵 Initialization complete!');
console.log('Next steps:');
console.log('1. Edit .env file with your Claude API key');
console.log('2. Customize user/taste.md with your music preferences');
console.log('3. Run: npm install');
console.log('4. Run: npm start');
