#!/usr/bin/env node
/**
 * 歌单同步系统启动入口 (增强版)
 * 支持本地数据库读取 + 远程API + 混合同步
 * 用法: node sync/index.js [command]
 */

const fs = require('fs');
const path = require('path');
const SyncManager = require('./sync-manager');

const manager = new SyncManager();
const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
🎵 歌单同步管理工具 (v2.0)

用法:
  npm run sync [command] [options]

命令:
  scan                    扫描可用的本地数据源
  init                    初始化同步配置

  add-netease <uid>       添加网易云音乐远程数据源
  add-netease-local       添加网易云音乐本地数据源（自动检测）

  add-qqmusic             添加QQ音乐远程数据源
  add-qqmusic-local       添加QQ音乐本地数据源（自动检测）

  sync                    立即执行所有同步
  sync-netease            仅同步网易云音乐（远程+本地）
  sync-qqmusic            仅同步QQ音乐（远程+本地）
  sync-local              仅同步本地数据源

  merge                   合并所有已同步的源数据

  start                   启动自动同步服务（每小时检查）
  status                  查看同步状态和配置

  config                  显示当前配置
  config-strategy <type>  设置合并策略: union|intersect|local-first

  backup                  手动备份当前数据
  restore <file>          从备份恢复

  test-local              测试本地数据源读取

示例:
  # 首次使用 - 扫描并自动配置
  npm run sync scan
  npm run sync init

  # 手动添加网易云远程（需要UID）
  npm run sync add-netease 123456789

  # 执行同步
  npm run sync

  # 启动后台自动同步
  npm run sync start

`);
}

async function main() {
  switch (command) {
    case 'scan':
      console.log('🔍 扫描本地音乐客户端数据...\n');
      const sources = manager.scanLocalSources();

      if (sources.length > 0) {
        console.log(`\n✅ 发现 ${sources.length} 个可用本地数据源`);
        console.log('\n提示: 运行 "npm run sync init" 自动配置这些源');
      } else {
        console.log('\n❌ 未发现可用的本地数据源');
        console.log('\n可能原因:');
        console.log('  - 未安装网易云音乐或QQ音乐客户端');
        console.log('  - 客户端未登录账号');
        console.log('  - 客户端未同步过歌单数据');
      }
      break;

    case 'init':
      const localSources = manager.scanLocalSources();
      if (localSources.length === 0) {
        console.log('\n⚠️  未发现本地数据源，请先安装并登录音乐客户端');
        process.exit(1);
      }

      const config = manager.loadConfig();
      config.sources = localSources;
      manager.saveConfig(config);

      console.log('\n✅ 已初始化配置，包含以下源:');
      localSources.forEach(s => {
        console.log(`   • ${s.name}`);
      });
      console.log('\n运行 "npm run sync" 开始首次同步');
      break;

    case 'add-netease':
      const uid = args[1];
      if (!uid) {
        console.error('❌ 请提供网易云用户ID');
        console.log('获取方法: 打开 music.163.com 进入个人主页，复制 URL 中的 id 参数');
        console.log('示例: npm run sync add-netease 123456789');
        process.exit(1);
      }
      manager.addSource('netease', {
        userId: uid,
        name: '网易云音乐(远程)',
        enabled: true
      });
      break;

    case 'add-netease-local':
      const neteaseAdapter = manager.adapters['netease-local'];
      const status = neteaseAdapter.isAvailable();
      if (!status.available) {
        console.error(`❌ 无法添加: ${status.reason}`);
        process.exit(1);
      }
      manager.addSource('netease-local', {
        name: '网易云音乐(本地)',
        enabled: true,
        autoDetected: true
      });
      break;

    case 'add-qqmusic':
      console.log(`
