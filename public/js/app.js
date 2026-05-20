/**
 * RadioMind - AI Music Agent Frontend
 * 语音交互、TTS播报、实时聊天
 */

class MusicAgentApp {
  constructor() {
    this.ws = null;
    this.audio = document.getElementById('audio-player');
    this.currentSong = null;
    this.isPlaying = false;
    this.queue = [];
    this.ttsEnabled = true;
    this.currentTheme = 'dark';
    this.recognition = null;

    // 分页相关
    this.pageSize = 5;
    this.currentPage = 0;
    this.isLoadingMore = false;
    this.hasMore = true;

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupWebSocket();
    this.setupSpeechRecognition();
    this.updateTime();
    this.loadQueue();
    this.loadAgentProfile();  // 加载 Agent 个人资料

    // 每秒更新时间
    setInterval(() => this.updateTime(), 1000);

    // 初始化音频音量
    this.audio.volume = 0.7;

    // 初始化音频可视化
    this.setupAudioVisualizer();

    console.log('🎵 RadioMind initialized');
  }

  // ===== WebSocket =====

  setupWebSocket() {
    const wsUrl = `ws://${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.addSystemMessage('Connected to RadioMind server');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected, retrying...');
      setTimeout(() => this.setupWebSocket(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'state':
        if (data.data) this.updateNowPlaying(data.data);
        break;

      case 'now_playing':
        this.updateNowPlaying(data.data);
        break;

      case 'chat_stream':
        this.appendChatChunk(data.data);
        break;

      case 'recommendation':
        if (data.data) this.playSong(data.data);
        break;

      case 'tts':
        if (this.ttsEnabled && data.audioUrl) {
          this.playTTS(data.audioUrl, null);
        }
        break;
    }
  }

  sendWebSocketMessage(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  // ===== Event Listeners =====

  setupEventListeners() {
    // 主题切换
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const theme = e.target.dataset.theme;
        this.switchTheme(theme);
      });
    });

    // 播放控制
    document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-prev').addEventListener('click', () => this.playPrevious());
    document.getElementById('btn-next').addEventListener('click', () => this.playNext());
    document.getElementById('btn-stop').addEventListener('click', () => this.stop());
    document.getElementById('btn-fav').addEventListener('click', () => this.toggleFavorite());

    // 音量
    document.getElementById('volume-slider').addEventListener('input', (e) => {
      this.audio.volume = e.target.value / 100;
    });

    // 进度条
    document.getElementById('progress-bar').addEventListener('click', (e) => this.seek(e));

    // 音频事件
    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.onSongEnded());
    this.audio.addEventListener('loadedmetadata', () => this.updateDuration());

    // 聊天
    document.getElementById('btn-send').addEventListener('click', () => this.sendChat());
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // 语音输入
    document.getElementById('btn-voice-input').addEventListener('click', () => this.startVoiceInput());
    document.getElementById('btn-cancel-voice').addEventListener('click', () => this.cancelVoiceInput());

    // TTS 开关
    document.getElementById('btn-tts-toggle').addEventListener('click', () => this.toggleTTS());

    // Agent 头像/资料
    document.getElementById('btn-agent-profile').addEventListener('click', () => this.openAgentProfile());
    document.getElementById('btn-close-profile').addEventListener('click', () => this.closeAgentProfile());

    // 登录按钮
    document.getElementById('btn-login').addEventListener('click', () => {
      this.addAgentMessage('Login feature coming soon!');
    });
  }

  // ===== Speech Recognition =====

  setupSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'zh-CN';
      this.recognition.continuous = false;
      this.recognition.interimResults = false;

      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById('chat-input').value = transcript;
        this.hideVoiceModal();
        this.sendChat();
      };

      this.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        this.hideVoiceModal();
        this.addAgentMessage('Sorry, I didn\'t catch that. Could you try again?');
      };

      this.recognition.onend = () => {
        this.hideVoiceModal();
      };
    }
  }

  startVoiceInput() {
    if (!this.recognition) {
      this.addAgentMessage('Voice input is not supported in your browser.');
      return;
    }

    document.getElementById('voice-modal').classList.add('active');
    this.recognition.start();
  }

  cancelVoiceInput() {
    if (this.recognition) {
      this.recognition.stop();
    }
    this.hideVoiceModal();
  }

  hideVoiceModal() {
    document.getElementById('voice-modal').classList.remove('active');
  }

  // ===== Time Display =====

  updateTime() {
    const now = new Date();

    // 像素风格时间 HH:MM
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('pixel-time').textContent = `${hours}:${minutes}`;

    // 星期
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    document.getElementById('weekday').textContent = weekdays[now.getDay()];

    // 日期 DD MMM YYYY
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const day = String(now.getDate()).padStart(2, '0');
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    document.getElementById('date').textContent = `${day} ${month} ${year}`;
  }

  // ===== Theme =====

  switchTheme(theme) {
    this.currentTheme = theme;
    document.body.setAttribute('data-theme', theme);

    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    // 保存偏好
    localStorage.setItem('theme', theme);
  }

  // ===== Player =====

  async playSong(song) {
    if (!song) {
      console.error('playSong: 没有提供歌曲');
      return;
    }

    this.currentSong = song;

    // 获取歌曲 ID 和平台
    const songId = song.id || song.platformId;
    const platform = song.platform || 'netease';

    console.log('播放歌曲:', song.name, 'ID:', songId, '平台:', platform);

    try {
      // 使用新的播放接口，支持多平台
      const response = await fetch('/api/play', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          platform,
          songId: String(songId),
          bitrate: 320000
        })
      });

      const data = await response.json();

      if (data.playUrl) {
        this.audio.src = data.playUrl;
        this.audio.play();
        this.isPlaying = true;
        this.updatePlayButton();
        this.updateNowPlaying(song);
        this.sendWebSocketMessage('play', { song });
      } else {
        console.error('无法获取播放链接:', data.error || '未知错误');
        this.addAgentMessage(`抱歉，无法播放《${song.name}》，可能是版权限制。`);
      }
    } catch (error) {
      console.error('Play error:', error);
      this.addAgentMessage('播放出错了，请重试。');
    }
  }

  togglePlay() {
    if (!this.audio.src) {
      this.playNext();
      return;
    }

    if (this.isPlaying) {
      this.audio.pause();
      this.stopVisualizer();
    } else {
      this.audio.play();
      this.startVisualizer();
    }
    this.isPlaying = !this.isPlaying;
    this.updatePlayButton();
  }

  updatePlayButton() {
    const btn = document.getElementById('btn-play');
    btn.textContent = this.isPlaying ? '⏸' : '▶';

    // 可视化动画
    const visualizer = document.querySelector('.bar-visualizer');
    if (visualizer) {
      visualizer.style.display = this.isPlaying ? 'flex' : 'none';
    }

    // 呼吸灯效果 - 应用到整个应用外围
    const app = document.querySelector('.app');
    if (app) {
      app.classList.toggle('playing', this.isPlaying);
    }

    // 音频可视化
    if (this.isPlaying) {
      this.startVisualizer();
    } else {
      this.stopVisualizer();
    }
  }

  updateNowPlaying(song) {
    document.getElementById('track-name').textContent = `${song.name} - ${song.artist}`;
    document.getElementById('track-status').textContent = this.isPlaying ? 'PLAYING' : 'PAUSED';

    // 获取当前歌曲 ID
    const currentSongId = song.id || song.platformId;

    // 高亮队列中当前歌曲
    document.querySelectorAll('.queue-item').forEach((item) => {
      const itemSongId = item.dataset.songId;
      const isActive = itemSongId === String(currentSongId);
      item.classList.toggle('active', isActive);

      // 更新播放图标
      const playIcon = item.querySelector('.queue-item-play');
      if (isActive) {
        if (!playIcon) {
          const numberSpan = item.querySelector('.queue-item-number');
          if (numberSpan) {
            numberSpan.outerHTML = '<span class="queue-item-play">▶</span>';
          }
        }
      } else if (playIcon) {
        const index = item.dataset.index;
        playIcon.outerHTML = `<span class="queue-item-number">${parseInt(index) + 1}</span>`;
      }
    });
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.isPlaying = false;
    this.updatePlayButton();
  }

  async playNext() {
    // 如果队列中有下一首，直接播放
    if (this.currentSong && this.queue.length > 0) {
      const currentId = this.currentSong.id || this.currentSong.platformId;
      const currentIndex = this.queue.findIndex(s =>
        (s.id || s.platformId) === currentId
      );

      if (currentIndex >= 0 && currentIndex < this.queue.length - 1) {
        this.playSong(this.queue[currentIndex + 1]);
        return;
      }
    }

    // 否则从服务器获取推荐
    try {
      const response = await fetch('/api/next');
      const song = await response.json();
      if (song) this.playSong(song);
    } catch (error) {
      console.error('Next error:', error);
    }
  }

  playPrevious() {
    if (this.audio.currentTime > 5) {
      this.audio.currentTime = 0;
    } else {
      // 播放历史上一首
      this.addAgentMessage('Playing previous track...');
    }
  }

  onSongEnded() {
    this.playNext();
  }

  toggleFavorite() {
    const btn = document.getElementById('btn-fav');
    btn.textContent = btn.textContent === '♡' ? '♥' : '♡';
    btn.style.color = btn.textContent === '♥' ? 'var(--accent)' : '';
  }

  // ===== Audio Visualizer =====

  setupAudioVisualizer() {
    this.canvas = document.getElementById('audio-visualizer');
    if (!this.canvas) return;

    this.canvasCtx = this.canvas.getContext('2d');
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.animationId = null;

    // 动态匹配实际显示尺寸，避免粒子只渲染在局部
    const resizeCanvas = () => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvasCtx.scale(dpr, dpr);
      this.drawStaticVisualizer();
    };

    // 初始化时设置尺寸
    if (this.canvas.getBoundingClientRect().width > 0) {
      resizeCanvas();
    } else {
      // 等待布局完成
      requestAnimationFrame(resizeCanvas);
    }

    // 窗口缩放时重新适配
    window.addEventListener('resize', resizeCanvas);
  }

  initAudioContext() {
    if (this.audioContext) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();

      // 配置分析器
      this.analyser.fftSize = 64; // 较小的值 = 更宽的条形
      this.analyser.smoothingTimeConstant = 0.8;

      // 创建媒体源
      const source = this.audioContext.createMediaElementSource(this.audio);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // 准备数据数组
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      console.log('🎵 音频可视化已初始化');
    } catch (error) {
      console.error('音频可视化初始化失败:', error);
    }
  }

  startVisualizer() {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.drawVisualizer();
  }

  stopVisualizer() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    // 绘制静态效果
    this.drawStaticVisualizer();
  }

  drawVisualizer() {
    if (!this.analyser || !this.canvasCtx) return;

    this.animationId = requestAnimationFrame(() => this.drawVisualizer());
    this.analyser.getByteFrequencyData(this.dataArray);

    const canvas = this.canvas;
    const ctx = this.canvasCtx;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const accentColor = getComputedStyle(document.body)
      .getPropertyValue('--accent').trim() || '#5dade2';

    // 粒子参数：根据容器宽度动态计算列数，铺满全宽
    const particleSize = 4;     // 小方块边长
    const colGap = 3;           // 列间距
    const rowGap = 2;           // 行间距
    const colStep = particleSize + colGap;
    const rowStep = particleSize + rowGap;
    const maxRows = Math.floor(height / rowStep);
    const colCount = Math.floor((width + colGap) / colStep);
    const totalW = colCount * colStep - colGap;
    const offsetX = (width - totalW) / 2;

    for (let i = 0; i < colCount; i++) {
      const dataIndex = Math.floor((i / colCount) * (this.dataArray.length / 2)) + 2;
      const value = this.dataArray[dataIndex] || 0;
      const percent = value / 255;
      const activeRows = Math.max(1, Math.floor(percent * maxRows));

      const x = offsetX + i * colStep;

      for (let r = 0; r < activeRows; r++) {
        // 从底部往上堆叠
        const y = height - (r + 1) * rowStep + rowGap;
        // 越靠顶越透明，形成渐隐粒子感
        const alpha = r === activeRows - 1 ? 0.5 : (0.6 + 0.4 * (r / maxRows));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = accentColor;
        ctx.fillRect(x, y, particleSize, particleSize);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawStaticVisualizer() {
    if (!this.canvas || !this.canvasCtx) return;

    const canvas = this.canvas;
    const ctx = this.canvasCtx;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const accentColor = getComputedStyle(document.body)
      .getPropertyValue('--accent').trim() || '#5dade2';

    // 静止时：根据容器宽度动态计算列数
    const particleSize = 4;
    const colGap = 3;
    const rowGap = 2;
    const colStep = particleSize + colGap;
    const colCount = Math.floor((width + colGap) / colStep);
    const totalW = colCount * colStep - colGap;
    const offsetX = (width - totalW) / 2;

    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < colCount; i++) {
      const x = offsetX + i * colStep;
      const y = height - particleSize - rowGap;
      ctx.fillRect(x, y, particleSize, particleSize);
    }
    ctx.globalAlpha = 1;
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // ===== Progress =====

  updateProgress() {
    if (!this.audio.duration) return;

    const progress = (this.audio.currentTime / this.audio.duration) * 100;
    document.getElementById('progress-fill').style.width = `${progress}%`;
    document.getElementById('time-current').textContent = this.formatTime(this.audio.currentTime);
  }

  updateDuration() {
    document.getElementById('time-total').textContent = this.formatTime(this.audio.duration);
  }

  seek(event) {
    if (!this.audio.duration) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    this.audio.currentTime = percent * this.audio.duration;
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // ===== Queue =====

  async loadQueue() {
    try {
      // 重置分页状态
      this.currentPage = 0;
      this.hasMore = true;

      // 首先尝试加载网易云歌单
      let response = await fetch('/api/playlists/netease-local');
      let data = await response.json();

      if (data.songs && data.songs.length > 0) {
        this.queue = data.songs;
      } else {
        // 如果没有本地歌单，获取智能推荐
        response = await fetch('/api/recommendations?count=10');
        data = await response.json();
        this.queue = data.songs || [];
      }

      this.renderQueue();

      // 如果有歌曲，自动播放第一首
      if (this.queue.length > 0 && !this.currentSong) {
        this.playSong(this.queue[0]);
      }
    } catch (error) {
      console.error('Load queue error:', error);
    }
  }

  renderQueue() {
    const container = document.getElementById('queue-list');
    document.getElementById('queue-count').textContent = this.queue.length;

    // 一次性渲染全部歌曲，固定高度容器负责滚动
    container.innerHTML = this.queue.map((song, index) => {
      const songId = song.id || song.platformId;
      const currentSongId = this.currentSong?.id || this.currentSong?.platformId;
      const isActive = songId === currentSongId;

      return `
      <div class="queue-item ${isActive ? 'active' : ''}" data-index="${index}" data-song-id="${songId}">
        <span class="queue-item-number">${index + 1}</span>
        ${isActive ? '<span class="queue-item-play">▶</span>' : ''}
        <div class="queue-item-info">
          <div class="queue-item-title">${this.escapeHtml(song.name)}</div>
          <div class="queue-item-artist">${this.escapeHtml(song.artist)}</div>
        </div>
        <span class="queue-item-duration">${this.formatTime((song.duration || 0) / 1000)}</span>
      </div>
    `}).join('');

    container.querySelectorAll('.queue-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        const song = this.queue[index];
        if (song) this.playSong(song);
      });
    });
  }

  // ===== Chat =====

  async sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    // 添加用户消息
    this.addUserMessage(message);
    input.value = '';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'default'
        },
        body: JSON.stringify({
          message,
          context: { currentSong: this.currentSong }
        })
      });

      const data = await response.json();
      this.handleChatResponse(data);
    } catch (error) {
      console.error('Chat error:', error);
      this.addAgentMessage('Sorry, I\'m having trouble connecting. Please try again.');
    }
  }

  handleChatResponse(data) {
    switch (data.type) {
      case 'ai_recommendation':
        // 如果有歌曲，以卡片形式展示
        if (data.song) {
          this.addAgentMessage(data.message, {
            recommendations: [data.song]
          });
          if (data.shouldPlay) {
            setTimeout(() => this.playSong(data.song), 500);
          }
        } else {
          this.addAgentMessage(data.message);
        }
        break;

      case 'search_result':
        // 搜索结果以卡片形式展示
        if (data.found && data.songs) {
          this.addAgentMessage(data.message, {
            recommendations: data.songs.slice(0, 5)
          });
        } else {
          this.addAgentMessage(data.message);
        }
        break;

      default:
        this.addAgentMessage(data.message);
    }
  }

  // 获取批量推荐
  async fetchRecommendations(count = 5) {
    try {
      const response = await fetch(`/api/recommendations?count=${count}`);
      const data = await response.json();
      if (data.songs && data.songs.length > 0) {
        this.addAgentMessage('Here are some songs I think you\'ll love:', {
          recommendations: data.songs
        });
      }
    } catch (error) {
      console.error('Fetch recommendations error:', error);
    }
  }

  addUserMessage(text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message user-message';
    div.innerHTML = `<div class="message-content"><p>${this.escapeHtml(text)}</p></div>`;
    container.appendChild(div);
    this.scrollToBottom();
  }

  addAgentMessage(text, options = {}) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message agent-message';

    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // 将 Markdown 转换为 HTML
    const parseMarkdown = (content) => {
      if (!content) return '';
      if (typeof marked !== 'undefined') {
        return marked.parse(content, { breaks: true, gfm: true });
      }
      return this.escapeHtml(content);
    };

    // 如果有推荐歌曲列表
    if (options.recommendations && options.recommendations.length > 0) {
      const cardsHtml = options.recommendations.map((song, index) => `
        <div class="song-card ${index === 0 ? 'active' : ''}" data-song-id="${song.id}">
          <div class="song-card-icon">${index === 0 ? '★' : '♪'}</div>
          <div class="song-card-info">
            <div class="song-card-title">${this.escapeHtml(song.name)}</div>
            <div class="song-card-artist">${this.escapeHtml(song.artist)}</div>
          </div>
          <div class="song-card-play">▶</div>
        </div>
      `).join('');

      div.innerHTML = `
        <div class="message-content">
          <div class="markdown-content">${parseMarkdown(text)}</div>
          <div class="song-recommendations">
            ${cardsHtml}
          </div>
        </div>
        <div class="message-meta">
          <span class="message-time">${time}</span>
          <button class="btn-replay-tts" title="Play voice">🔊</button>
        </div>
      `;

      // 绑定歌曲卡片点击事件
      div.querySelectorAll('.song-card').forEach(card => {
        card.addEventListener('click', () => {
          const songId = card.dataset.songId;
          const song = options.recommendations.find(s => String(s.id) === songId);
          if (song) {
            this.playSong(song);
            // 更新激活状态
            div.querySelectorAll('.song-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
          }
        });
      });
    } else {
      div.innerHTML = `
        <div class="message-content"><div class="markdown-content">${parseMarkdown(text)}</div></div>
        <div class="message-meta">
          <span class="message-time">${time}</span>
          <button class="btn-replay-tts" title="Play voice">🔊</button>
        </div>
      `;
    }

    // TTS 重播按钮
    const replayBtn = div.querySelector('.btn-replay-tts');
    replayBtn.addEventListener('click', () => {
      this.speakText(text, replayBtn);
    });

    container.appendChild(div);
    this.scrollToBottom();

    // 自动 TTS
    if (this.ttsEnabled && options.tts !== false) {
      this.speakText(text, replayBtn);
    }
  }

  addSystemMessage(text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message system-message';
    div.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 8px;">${text}</div>`;
    container.appendChild(div);
    this.scrollToBottom();
  }

