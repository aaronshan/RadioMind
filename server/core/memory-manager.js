/**
 * MemoryManager - 持久化记忆系统
 * L1: MEMORY.md 常青文件，每次会话全文注入
 * L2: user/memory/YYYY-MM-DD.md 每日日志，加载今天+昨天
 * L3: SQLite FTS5 历史检索，时间衰减排序
 *
 * 参考 OpenClaw 记忆系统设计
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

class MemoryManager {
  constructor(userDir, claudeAdapter) {
    this.userDir = userDir;
    this.claudeAdapter = claudeAdapter;
    this.memoryDir = path.join(userDir, 'memory');
    this.dbPath = path.join(userDir, 'memory.db');
    this.memoryMdPath = path.join(userDir, 'MEMORY.md');
    this.db = null;
    this.ready = false;

    // 常青文件列表（每次全文索引，不参与时间衰减）
    this.evergreenFiles = [
      path.join(userDir, 'MEMORY.md'),
      path.join(userDir, 'taste.md'),
      path.join(userDir, 'routines.md'),
      path.join(userDir, 'mood-rules.md'),
    ];
  }

  // ── 初始化 ──

  async initDB() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }

    await this._openDB();
    await this._createTables();

    // 索引常青文件
    for (const filePath of this.evergreenFiles) {
      if (fs.existsSync(filePath)) {
        await this.indexMemoryFile(filePath).catch(e =>
          console.warn(`[MemoryManager] 索引常青文件失败 ${filePath}: ${e.message}`)
        );
      }
    }

    this.ready = true;
    console.log('[MemoryManager] 记忆系统已就绪');
  }

  _openDB() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async _createTables() {
    await this._run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        file_path,
        file_type,
        date_str,
        section_title,
        tokenize = 'unicode61 remove_diacritics 2'
      )
    `);

    await this._run(`
      CREATE TABLE IF NOT EXISTS memory_meta (
        rowid      INTEGER PRIMARY KEY,
        file_path  TEXT NOT NULL,
        date_epoch INTEGER NOT NULL,
        file_type  TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      )
    `);

    await this._run(`
      CREATE INDEX IF NOT EXISTS idx_meta_date ON memory_meta(date_epoch DESC)
    `);

    await this._run(`
      CREATE INDEX IF NOT EXISTS idx_meta_path ON memory_meta(file_path)
    `);

    await this._run(`
      CREATE TABLE IF NOT EXISTS memory_config (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  }

  // ── 写入 ──

  /**
   * 实时追加原始消息到当日日志（同步写入，不依赖 Claude，保证不丢失）
   * 仅记录 user/assistant 角色的消息
   */
  appendRaw(role, content) {
    if (role !== 'user' && role !== 'assistant') return;
    if (!this.ready) return;

    const filePath = this.getDailyLogPath(this.getDateStr());
    const timeStr = new Date().toTimeString().slice(0, 5);
    const speaker = role === 'user' ? '👤 用户' : '🎵 RadioMind';
    const line = `\n[${timeStr}] **${speaker}**: ${content.slice(0, 500)}`;

    try {
      fs.appendFileSync(filePath, line, 'utf8');
    } catch (e) {
      console.warn('[MemoryManager] appendRaw 写入失败:', e.message);
    }
  }

  async writeDaily(content, date = new Date()) {
    const dateStr = this.getDateStr(date);
    const filePath = this.getDailyLogPath(dateStr);
    const timeStr = date.toTimeString().slice(0, 5);

    const entry = `\n\n---\n\n## ${timeStr} 摘要\n\n${content.trim()}\n`;

    fs.appendFileSync(filePath, entry, 'utf8');

    // 重新索引该文件
    await this.indexMemoryFile(filePath).catch(e =>
      console.warn(`[MemoryManager] 索引每日日志失败: ${e.message}`)
    );

    console.log(`[MemoryManager] 写入摘要: ${path.basename(filePath)}`);
    return filePath;
  }

  async flushSession(messages, force = false) {
    if (!this.claudeAdapter) {
      console.warn('[MemoryManager] 无 claudeAdapter，跳过 flush');
      return null;
    }

    // 只取 user/assistant 消息
    const dialog = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? '用户' : 'RadioMind'}: ${m.content.slice(0, 400)}`)
      .join('\n');

    if (dialog.trim().length < 50 && !force) {
      return null;
    }

    const prompt = `请用中文分析以下 RadioMind 音乐对话，输出 JSON 格式：