QQ音乐远程同步需要手动导入:
1. 打开 QQ 音乐网页版
2. 按 F12 打开控制台
3. 运行导出脚本获取歌单数据
4. 将数据保存到 user/qqmusic-import.json
      `);
      break;

    case 'add-qqmusic-local':
      const qqAdapter = manager.adapters['qqmusic-local'];
      const qqStatus = qqAdapter.isAvailable();
      if (!qqStatus.available) {
        console.error(`❌ 无法添加: ${qqStatus.reason}`);
        process.exit(1);
      }
      manager.addSource('qqmusic-local', {
        name: 'QQ音乐(本地)',
        enabled: true,
        autoDetected: true
      });
      break;

    case 'sync':
      await manager.syncAll();
      console.log('\n✅ 同步完成');
      process.exit(0);
      break;

    case 'sync-netease':
      const nCfg = manager.loadConfig();
      const neteaseSources = nCfg.sources.filter(s =>
        s.platform === 'netease' || s.platform === 'netease-local'
      );
      if (neteaseSources.length === 0) {
        console.error('❌ 未配置网易云音乐数据源');
        process.exit(1);
      }
      for (const source of neteaseSources) {
        if (source.enabled) await manager.syncSource(source);
      }
      await manager.mergeAllSources();
      process.exit(0);
      break;

    case 'sync-qqmusic':
      const qCfg = manager.loadConfig();
      const qqSources = qCfg.sources.filter(s =>
        s.platform === 'qqmusic' || s.platform === 'qqmusic-local'
      );
      if (qqSources.length === 0) {
        console.error('❌ 未配置QQ音乐数据源');
        process.exit(1);
      }
      for (const source of qqSources) {
        if (source.enabled) await manager.syncSource(source);
      }
      await manager.mergeAllSources();
      process.exit(0);
      break;

    case 'sync-local':
      const lCfg = manager.loadConfig();
      const localSrcs = lCfg.sources.filter(s =>
        s.platform.endsWith('-local')
      );
      if (localSrcs.length === 0) {
        console.error('❌ 未配置本地数据源');
        console.log('请先运行: npm run sync scan');
        process.exit(1);
      }
      for (const source of localSrcs) {
        if (source.enabled) await manager.syncSource(source);
      }
      await manager.mergeAllSources();
      process.exit(0);
      break;

    case 'merge':
      await manager.mergeAllSources();
      process.exit(0);
      break;

    case 'start':
      manager.init();
      console.log('\n按 Ctrl+C 停止服务');
      // 保持进程运行
      process.stdin.resume();
      break;

    case 'status':
      const cfg = manager.loadConfig();
      console.log('\n📊 同步状态\n');
      console.log('配置来源:');
      cfg.sources.forEach(s => {
        const status = s.enabled ? '🟢 启用' : '⚪ 禁用';
        const lastSync = s.lastSync
          ? new Date(s.lastSync).toLocaleString()
          : '从未同步';
        const type = s.autoDetected ? '[自动]' : '[手动]';
        console.log(`  ${s.name} ${type} ${status}`);
        console.log(`    上次同步: ${lastSync}`);
        console.log(`    同步间隔: ${(s.syncInterval || 3600) / 60} 分钟`);
        console.log('');
      });

      // 显示合并后数据状态
      const playlistPath = path.join(__dirname, '../user/playlists.json');
      if (fs.existsSync(playlistPath)) {
        const data = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
        console.log('合并数据:');
        console.log(`  总歌曲数: ${data.songs?.length || 0}`);
        console.log(`  喜欢歌曲: ${data.likedSongs?.length || 0}`);
        console.log(`  歌单数量: ${data.playlists?.length || 0}`);
        console.log(`  数据来源: ${data.metadata?.platforms?.join(', ') || '未知'}`);
      }
      break;

    case 'config':
      const currentCfg = manager.loadConfig();
      console.log('\n⚙️  当前配置\n');
      console.log(JSON.stringify(currentCfg, null, 2));
      break;

    case 'config-strategy':
      const strategy = args[1];
      const validStrategies = ['union', 'intersect', 'local-first'];
      if (!validStrategies.includes(strategy)) {
        console.error(`❌ 无效的策略: ${strategy}`);
        console.log(`有效策略: ${validStrategies.join(', ')}`);
        process.exit(1);
      }
      const cCfg = manager.loadConfig();
      cCfg.settings.mergeStrategy = strategy;
      manager.saveConfig(cCfg);
      console.log(`✅ 合并策略已设置为: ${strategy}`);
      break;

    case 'backup':
      manager.backupData();
      break;

    case 'test-local':
      console.log('🧪 测试本地数据源读取...\n');

      // 测试网易云本地
      const nLocal = manager.adapters['netease-local'];
      const nStatus = nLocal.isAvailable();
      console.log('网易云音乐(本地):');
      console.log(`  可用: ${nStatus.available ? '✅' : '❌'}`);
      if (nStatus.available) {
        console.log(`  数据库: ${nStatus.dbPath}`);
        console.log('  尝试读取...');
        try {
          const data = await nLocal.fetch();
          console.log(`  ✅ 读取成功!`);
          console.log(`     用户ID: ${data.userId}`);
          console.log(`     喜欢歌曲: ${data.likedSongs.length}`);
          console.log(`     歌单: ${data.playlists.length}`);
        } catch (e) {
          console.log(`  ❌ 读取失败: ${e.message}`);
        }
      }

      console.log('');

      // 测试QQ音乐本地
      const qLocal = manager.adapters['qqmusic-local'];
      const qStatus = qLocal.isAvailable();
      console.log('QQ音乐(本地):');
      console.log(`  可用: ${qStatus.available ? '✅' : '❌'}`);
      if (qStatus.available) {
        console.log(`  数据库: ${qStatus.dbPath}`);
        console.log('  尝试读取...');
        try {
          const data = await qLocal.fetch();
          console.log(`  ✅ 读取成功!`);
          console.log(`     用户ID: ${data.userId}`);
          console.log(`     喜欢歌曲: ${data.likedSongs.length}`);
          console.log(`     歌单: ${data.playlists.length}`);
        } catch (e) {
          console.log(`  ❌ 读取失败: ${e.message}`);
        }
      }
      break;

    case 'help':
    default:
      showHelp();
  }
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