  appendChatChunk(chunk) {
    // 流式响应处理
    const container = document.getElementById('chat-messages');
    let lastMessage = container.lastElementChild;

    if (!lastMessage?.classList.contains('agent-message') || lastMessage.querySelector('.message-meta')) {
      this.addAgentMessage('', { tts: false });
      lastMessage = container.lastElementChild;
    }

    const contentDiv = lastMessage.querySelector('.message-content .markdown-content') ||
                       lastMessage.querySelector('.message-content');

    // 累积原始文本用于 TTS
    if (!contentDiv.dataset.rawText) {
      contentDiv.dataset.rawText = '';
    }
    contentDiv.dataset.rawText += chunk.text || '';

    // 流式过程中显示纯文本，完成后渲染 Markdown
    if (!chunk.done) {
      // 流式中：直接追加文本，不解析 Markdown
      const currentText = contentDiv.textContent || '';
      contentDiv.textContent = contentDiv.dataset.rawText;
    } else {
      // 流完成：解析 Markdown
      const rawText = contentDiv.dataset.rawText;
      if (typeof marked !== 'undefined') {
        contentDiv.innerHTML = marked.parse(rawText, { breaks: true, gfm: true });
      } else {
        contentDiv.textContent = rawText;
      }

      // 添加时间戳和重播按钮
      const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.innerHTML = `
        <span class="message-time">${time}</span>
        <button class="btn-replay-tts" title="Play voice">🔊</button>
      `;
      const replayBtn = meta.querySelector('.btn-replay-tts');
      replayBtn.addEventListener('click', () => {
        this.speakText(rawText, replayBtn);
      });
      lastMessage.appendChild(meta);

      this.scrollToBottom();

      // TTS 播报完整消息
      if (this.ttsEnabled) {
        this.speakText(rawText, replayBtn);
      }
    }

    this.scrollToBottom();
  }

  scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  // ===== TTS =====

  toggleTTS() {
    this.ttsEnabled = !this.ttsEnabled;
    document.getElementById('btn-tts-toggle').classList.toggle('active', this.ttsEnabled);

    if (this.ttsEnabled) {
      this.addAgentMessage('Voice announcements enabled!', { tts: false });
    }
  }

  async speakSongIntro(song) {
    const intro = `Now playing ${song.name} by ${song.artist}. ${song.reason || ''}`;
    await this.speakText(intro, null);
  }

  async speakText(text, buttonEl = null) {
    if (!this.ttsEnabled) return;

    // 显示波形动画
    if (buttonEl) {
      this.showSpeakingWave(buttonEl);
    }

    // 优先使用后端 TTS
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const data = await response.json();

      if (data.available && data.url) {
        await this.playTTSWithWave(data.url, buttonEl);
        return;
      }
    } catch (e) {
      // 后端 TTS 失败，使用浏览器 TTS
    }

    // 浏览器内置 TTS
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;

      utterance.onend = () => {
        this.hideSpeakingWave(buttonEl);
      };

      utterance.onerror = () => {
        this.hideSpeakingWave(buttonEl);
      };

      speechSynthesis.speak(utterance);
    } else {
      this.hideSpeakingWave(buttonEl);
    }
  }

  // 显示说话波形动画
  showSpeakingWave(buttonEl) {
    if (!buttonEl) return;
    buttonEl.disabled = true;
    buttonEl.dataset.originalContent = buttonEl.innerHTML;
    buttonEl.innerHTML = `
      <div class="speaking-waveform">
        <span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span>
      </div>
    `;
  }

  // 隐藏说话波形动画
  hideSpeakingWave(buttonEl) {
    if (!buttonEl) return;
    buttonEl.disabled = false;
    if (buttonEl.dataset.originalContent) {
      buttonEl.innerHTML = buttonEl.dataset.originalContent;
    } else {
      buttonEl.innerHTML = '🔊';
    }
  }

  // 播放TTS并显示波形
  playTTSWithWave(url, buttonEl) {
    return new Promise((resolve) => {
      const ttsAudio = new Audio(url);
      ttsAudio.volume = 0.8;

      ttsAudio.onended = () => {
        this.hideSpeakingWave(buttonEl);
        resolve();
      };

      ttsAudio.onerror = () => {
        this.hideSpeakingWave(buttonEl);
        resolve();
      };

      ttsAudio.onpause = () => {
        this.hideSpeakingWave(buttonEl);
      };

      ttsAudio.play();
    });
  }

  playTTS(url, buttonEl = null) {
    return this.playTTSWithWave(url, buttonEl);
  }

  // ===== Agent Profile =====

  async loadAgentProfile() {
    try {
      const response = await fetch('/api/agent/profile');
      const profile = await response.json();

      // 更新 Agent 名字
      document.querySelectorAll('.agent-name, .agent-profile-name, .logo-text').forEach(el => {
        if (el && profile.name) {
          el.textContent = profile.name;
        }
      });

      // 更新签名
      const taglineEl = document.querySelector('.agent-tagline');
      if (taglineEl && profile.tagline) {
        taglineEl.textContent = profile.tagline;
      }

      // 更新 Bio
      const bioEl = document.querySelector('.agent-bio');
      if (bioEl && profile.bio) {
        bioEl.innerHTML = profile.bio.map(line => `<p>${this.escapeHtml(line)}</p>`).join('');
      }

      // 更新标签云
      const genresEl = document.getElementById('agent-genres');
      if (genresEl && profile.tags) {
        genresEl.innerHTML = profile.tags.map(tag =>
          `<span class="genre-tag">${this.escapeHtml(tag)}</span>`
        ).join('');
      }

      // 更新统计数据
      const playsEl = document.getElementById('total-plays');
      if (playsEl && profile.stats?.totalPlays !== undefined) {
        playsEl.textContent = profile.stats.totalPlays;
      }

      const genresStatEl = document.getElementById('genres-stat');
      if (genresStatEl && profile.stats?.genres !== undefined) {
        genresStatEl.textContent = profile.stats.genres;
      }

    } catch (error) {
      console.error('Failed to load agent profile:', error);
    }
  }

  openAgentProfile() {
    // 打开时重新加载最新数据
    this.loadAgentProfile();
    document.getElementById('agent-profile-modal').classList.add('active');

    // 设置名字编辑事件
    const editBtn = document.getElementById('btn-edit-name');
    const saveBtn = document.getElementById('btn-save-name');
    const nameInput = document.getElementById('agent-name-input');
    const nameDisplay = document.querySelector('.agent-profile-name');

    if (editBtn) {
      editBtn.addEventListener('click', () => {
        nameDisplay.classList.add('hidden');
        nameInput.classList.remove('hidden');
        nameInput.value = nameDisplay.textContent;
        editBtn.classList.add('hidden');
        saveBtn.classList.remove('hidden');
        nameInput.focus();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        if (newName) {
          await this.updateAgentName(newName);
          nameDisplay.textContent = newName;
        }
        nameDisplay.classList.remove('hidden');
        nameInput.classList.add('hidden');
        editBtn.classList.remove('hidden');
        saveBtn.classList.add('hidden');
      });
    }

    // 回车保存
    if (nameInput) {
      nameInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          saveBtn.click();
        }
      });
    }
  }

  async updateAgentName(name) {
    try {
      const response = await fetch('/api/agent/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      if (response.ok) {
        // 更新所有显示名字的元素
        document.querySelectorAll('.agent-name, .agent-profile-name, .logo-text').forEach(el => {
          el.textContent = name;
        });
        this.log(`Agent renamed to: ${name}`, 'success');
      }
    } catch (error) {
      console.error('Failed to update agent name:', error);
    }
  }

  closeAgentProfile() {
    document.getElementById('agent-profile-modal').classList.remove('active');
  }

  // ===== Utils =====

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.app = new MusicAgentApp();
});

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}
