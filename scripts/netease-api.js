#!/usr/bin/env node
/**
 * 网易云音乐API本地部署脚本
 * 启动本地网易云音乐API服务
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const NETEASE_API_PORT = process.env.NETEASE_API_PORT || 3000;
const NETEASE_API_HOST = process.env.NETEASE_API_HOST || '127.0.0.1';

class NeteaseAPIService {
  constructor() {
    this.process = null;
    this.isRunning = false;
  }

  /**
   * 检查是否已安装
   */
  isInstalled() {
    try {
      require.resolve('NeteaseCloudMusicApi');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 获取API模块路径
   */
  getAPIModulePath() {
    try {
      return require.resolve('NeteaseCloudMusicApi');
    } catch (e) {
      return null;
    }
  }

  /**
   * 安装API服务
   */
  async install() {
    console.log('📦 正在安装网易云音乐API服务...');

    return new Promise((resolve, reject) => {
      const npmInstall = spawn('npm', [
        'install',
        'NeteaseCloudMusicApi',
        '--save'
      ], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });

      npmInstall.on('close', (code) => {
        if (code === 0) {
          console.log('✅ 安装完成');
          resolve();
        } else {
          reject(new Error(`安装失败，退出码: ${code}`));
        }
      });
    });
  }

  /**
   * 启动API服务
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  服务已在运行中');
      return;
    }

    // 确保已安装
    if (!this.isInstalled()) {
      await this.install();
    }

    // 检查端口是否被占用
    const isPortAvailable = await this.checkPort(NETEASE_API_PORT);
    if (!isPortAvailable) {
      console.log(`⚠️  端口 ${NETEASE_API_PORT} 已被占用，尝试检查是否已有服务运行...`);
      const isHealthy = await this.checkHealth();
      if (isHealthy) {
        console.log('✅ 检测到已有服务在运行');
        this.isRunning = true;
        return;
      } else {
        throw new Error(`端口 ${NETEASE_API_PORT} 被占用，但不是网易云API服务`);
      }
    }

    console.log(`🚀 启动网易云音乐API服务...`);
    console.log(`   地址: http://${NETEASE_API_HOST}:${NETEASE_API_PORT}`);

    // 找到 app.js 路径
    const modulePath = this.getAPIModulePath();
    if (!modulePath) {
      throw new Error('找不到NeteaseCloudMusicApi模块');
    }
    const appPath = path.join(path.dirname(modulePath), 'app.js');

    if (!fs.existsSync(appPath)) {
      throw new Error(`找不到启动文件: ${appPath}`);
    }

    // 启动服务
    this.process = spawn('node', [appPath], {
      cwd: path.dirname(modulePath),
      env: {
        ...process.env,
        PORT: NETEASE_API_PORT,
        HOST: NETEASE_API_HOST
      },
      stdio: 'pipe'
    });

    this.process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[NeteaseAPI] ${output}`);
      }
    });

    this.process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('deprecated')) {
        console.error(`[NeteaseAPI] ${output}`);
      }
    });

    this.process.on('close', (code) => {
      console.log(`[NeteaseAPI] 服务已退出 (代码: ${code})`);
      this.isRunning = false;
      this.process = null;
    });

    // 等待服务启动
    await this.waitForStartup();
    this.isRunning = true;

    console.log('✅ 网易云音乐API服务已启动');
    console.log('');
    console.log('可用的API端点:');
    console.log(`  搜索歌曲: http://localhost:${NETEASE_API_PORT}/search?keywords=歌曲名`);
    console.log(`  获取URL:  http://localhost:${NETEASE_API_PORT}/song/url?id=歌曲ID`);
    console.log(`  歌词:     http://localhost:${NETEASE_API_PORT}/lyric?id=歌曲ID`);
    console.log(`  歌单详情: http://localhost:${NETEASE_API_PORT}/playlist/detail?id=歌单ID`);
    console.log('');

    return this.process;
  }

  /**
   * 等待服务启动
   */
  async waitForStartup() {
    const maxAttempts = 30;
    const interval = 500;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, interval));

      const isHealthy = await this.checkHealth();
      if (isHealthy) {
        return;
      }
    }

    throw new Error('服务启动超时');
  }

  /**
   * 检查端口是否可用
   */
  checkPort(port) {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(true);
        }
      });
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, NETEASE_API_HOST);
    });
  }

  /**
   * 停止服务
   */
  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.isRunning = false;
      console.log('🛑 网易云音乐API服务已停止');
    }
  }

  /**
   * 检查服务是否可用
   */
  async checkHealth() {
    return new Promise((resolve) => {
      const options = {
        hostname: NETEASE_API_HOST,
        port: NETEASE_API_PORT,
        path: '/search?keywords=test&limit=1',
        method: 'GET',
        timeout: 2000
      };

      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }
}

// 命令行支持
if (require.main === module) {
  const service = new NeteaseAPIService();
  const command = process.argv[2];

  switch (command) {
    case 'install':
      service.install().catch(console.error);
      break;

    case 'start':
      service.start().catch(err => {
        console.error('❌ 启动失败:', err.message);
        process.exit(1);
      });

      // 处理退出
      process.on('SIGINT', () => {
        console.log('\n收到退出信号...');
        service.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        service.stop();
        process.exit(0);
      });
      break;

    case 'check':
      service.checkHealth().then(healthy => {
        console.log(healthy ? '✅ 服务运行正常' : '❌ 服务未运行');
        process.exit(healthy ? 0 : 1);
      });
      break;

    default:
      console.log(`
网易云音乐API服务管理脚本

用法:
  node scripts/netease-api.js [command]

命令:
  install   安装API服务
  start     启动API服务
  check     检查服务状态

环境变量:
  NETEASE_API_PORT    服务端口 (默认: 3000)
  NETEASE_API_HOST    服务地址 (默认: 127.0.0.1)

示例:
  # 使用默认端口启动
  node scripts/netease-api.js start

  # 使用自定义端口
  NETEASE_API_PORT=4000 node scripts/netease-api.js start

  # 在后台运行
  nohup node scripts/netease-api.js start > netease-api.log 2>&1 &
      `);
  }
}

module.exports = NeteaseAPIService;