{
  "summary": "对话摘要（200字以内，要点列表）",
  "preferences": ["用户明确表达的新音乐偏好，每条一句话，如：喜欢周杰伦的慢歌", "不喜欢电子舞曲"]
}

规则：
- summary：记录喜好/推荐反应/心情/重要事件，忽略闲聊
- preferences：只记录本次对话中新出现的、明确的偏好，没有则为空数组 []

对话记录：
${dialog}`;

    try {
      const response = await this.claudeAdapter.chat({
        system: '你是记忆整理助手，严格按要求输出 JSON，不加任何额外说明。',
        history: [],
        userMessage: prompt
      });

      const raw = response.text?.trim();
      if (!raw || raw.length < 10) return null;

      // 解析 JSON 响应
      let parsed = null;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        // JSON 解析失败，降级为纯文本摘要
        parsed = { summary: raw, preferences: [] };
      }

      if (!parsed) return null;

      // 写入每日日志（L2）
      if (parsed.summary) {
        await this.writeDaily(parsed.summary);
      }

      // 有新偏好 → 追加到 MEMORY.md（L1）
      if (parsed.preferences && parsed.preferences.length > 0) {
        await this.appendPreferencesToMemory(parsed.preferences);
      }

      return parsed.summary || null;
    } catch (e) {
      console.error('[MemoryManager] 生成摘要失败:', e.message);
    }

    return null;
  }

  /**
   * 将新偏好追加到 MEMORY.md 的"重要记忆片段"区块
   */
  async appendPreferencesToMemory(preferences) {
    if (!preferences || preferences.length === 0) return;

    try {
      const date = this.getDateStr();
      const lines = preferences.map(p => `- [${date}] ${p}`).join('\n');
      const entry = `\n${lines}`;

      // 追加到 MEMORY.md 末尾
      fs.appendFileSync(this.memoryMdPath, entry, 'utf8');

      // 重新索引 MEMORY.md
      await this.indexMemoryFile(this.memoryMdPath).catch(() => {});

      console.log(`[MemoryManager] 偏好已写入 MEMORY.md: ${preferences.length} 条`);
    } catch (e) {
      console.error('[MemoryManager] 写入 MEMORY.md 失败:', e.message);
    }
  }

  // ── 检索 ──

  async search(query, limit = 5, options = {}) {
    if (!this.ready || !query?.trim()) return [];

    try {
      // 预处理 query：去除常见停用词，截断超长输入
      const cleanQuery = query
        .replace(/[的了吗呢啊哦嗯吧哈呀]/g, ' ')
        .trim()
        .slice(0, 100);

      if (!cleanQuery) return [];

      // FTS5 MATCH 查询，JOIN memory_meta 获取时间信息
      const rows = await this._all(`
        SELECT
          f.content,
          f.file_path,
          f.file_type,
          f.date_str,
          f.section_title,
          snippet(memory_fts, 0, '<b>', '</b>', '...', 32) AS snippet,
          rank,
          m.date_epoch
        FROM memory_fts f
        JOIN memory_meta m ON f.rowid = m.rowid
        WHERE memory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `, [cleanQuery, limit * 4]); // 多取一些用于衰减重排

      if (rows.length === 0) return [];

      const now = Date.now() / 1000;

      // 时间衰减加权排序
      const scored = rows.map(row => {
        const isEvergreen = row.file_type === 'evergreen';
        const daysAgo = isEvergreen ? 0 : Math.max(0, (now - row.date_epoch) / 86400);
        const decay = Math.exp(-0.01 * daysAgo);
        // FTS5 rank 是负数，越小越相关
        const relevance = row.rank ? 1 / (1 + Math.abs(row.rank)) : 0.5;
        const score = relevance * decay;
        return { ...row, score };
      });

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ content, file_path, file_type, date_str, section_title, snippet, score }) => ({
          content: content.slice(0, 200),
          file_path,
          file_type,
          date_str,
          section_title,
          snippet,
          score
        }));

    } catch (e) {
      console.error('[MemoryManager] search 失败:', e.message);
      return [];
    }
  }

  async loadHotMemory() {
    const result = { l1: '', l2: '' };

    // L1: MEMORY.md 常青文件
    if (fs.existsSync(this.memoryMdPath)) {
      try {
        result.l1 = fs.readFileSync(this.memoryMdPath, 'utf8').trim();
      } catch (e) {
        console.warn('[MemoryManager] 读取 MEMORY.md 失败:', e.message);
      }
    }

    // L2: 今天 + 昨天的每日日志
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const parts = [];
    for (const date of [today, yesterday]) {
      const dateStr = this.getDateStr(date);
      const filePath = this.getDailyLogPath(dateStr);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8').trim();
          if (content) {
            parts.push(`### ${dateStr}\n${content}`);
          }
        } catch (e) {
          console.warn(`[MemoryManager] 读取日志失败 ${dateStr}: ${e.message}`);
        }
      }
    }
    result.l2 = parts.join('\n\n');

    return result;
  }

  // ── 索引维护 ──

  async indexMemoryFile(filePath) {
    if (!this.db) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const isEvergreen = this.evergreenFiles.includes(filePath) ||
      !filePath.includes(path.sep + 'memory' + path.sep);

    const fileType = isEvergreen ? 'evergreen' : 'daily';
    const dateEpoch = isEvergreen ? 9999999999 : this._extractDateEpoch(filePath);
    const dateStr = isEvergreen ? '' : path.basename(filePath, '.md').slice(0, 10);

    // 删除该文件的旧索引
    const oldRows = await this._all(
      'SELECT rowid FROM memory_meta WHERE file_path = ?',
      [filePath]
    );
    for (const row of oldRows) {
      await this._run('DELETE FROM memory_fts WHERE rowid = ?', [row.rowid]);
      await this._run('DELETE FROM memory_meta WHERE rowid = ?', [row.rowid]);
    }

    // 按 ## 二级标题分段
    const sections = this._splitByHeadings(content);

    for (const section of sections) {
      if (!section.content.trim()) continue;

      const result = await this._run(
        'INSERT INTO memory_fts(content, file_path, file_type, date_str, section_title) VALUES (?, ?, ?, ?, ?)',
        [section.content, filePath, fileType, dateStr, section.title]
      );

      await this._run(
        'INSERT INTO memory_meta(rowid, file_path, date_epoch, file_type, indexed_at) VALUES (?, ?, ?, ?, ?)',
        [result.lastID, filePath, dateEpoch, fileType, Math.floor(Date.now() / 1000)]
      );
    }
  }

  _splitByHeadings(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentTitle = '';
    let currentLines = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentLines.length > 0) {
          sections.push({ title: currentTitle, content: currentLines.join('\n') });
        }
        currentTitle = line.replace(/^##\s+/, '').trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({ title: currentTitle, content: currentLines.join('\n') });
    }

    // 如果没有二级标题，整体作为一段
    if (sections.length === 0 && content.trim()) {
      sections.push({ title: '', content });
    }

    return sections;
  }

  _extractDateEpoch(filePath) {
    const basename = path.basename(filePath, '.md');
    const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      return Math.floor(new Date(dateMatch[1]).getTime() / 1000);
    }
    return Math.floor(Date.now() / 1000);
  }

  async reindexAll() {
    if (!this.db) return;

    await this._run('DELETE FROM memory_fts');
    await this._run('DELETE FROM memory_meta');

    // 索引常青文件
    for (const filePath of this.evergreenFiles) {
      if (fs.existsSync(filePath)) {
        await this.indexMemoryFile(filePath).catch(e =>
          console.warn(`[MemoryManager] reindex 常青文件失败 ${filePath}: ${e.message}`)
        );
      }
    }

    // 索引历史日志
    if (fs.existsSync(this.memoryDir)) {
      const files = fs.readdirSync(this.memoryDir)
        .filter(f => f.endsWith('.md'))
        .map(f => path.join(this.memoryDir, f));

      for (const filePath of files) {
        await this.indexMemoryFile(filePath).catch(e =>
          console.warn(`[MemoryManager] reindex 日志失败 ${filePath}: ${e.message}`)
        );
      }
    }

    console.log('[MemoryManager] 全量重索引完成');
  }

  // ── 配置持久化 ──

  async getLastFlushedIndex() {
    if (!this.db) return 0;
    try {
      const row = await this._get(
        'SELECT value FROM memory_config WHERE key = ?',
        ['last_flush_index']
      );
      return row ? parseInt(row.value, 10) : 0;
    } catch (e) {
      return 0;
    }
  }

  async setLastFlushedIndex(index) {
    if (!this.db) return;
    await this._run(
      'INSERT OR REPLACE INTO memory_config(key, value) VALUES (?, ?)',
      ['last_flush_index', String(index)]
    );
  }

  // ── 工具方法 ──

  getDateStr(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  getDailyLogPath(dateStr) {
    return path.join(this.memoryDir, `${dateStr}.md`);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = MemoryManager;
