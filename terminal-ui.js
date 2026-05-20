#!/usr/bin/env node
/**
 * RadioMind Terminal UI
 * Layout:
 *   ┌──────────────────────┬──────────────┐
 *   │  playerBox (60%)     │ clockBox(40%)│
 *   │  visualizer          │ pixel clock  │
 *   │  song info           │ date/weekday │
 *   │  progress + controls ├──────────────┤
 *   │                      │ queueBox     │
 *   ├──────────────────────┴──────────────┤
 *   │  chatBox (full width)               │
 *   ├─────────────────────────────────────┤
 *   │  inputBox                           │
 *   └─────────────────────────────────────┘
 */

const blessed = require('blessed');
const WebSocket = require('ws');
const axios = require('axios');
const { spawn, execSync } = require('child_process');

const ACCENT     = 'cyan';
const ACCENT_DIM = 'blue';
const MUTED      = 'grey';
const SUCCESS    = 'green';
const ERROR      = 'red';
const TEXT       = 'white';

// 上半区高度（行数，固定避免百分比计算问题）
const TOP_ROWS   = 14;
// 右列宽度（百分比）
const RIGHT_PCT  = 40;
// clockBox 高度（行数）
const CLOCK_ROWS = 9;

class TerminalUI {
  constructor() {
    this.screen = null;
    this.components = {};
    this.ws = null;
    this.currentSong = null;
    this.isPlaying = false;
    this.queue = [];
    this.visualizerFrame = 0;
    this.visualizerInterval = null;
    this.ttsEnabled = true;
    this.volume = 70;
    this.inputMode = false;
    this._streamBuffer = null;
    this._player = null;        // 当前播放进程
    this._playerCmd = null;     // 检测到的播放器命令

    this.init();
  }

  init() {
    this.setupScreen();
    this.setupComponents();
    this.setupWebSocket();
    this.setupKeyBindings();
    this.startVisualizer();
    this.log('RadioMind started  Press i to chat, Space to play, h for help', 'system');
    this.fetchQueue();
    // 初始化 controls 居中
    this.components.controls.setContent(
      this.centerPad(`{${MUTED}-fg}<- Prev   Space Play/Pause   Next ->{/${MUTED}-fg}`, this.getPlayerInnerW() - 4)
    );
  }

  // ── Screen ─────────────────────────────────────────────

  setupScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'RadioMind - AI Music Agent',
      fullUnicode: true,
      forceUnicode: true,
      cursor: { artificial: true, shape: 'line', blink: true, color: ACCENT }
    });
    this.screen.on('error', () => {});
  }

  // ── Components ─────────────────────────────────────────

  setupComponents() {
    // 呼吸灯外框：四条1字符宽色条，256色平滑呼吸
    // 呼吸灯外框：单层色条，256色平滑呼吸
    this.components.borderTop    = blessed.box({ top: 0, left: 0, width: '100%', height: 1, style: { bg: 17 } });
    this.components.borderBottom = blessed.box({ bottom: 0, left: 0, width: '100%', height: 1, style: { bg: 17 } });
    this.components.borderLeft   = blessed.box({ top: 0, left: 0, width: 1, height: '100%', style: { bg: 17 } });
    this.components.borderRight  = blessed.box({ top: 0, right: 0, width: 1, height: '100%', style: { bg: 17 } });

    // ── 三列等宽布局（各33%），上半区固定 TOP_ROWS 行 ──────

    // 黄框 playerBox（左列 0~33%）
    this.components.playerBox = blessed.box({
      top: 1, left: 1,
      width: '33%-1', height: TOP_ROWS,
      border: { type: 'line' },
      label: ` {${ACCENT}-fg}NOW PLAYING{/${ACCENT}-fg} `,
      tags: true,
      style: { border: { fg: 238 } }
    });

    // 以下全部用屏幕绝对坐标，不挂 parent，彻底避免边框被覆盖
    // playerBox 内容区：top:2~TOP_ROWS, left:2~33%-2

    // 可视化器（top:2, 高6行）
    this.components.visualizer = blessed.text({
      top: 2, left: 2,
      width: '33%-4', height: 6,
      content: this.getStaticVisualizer(),
      tags: true,
      style: { fg: ACCENT_DIM }
    });

    // 歌曲名（top:9）
    this.components.songName = blessed.text({
      top: 9, left: 2,
      width: '33%-4', height: 1,
      content: 'Waiting for music...',
      tags: true,
      style: { fg: TEXT, bold: true }
    });

    // 艺术家（top:10）
    this.components.songArtist = blessed.text({
      top: 10, left: 2,
      width: '33%-4', height: 1,
      content: '', tags: true,
      style: { fg: MUTED }
    });

    // 控制按钮（top:12，固定行）
    this.components.controls = blessed.text({
      top: 12, left: 2,
      width: '33%-4', height: 1,
      content: `{${MUTED}-fg}<- Prev   Space Play/Pause   Next ->{/${MUTED}-fg}`,
      tags: true
    });

    // 状态徽章（top:13 左）
    this.components.statusBadge = blessed.text({
      top: 13, left: 3,
      width: '20%', height: 1,
      content: `{${MUTED}-fg}● READY{/${MUTED}-fg}`,
      tags: true
    });

    // 音量指示（top:13 右，playerBox 内）
    this.components.volumeBadge = blessed.text({
      top: 13, left: '22%',
      width: '11%', height: 1,
      content: `{${MUTED}-fg}VOL 70%{/${MUTED}-fg}`,
      tags: true
    });

    // 红框 queueBox（中列）
    this.components.queueBox = blessed.list({
      top: 1, left: '34%',
      width: '33%-1', height: TOP_ROWS,
      border: { type: 'line' },
      label: ` {${ACCENT}-fg}QUEUE{/${ACCENT}-fg} `,
      tags: true,
      scrollable: true, alwaysScroll: true,
      keys: true, vi: true,
      style: {
        border: { fg: 238 },
        selected: { bg: ACCENT_DIM, fg: 'black', bold: true },
        item: { fg: TEXT }
      }
    });

    // 绿框 clockBox（右列）
    this.components.clockBox = blessed.box({
      top: 1, left: '67%',
      width: '33%-1', height: TOP_ROWS,
      border: { type: 'line' },
      tags: true,
      style: { border: { fg: 238 } }
    });

    // 绿框内容：全部垂直居中排列，用屏幕绝对坐标
    // 绿框占 left:67%，width:33%，内容区 left:68%，width:31%

    // 像素时钟（顶部，5行高）
    this.components.clockDisplay = blessed.text({
      top: 2, left: '68%',
      width: '31%', height: 5,
      align: 'center',
      tags: true, content: '',
      style: { fg: TEXT }
    });

    // 星期（时钟下方）
    this.components.weekdayText = blessed.text({
      top: 8, left: '68%',
      width: '31%',
      align: 'center', tags: true, content: '',
      style: { fg: TEXT, bold: true }
    });

    // 日期
    this.components.dateDisplay = blessed.text({
      top: 9, left: '68%',
      width: '31%',
      align: 'center', tags: true, content: '',
      style: { fg: MUTED }
    });

    // ON AIR（底部）
    this.components.onAirBadge = blessed.text({
      top: TOP_ROWS - 2, left: '68%',
      width: '31%',
      align: 'center', tags: true,
      content: `{green-fg}●{/green-fg} ON AIR`,
      style: { fg: MUTED }
    });

    // chatBox（全宽，上半区下方）
    this.components.chatBox = blessed.log({
      top: TOP_ROWS + 1, left: 1, right: 1, bottom: 4,
      border: { type: 'line' },
      label: ` {${ACCENT}-fg}CHAT WITH RADIOMIND{/${ACCENT}-fg}  {${MUTED}-fg}● LIVE{/${MUTED}-fg} `,
      tags: true,
      scrollable: true, alwaysScroll: true, mouse: true,
      scrollbar: { ch: '|', style: { fg: ACCENT_DIM } },
      style: { border: { fg: 238 }, fg: TEXT }
    });

    // ── inputBox（底部）──────────────────────────────────
    this.components.inputBox = blessed.textbox({
      bottom: 1, left: 1, right: 1, height: 3,
      border: { type: 'line' },
      label: ` {${MUTED}-fg}Press i to type, Space to play/pause{/${MUTED}-fg} `,
      inputOnFocus: true, tags: true,
      style: {
        border: { fg: 238 },
        focus: { border: { fg: ACCENT } },
        fg: TEXT
      }
    });

    // ── Help overlay ──────────────────────────────────────
    this.components.helpBox = blessed.box({
      top: 2, left: 'center',
      width: '80%', height: 30,
      border: { type: 'line' },
      label: ` {${ACCENT}-fg}KEYBOARD SHORTCUTS{/${ACCENT}-fg} `,
      tags: true, hidden: true,
      style: { border: { fg: ACCENT }, bg: 'black' }
    });

    blessed.text({
      parent: this.components.helpBox,
      top: 1, left: 2, right: 3, tags: true,
      style: { bg: 'black', fg: TEXT },
      content: `
 {${ACCENT}-fg}Playback{/${ACCENT}-fg}                    {${ACCENT}-fg}Discovery{/${ACCENT}-fg}
  {bold}Space{/bold}    Play / Pause           {bold}n{/bold}   AI recommendation
  {bold}<- / ->{/bold}  Prev / Next            {bold}r{/bold}   Refresh queue
  {bold}s{/bold}        Stop
  {bold}+ / -{/bold}    Volume up / down

 {${ACCENT}-fg}Interface{/${ACCENT}-fg}
  {bold}i{/bold}           Enter chat input
  {bold}Tab{/bold}         Focus queue (↑↓ browse, Enter play)
  {bold}Esc{/bold}         Exit input / queue focus
  {bold}t{/bold}           Toggle TTS voice
  {bold}h / ?{/bold}       Toggle this panel
  {bold}q / Ctrl+C{/bold}  Quit

 {${ACCENT}-fg}Chat Commands{/${ACCENT}-fg}
  {${MUTED}-fg}/play <song>   /mood <mood>   /weather   /skip{/${MUTED}-fg}

 {${MUTED}-fg}Press h or Esc to close{/${MUTED}-fg}`
    });

    const BORDER_KEYS = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'];
    BORDER_KEYS.forEach(k => this.screen.append(this.components[k]));
    Object.keys(this.components).forEach(k => {
      if (!BORDER_KEYS.includes(k) && k !== 'helpBox') {
        this.screen.append(this.components[k]);
      }
    });
    this.screen.append(this.components.helpBox);
  }

  // ── Visualizer ─────────────────────────────────────────

  // 竖向柱状可视化器：每根柱子从底部向上生长
  // 柱子数和容器宽度统一用同一个计算基准
  // playerBox 内容区总宽（边框内侧）
  getPlayerInnerW() {
    return Math.max(20, Math.floor(this.screen.width * 0.33) - 2);
  }

  // visualizer 组件宽（left:2 right:2，即内容区减4）
  getVisualizerW() {
    return this.getPlayerInnerW() - 4;
  }

  getBarCount() {
    return Math.max(8, Math.floor((this.getVisualizerW() - 1) / 2));
  }

  getStaticVisualizer() {
    const bars = this.screen ? this.getBarCount() : 20;
    const rows = 5;
    const vizW = this.screen ? this.getVisualizerW() : 40;
    // 静止：底部一排小方块粒子，暗灰色
    return Array(rows).fill(0).map((_, r) => {
      const row = Array(bars).fill(r === rows - 1 ? '▪' : ' ').join(' ');
      return this.centerPad(row, vizW);
    }).join('\n');
  }

  getAnimatedVisualizer() {
    const f = this.visualizerFrame;
    const bars = this.getBarCount();
    const rows = 5;
    const vizW = this.getVisualizerW();

    const barHeights = Array(bars).fill(0).map((_, i) => {
      const v = Math.abs(
        Math.sin((i / 3.5) + f * 0.25) * 2.5 +
        Math.sin((i / 1.5) + f * 0.4)  * 1.5 +
        Math.sin(i * 0.8   + f * 0.6)  * 0.8
      );
      return Math.max(1, Math.min(Math.round(v), rows));
    });

    // 粒子感：每格用 ▪ 小方块，顶部用 ◆ 高亮
    return Array(rows).fill(0).map((_, r) => {
      const row = barHeights.map(h => {
        const level = rows - r;
        if (h >= level) return level === rows - h + h ? '◆' : '▪';
        if (h === level - 1 && h > 0) return '◆'; // 顶端高亮粒子
        return ' ';
      }).join(' ');
      return this.centerPad(row, vizW);
    }).join('\n');
  }

  // ── Breathing ──────────────────────────────────────────

  updateBreathing() {
    // 深蓝 → 蓝 → 蓝灰 → 柔和白，无青/紫/粉
    const STEPS = [17, 18, 19, 20, 21, 27, 32, 67, 110, 153, 188, 231, 188, 153, 110, 67, 32, 27, 21, 20, 19, 18];
    const idx = Math.floor((Math.sin(this.visualizerFrame * 0.06) + 1) / 2 * (STEPS.length - 1));
    const color = STEPS[Math.max(0, Math.min(Math.round(idx), STEPS.length - 1))];
    ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'].forEach(k => {
      this.components[k].style.bg = color;
    });
  }

  resetBreathing() {
    ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'].forEach(k => {
      this.components[k].style.bg = 17;
    });
  }

  // LIVE 绿色呼吸圆点（chatBox label，与 ON AIR 同色调）
  updateLive() {
    const idx = Math.floor((Math.sin(this.onAirFrame * 0.05 + 1) + 1) / 2 * 7);
    const color = ['grey', 'green', 'green', 'green', 'white', 'green', 'green', 'green'][Math.max(0, Math.min(idx, 7))];
    this.components.chatBox.setLabel(
      ` {${ACCENT}-fg}CHAT WITH RADIOMIND{/${ACCENT}-fg}  {${color}-fg}●{/${color}-fg} LIVE `
    );
  }

  // ON AIR 绿色呼吸圆点（独立 sine 波，与外框无关）
  updateOnAir() {
    const idx = Math.floor((Math.sin(this.onAirFrame * 0.06) + 1) / 2 * 7);
    const color = ['grey', 'green', 'green', 'green', 'white', 'green', 'green', 'green'][Math.max(0, Math.min(idx, 7))];
    const colW = this._clockColW || 30;
    this.components.onAirBadge.setContent(
      this.centerPad(`{${color}-fg}●{/${color}-fg} ON AIR`, colW)
    );
  }

  startVisualizer() {
    this.onAirFrame = 0;

    this.visualizerInterval = setInterval(() => {
      if (this.isPlaying) {
        this.visualizerFrame++;
        this.components.visualizer.setContent(
          `{${ACCENT_DIM}-fg}${this.getAnimatedVisualizer()}{/${ACCENT_DIM}-fg}`
        );
        this.updateBreathing();
      }
      // ON AIR 和 LIVE 呼吸始终运行
      this.onAirFrame++;
      this.updateOnAir();
      this.updateLive();
      this.screen.render();
    }, 120);

    setInterval(() => this.updateClock(), 1000);
  }

  // ── Pixel clock ────────────────────────────────────────

  getPixelChar(ch) {
    const G = {
      '0': ['███','█ █','█ █','█ █','███'],
      '1': [' █ ',' ██','  █','  █','  █'],
      '2': ['███','  █','███','█  ','███'],
      '3': ['███','  █','███','  █','███'],
      '4': ['█ █','█ █','███','  █','  █'],
      '5': ['███','█  ','███','  █','███'],
      '6': ['███','█  ','███','█ █','███'],
      '7': ['███','  █','  █','  █','  █'],
      '8': ['███','█ █','███','█ █','███'],
      '9': ['███','█ █','███','  █','███'],
      ':': ['   ',' █ ','   ',' █ ','   '],
    };
    return G[ch] || ['   ','   ','   ','   ','   '];
  }

  // 手动居中：在字符串两侧加空格，使其在 containerWidth 内居中
  centerPad(str, containerWidth) {
    const len = str.replace(/\{[^}]+\}/g, '').length; // 去掉 blessed tags 计算实际长度
    const pad = Math.max(0, Math.floor((containerWidth - len) / 2));
    return ' '.repeat(pad) + str;
  }

  renderPixelClock(str, containerWidth) {
    const rows = ['', '', '', '', ''];
    for (const ch of str) {
      const g = this.getPixelChar(ch);
      for (let r = 0; r < 5; r++) rows[r] += g[r] + ' ';
    }
    // 手动居中每行
    return rows.map(row => this.centerPad(row, containerWidth)).join('\n');
  }

  updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months   = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const day      = String(now.getDate()).padStart(2, '0');

    // 绿框内容区宽度 = 屏幕总宽 × 31% - 2（边框）
    const colW = Math.floor(this.screen.width * 0.31) - 2;

    this.components.clockDisplay.setContent(
      this.renderPixelClock(`${h}:${m}`, colW)
    );

    const weekday = weekdays[now.getDay()];
    const dateStr = `${day} ${months[now.getMonth()]} ${now.getFullYear()}`;
    this.components.weekdayText.setContent(
      this.centerPad(`{bold}${weekday}{/bold}`, colW)
    );
    this.components.dateDisplay.setContent(
      this.centerPad(`{${MUTED}-fg}${dateStr}{/${MUTED}-fg}`, colW)
    );
    // ON AIR 也手动居中（颜色由 updateOnAir 负责，这里只更新位置）
    this._clockColW = colW;
    this.screen.render();
  }

  // ── Key bindings ───────────────────────────────────────

  setupKeyBindings() {
    this.screen.key(['C-c'], () => { this.cleanup(); process.exit(0); });

    this.screen.key(['q'],       () => { if (!this.inputMode) { this.cleanup(); process.exit(0); } });
    this.screen.key(['h', '?'],  () => { if (!this.inputMode) this.toggleHelp(); });
    this.screen.key(['space'],   () => { if (!this.inputMode) this.togglePlay(); });
    this.screen.key(['left'],    () => { if (!this.inputMode) this.playPrevious(); });
    this.screen.key(['right'],   () => { if (!this.inputMode) this.playNext(); });
    this.screen.key(['s'],       () => { if (!this.inputMode) this.stop(); });
    this.screen.key(['+', '='],  () => { if (!this.inputMode) this.adjustVolume(10); });
    this.screen.key(['-'],       () => { if (!this.inputMode) this.adjustVolume(-10); });
    this.screen.key(['r'],       () => { if (!this.inputMode) this.fetchQueue(); });
    this.screen.key(['n'],       () => { if (!this.inputMode) this.getRecommendation(); });
    this.screen.key(['t'],       () => { if (!this.inputMode) this.toggleTTS(); });

    this.screen.key(['i'], () => {
      if (!this.inputMode) this.enterInputMode();
    });

    // Tab 切换焦点到 queue，边框变亮提示选中
    this.screen.key(['tab'], () => {
      if (!this.inputMode) {
        this.components.queueBox.style.border.fg = ACCENT;
        this.components.playerBox.style.border.fg = 238;
        this.components.queueBox.focus();
        this.screen.render();
      }
    });

    this.components.queueBox.key(['escape'], () => {
      this.components.queueBox.style.border.fg = 238;
      this.screen.focusPop();
      this.screen.render();
    });

    this.components.inputBox.key(['escape'], () => {
      this.components.inputBox.clearValue();
      this.exitInputMode();
    });

    this.components.inputBox.on('submit', (text) => {
      this.handleInput(text);
      this.components.inputBox.clearValue();
      this.exitInputMode();
    });

    this.components.queueBox.on('select', (item, index) => {
      this.components.queueBox.style.border.fg = 238;
      this.screen.focusPop();
      this.playQueueItem(index);
    });

    this.components.helpBox.key(['escape', 'q', 'h', '?'], () => {
      this.toggleHelp();
    });
  }

  enterInputMode() {
    this.inputMode = true;
    this.components.inputBox.focus();
    this.components.inputBox.setLabel(
      ` {${ACCENT}-fg}INSERT -- (Esc to exit){/${ACCENT}-fg} `
    );
    this.screen.render();
  }

  exitInputMode() {
    this.inputMode = false;
    this.screen.focusPop();
    this.components.inputBox.setLabel(
      ` {${MUTED}-fg}Press i to type, Space to play/pause{/${MUTED}-fg} `
    );
    this.screen.render();
  }

  // ── WebSocket ──────────────────────────────────────────

  setupWebSocket() {
    const wsUrl = 'ws://localhost:8080';
    this.ws = new WebSocket(wsUrl);
    this.ws.on('open',    () => { this.log('Connected to RadioMind server', 'success'); });
    this.ws.on('message', (data) => {
      try { this.handleWebSocketMessage(JSON.parse(data)); } catch (e) {}
    });
    this.ws.on('close',   () => {
      this.log('Disconnected. Retrying...', 'error');
      setTimeout(() => this.setupWebSocket(), 3000);
    });
    this.ws.on('error',   () => {});
  }

  handleWebSocketMessage(msg) {
    switch (msg.type) {
      case 'state':
      case 'now_playing':
        if (msg.data) this.updateNowPlaying(msg.data);
        break;
      case 'chat_stream':
        this.appendChatStream(msg.data);
        break;
      case 'recommendation':
        if (msg.data) this.log(`Recommended: ${msg.data.name} — ${msg.data.artist}`, 'info');
        break;
    }
  }

  // ── Player ─────────────────────────────────────────────

  async togglePlay() {
    if (!this.currentSong) { await this.playNext(); return; }
    if (this.isPlaying) {
      // 暂停：mpv 支持 SIGSTOP，ffplay 不支持，直接 kill 后重新播放
      if (this._playerCmd === 'mpv' && this._player) {
        this._player.kill('SIGSTOP');
        this.isPlaying = false;
      } else {
        this.stopPlayer();
        this.isPlaying = false;
      }
    } else {
      // 继续：mpv 支持 SIGCONT，其他重新获取 URL 播放
      if (this._playerCmd === 'mpv' && this._player) {
        this._player.kill('SIGCONT');
        this.isPlaying = true;
      } else {
        // 重新播放当前歌曲
        await this.playSong(this.currentSong);
        return;
      }
    }
    this.updatePlayStatus();
  }

  // 统一获取歌曲 ID（字符串，避免类型不匹配）
  getSongId(song) {
    return String(song?.id || song?.platformId || '');
  }

  // 在 queue 里查找当前歌曲的索引
  getCurrentQueueIdx() {
    if (!this.currentSong || this.queue.length === 0) return -1;
    const currentId = this.getSongId(this.currentSong);
    return this.queue.findIndex(s => this.getSongId(s) === currentId);
  }

  async playNext() {
    const idx = this.getCurrentQueueIdx();
    if (idx >= 0 && idx < this.queue.length - 1) {
      // 队列里有下一首
      this.playSong(this.queue[idx + 1]);
      return;
    }
    // 队列末尾或当前歌曲不在队列里，调 AI 推荐
    try {
      const res = await axios.get('http://localhost:8080/api/next');
      const song = res.data;
      if (song) {
        // 把推荐歌曲追加到队列末尾，保持连贯
        this.queue.push(song);
        this.renderQueue();
        this.playSong(song);
      }
    } catch { this.log('Failed to get next track', 'error'); }
  }

  playPrevious() {
    const idx = this.getCurrentQueueIdx();
    if (idx > 0) {
      this.playSong(this.queue[idx - 1]);
    } else if (idx === 0) {
      this.log('Already at first track', 'info');
    } else {
      // 当前歌曲不在队列里，播放队列最后一首
      if (this.queue.length > 0) this.playSong(this.queue[this.queue.length - 1]);
    }
  }

  stop() {
    this.stopPlayer();
    this.isPlaying = false;
    this.updatePlayStatus();
  }

  adjustVolume(delta) {
    this.volume = Math.max(0, Math.min(100, this.volume + delta));
    this.sendMpvCommand({ command: ['set_property', 'volume', this.volume] });
    this.components.volumeBadge.setContent(
      `{${MUTED}-fg}VOL ${this.volume}%{/${MUTED}-fg}`
    );
    this.screen.render();
  }

  updatePlayStatus() {
    if (this.isPlaying) {
      this.components.statusBadge.setContent(`{${ACCENT}-fg}▶ PLAYING{/${ACCENT}-fg}`);
    } else {
      this.components.statusBadge.setContent(`{${MUTED}-fg}● PAUSED{/${MUTED}-fg}`);
      this.components.visualizer.setContent(`{${ACCENT_DIM}-fg}${this.getStaticVisualizer()}{/${ACCENT_DIM}-fg}`);
      this.resetBreathing();
    }
    this.screen.render();
  }

  // 截断宽字符（中文=2，英文=1）
  truncate(str, maxWidth) {
    let w = 0, out = '';
    for (const ch of String(str)) {
      const cw = ch.codePointAt(0) > 0x2E80 ? 2 : 1;
      if (w + cw > maxWidth) { out += '…'; break; }
      out += ch; w += cw;
    }
    return out;
  }

  updateNowPlaying(song, autoPlay = false) {
    this.currentSong = song;
    const colW = this.getPlayerInnerW() - 4;
    const name = this.truncate(song.name, colW - 2);
    const artist = song.artist ? this.truncate(song.artist, colW - 2) : '';
    const album  = song.album  ? '  ·  ' + this.truncate(song.album, 12) : '';
    this.components.songName.setContent(
      this.centerPad(`{bold}${name}{/bold}`, colW)
    );
    this.components.songArtist.setContent(
      this.centerPad(`{${MUTED}-fg}${artist}${album}{/${MUTED}-fg}`, colW)
    );
    // 只有明确要求 autoPlay 时才设为播放状态
    // WebSocket state 推送时不自动改状态，避免显示 PLAYING 但没有音频
    if (autoPlay) {
      this.isPlaying = true;
    }
    this.updatePlayStatus();
    this.renderQueue();
  }

  // ── Queue ──────────────────────────────────────────────

  async fetchQueue() {
    try {
      const res = await axios.get('http://localhost:8080/api/playlists/netease-local');
      this.queue = (res.data.songs || []);
      this.renderQueue();
      this.log(`Loaded ${this.queue.length} tracks`, 'success');
    } catch { this.log('Failed to load queue', 'error'); }
  }

  renderQueue() {
    const items = this.queue.slice(0, 200).map((song, i) => {
      const isActive = this.currentSong &&
        (song.id || song.platformId) === (this.currentSong.id || this.currentSong.platformId);
      const prefix = isActive ? `{${ACCENT}-fg}▶{/${ACCENT}-fg} ` : '  ';
      const num    = String(i + 1).padStart(3, ' ');
      const name   = this.truncate(song.name, 14);
      const artist = this.truncate(song.artist || '', 8);
      return `${prefix}{${MUTED}-fg}${num}{/${MUTED}-fg} ${name} {${MUTED}-fg}— ${artist}{/${MUTED}-fg}`;
    });
    this.components.queueBox.setItems(items);
    this.screen.render();
  }

  playQueueItem(index) {
    const song = this.queue[index];
    if (song) {
      this.currentSong = song;
      this.isPlaying = true;
      this.updateNowPlaying(song);
    }
  }

  getRecommendation() { this.playNext(); }

  // ── Chat ───────────────────────────────────────────────

  handleInput(text) {
    if (!text.trim()) return;
    if (text.startsWith('/')) this.handleCommand(text);
    else this.sendChat(text);
  }

  handleCommand(cmd) {
    const parts = cmd.slice(1).split(' ');
    const command = parts[0];
    const args = parts.slice(1).join(' ');
    switch (command) {
      case 'play':    this.searchAndPlay(args); break;
      case 'mood':    this.setMood(args); break;
      case 'weather': this.showWeather(); break;
      case 'skip':    this.playNext(); break;
      case 'like':    this.log('Liked!', 'success'); break;
      case 'tts':     this.toggleTTS(); break;
      case 'help':    this.toggleHelp(); break;
      default: this.log(`Unknown command: /${command}`, 'error');
    }
  }

  async sendChat(message) {
    this.log(message, 'user');
    try {
      const res = await axios.post('http://localhost:8080/api/chat', {
        message, context: { currentSong: this.currentSong }
      });
      const data = res.data;
      if (data.message) this.log(data.message, 'agent');
      if (data.song && data.shouldPlay) setTimeout(() => this.playSong(data.song), 500);
    } catch { this.log('Failed to send message', 'error'); }
  }

  appendChatStream(chunk) {
    if (!this._streamBuffer && !chunk.done) {
      this._streamBuffer = '';
      this.components.chatBox.log(`{${ACCENT}-fg}◈ RadioMind{/${ACCENT}-fg}`);
    }
    if (chunk.text) this._streamBuffer = (this._streamBuffer || '') + chunk.text;
    if (chunk.done && this._streamBuffer) {
      this.components.chatBox.log(`  {${TEXT}-fg}${this._streamBuffer}{/${TEXT}-fg}`);
      this._streamBuffer = null;
      this.screen.render();
    }
  }

  async searchAndPlay(query) {
    try {
      const res = await axios.get(`http://localhost:8080/api/search?q=${encodeURIComponent(query)}`);
      if (res.data.length > 0) this.playSong(res.data[0]);
      else this.log('No songs found', 'error');
    } catch { this.log('Search failed', 'error'); }
  }

  // 检测可用的命令行播放器（优先级：mpv > ffplay > afplay）
  detectPlayer() {
    if (this._playerCmd) return this._playerCmd;
    for (const cmd of ['mpv', 'ffplay', 'afplay']) {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        this._playerCmd = cmd;
        return cmd;
      } catch {}
    }
    return null;
  }

  // 停止当前播放进程
  stopPlayer() {
    if (this._player) {
      try {
        this._player.kill('SIGKILL'); // 强制立即终止
      } catch {}
      this._player = null;
    }
    // 额外保险：kill 所有残留的 mpv 进程
    try {
      const { execSync } = require('child_process');
      execSync('pkill -KILL -f "mpv --no-video" 2>/dev/null || true', { stdio: 'ignore' });
    } catch {}
  }

  // 通过 mpv IPC socket 发送命令
  sendMpvCommand(cmd) {
    if (this._playerCmd !== 'mpv' || !this._mpvSocket) return;
    try {
      const net = require('net');
      const sock = net.createConnection(this._mpvSocket);
      sock.on('connect', () => {
        sock.write(JSON.stringify(cmd) + '\n');
        sock.end();
      });
      sock.on('error', () => {});
    } catch {}
  }

  // 用本地播放器播放 URL
  playWithPlayer(url, songName) {
    this.stopPlayer();
    const cmd = this.detectPlayer();
    if (!cmd) {
      this.log('No audio player found. Install mpv: brew install mpv', 'error');
      return;
    }

    let args;
    if (cmd === 'mpv') {
      this._mpvSocket = `/tmp/radiomind-mpv-${Date.now()}.sock`;
      args = [
        '--no-video', '--really-quiet',
        `--volume=${this.volume}`,
        `--input-ipc-server=${this._mpvSocket}`,
        url
      ];
    } else if (cmd === 'ffplay') {
      args = ['-nodisp', '-autoexit', '-loglevel', 'quiet', url];
    } else {
      this.log('afplay does not support network URLs. Install mpv: brew install mpv', 'error');
      return;
    }

    this._player = spawn(cmd, args, { stdio: 'ignore', detached: false });

    this._player.on('close', (code) => {
      this._player = null;
      if (code === 0 && this.isPlaying) {
        // 播放结束，自动下一首（静默，不打日志）
        this.playNext();
      }
    });

    this._player.on('error', (e) => {
      this.log(`Player error: ${e.message}`, 'error');
      this._player = null;
    });
  }

  async playSong(song) {
    this.currentSong = song;
    this.isPlaying = true;
    this.updateNowPlaying(song, true);
    this.renderQueue();

    // 通知服务端播放（服务端会广播给网页端）
    try {
      const platform = song.platform || 'netease';
      const songId = String(song.id || song.platformId || '');
      const res = await axios.post('http://localhost:8080/api/play', {
        platform, songId, bitrate: 320000
      });
      if (res.data.playUrl) {
        // 本地播放器播放（不打印日志，避免刷屏）
        this.playWithPlayer(res.data.playUrl, song.name);
        // 同时通过 WebSocket 同步网页端
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'play', song: { ...song, playUrl: res.data.playUrl } }));
        }
      } else {
        this.log(`Cannot play: ${song.name} — ${res.data.error || 'no URL'}`, 'error');
        this.isPlaying = false;
        this.updatePlayStatus();
      }
    } catch (e) {
      this.log(`Play error: ${e.message}`, 'error');
    }
  }

  async setMood(mood) {
    try {
      const res = await axios.get(`http://localhost:8080/api/next?mood=${mood}`);
      if (res.data) this.playSong(res.data);
    } catch { this.log('Failed to set mood', 'error'); }
  }

  async showWeather() {
    try {
      const res = await axios.get('http://localhost:8080/api/weather');
      const w = res.data;
      this.log(`Weather: ${w.description || w.condition}, ${w.temperature}°C`, 'info');
    } catch { this.log('Failed to fetch weather', 'error'); }
  }

  toggleTTS() {
    this.ttsEnabled = !this.ttsEnabled;
    this.log(`TTS: ${this.ttsEnabled ? 'ON' : 'OFF'}`, 'info');
  }

  // ── Log ────────────────────────────────────────────────

  log(message, type = 'info') {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    let line;
    switch (type) {
      case 'user':    line = `{${MUTED}-fg}${ts}{/${MUTED}-fg} {${ACCENT}-fg}You{/${ACCENT}-fg}  ${message}`; break;
      case 'agent':   line = `{${MUTED}-fg}${ts}{/${MUTED}-fg} {${ACCENT}-fg}◈ RadioMind{/${ACCENT}-fg}  ${message}`; break;
      case 'success': line = `{${MUTED}-fg}${ts}{/${MUTED}-fg} {${SUCCESS}-fg}✓{/${SUCCESS}-fg}  ${message}`; break;
      case 'error':   line = `{${MUTED}-fg}${ts}{/${MUTED}-fg} {${ERROR}-fg}✗{/${ERROR}-fg}  ${message}`; break;
      case 'system':  line = `{${MUTED}-fg}${ts}  ${message}{/${MUTED}-fg}`; break;
      default:        line = `{${MUTED}-fg}${ts}{/${MUTED}-fg}  ${message}`;
    }
    this.components.chatBox.log(line);
    this.screen.render();
  }

  // ── Help ───────────────────────────────────────────────

  toggleHelp() {
    const box = this.components.helpBox;
    box.hidden = !box.hidden;
    if (!box.hidden) {
      // 18行内容 + top:1 + 上下边框 = 21行，留2行余量
      const contentH = 23;
      const maxH = this.screen.height - 2; // 留出外框色条各1行
      box.height = Math.min(contentH, maxH);
      // 确保 top + height 不超出屏幕
      const idealTop = Math.floor((this.screen.height - box.height) / 2);
      box.top = Math.max(1, Math.min(idealTop, this.screen.height - box.height - 1));
      box.focus();
    } else {
      this.screen.focusPop();
    }
    this.screen.render();
  }

  // ── Cleanup ────────────────────────────────────────────

  cleanup() {
    this.stopPlayer();
    if (this.visualizerInterval) clearInterval(this.visualizerInterval);
    if (this.ws) this.ws.close();
    this.screen.destroy();
  }
}

const ui = new TerminalUI();

process.on('uncaughtException', (err) => { console.error(err.message); process.exit(1); });
process.on('SIGINT', () => { ui.cleanup(); process.exit(0); });
