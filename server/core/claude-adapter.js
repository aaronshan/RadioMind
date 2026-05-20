/**
 * Claude.js - 大脑适配器
 * 四级优先级：claude CLI > claude API > 降级处理
 * spawn子进程 · 解析 {say, play[], reason, segue}
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

class ClaudeAdapter {
  constructor() {
    this.apiKey = process.env.CLAUDE_API_KEY;
    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    this.promptsDir = path.join(__dirname, '../prompts');
    this.useCLI = null; // null=未检测, true=使用CLI, false=使用API
    this.cliCommand = null; // 存储检测到的CLI命令
    this.cliArgs = []; // 存储CLI基础参数
  }

  /**
   * 检测 Claude CLI 是否可用（支持 claude 和 mc --code 等代理命令）
   */
  async checkCLIAvailable() {
    if (this.useCLI !== null) return this.useCLI;

    // 优先级1: 检查环境变量指定的命令
    if (process.env.CLAUDE_CLI_COMMAND) {
      const customCmd = process.env.CLAUDE_CLI_COMMAND.trim();
      const isAvailable = await this.testCLICommand(customCmd);
      if (isAvailable) {
        console.log(`[ClaudeAdapter] Using custom CLI command: ${customCmd}`);
        this.useCLI = true;
        return true;
      }
    }

    // 优先级2: 检测 mc --code（代理命令）
    const mcAvailable = await this.testCLICommand('mc --code');
    if (mcAvailable) {
      console.log('[ClaudeAdapter] Using mc --code (Max subscription)');
      this.useCLI = true;
      return true;
    }

    // 优先级3: 检测标准 claude 命令
    const claudeAvailable = await this.testCLICommand('claude');
    if (claudeAvailable) {
      console.log('[ClaudeAdapter] Using Claude CLI (Max subscription)');
      this.useCLI = true;
      return true;
    }

    // 都不可用，使用API
    console.log('[ClaudeAdapter] No CLI available, will use API fallback');
    this.useCLI = false;
    return false;
  }

  /**
   * 测试指定CLI命令是否可用
   */
  async testCLICommand(cmd) {
    return new Promise((resolve) => {
      const parts = cmd.split(' ');
      const mainCmd = parts[0];
      const args = parts.slice(1);

      const child = spawn(mainCmd, [...args, '--version'], {
        timeout: 5000,
        shell: false
      });

      let hasError = false;

      child.on('error', () => {
        hasError = true;
        resolve(false);
      });

      child.on('close', (code) => {
        if (!hasError && code === 0) {
          // 保存命令配置
          this.cliCommand = mainCmd;
          this.cliArgs = args;
          return resolve(true);
        }
        resolve(false);
      });
    });
  }

  /**
   * 标准聊天调用
   */
  async chat(context) {
    // 使用传入的 system prompt（包含用户档案），或加载默认系统提示词
    const systemPrompt = context.system || this.loadSystemPrompt();
    const messages = this.buildMessages(context);

    try {
      // 优先级1: 尝试使用 Claude CLI (无需API Key，使用Max订阅)
      const useCLI = await this.checkCLIAvailable();

      if (useCLI) {
        const response = await this.callClaudeCLI(systemPrompt, messages);
        return this.parseResponse(response);
      }

      // 优先级2: 使用 Anthropic API
      if (this.apiKey) {
        const response = await this.callClaudeAPI(systemPrompt, messages);
        return this.parseResponse(response);
      }

      // 优先级3: 降级处理
      console.warn('[ClaudeAdapter] No CLI or API key available, using fallback');
      return this.fallbackResponse(context);

    } catch (error) {
      console.error('[ClaudeAdapter] Chat error:', error.message);
      return this.fallbackResponse(context);
    }
  }

  /**
   * 流式聊天调用
   */
  async streamChat(context, onChunk) {
    // 使用传入的 system prompt（包含用户档案），或加载默认系统提示词
    const systemPrompt = context.system || this.loadSystemPrompt();
    const messages = this.buildMessages(context);

    try {
      const useCLI = await this.checkCLIAvailable();

      if (useCLI) {
        await this.callClaudeCLIStream(systemPrompt, messages, onChunk);
        return;
      }

      if (this.apiKey) {
        await this.callClaudeAPIStream(systemPrompt, messages, onChunk);
        return;
      }

      onChunk({ text: '抱歉，我暂时无法回应。让我们继续听音乐吧。', done: true });

    } catch (error) {
      console.error('[ClaudeAdapter] Stream error:', error.message);
      onChunk({ text: '抱歉，我暂时无法回应。', done: true });
    }
  }

  /**
   * 获取推荐
   */
  async getRecommendation(context) {
    const systemPrompt = this.loadSystemPrompt('recommendation');
    const prompt = this.buildRecommendationPrompt(context);

    try {
      const useCLI = await this.checkCLIAvailable();
      let response;

      if (useCLI) {
        response = await this.callClaudeCLI(systemPrompt, [
          { role: 'user', content: prompt }
        ]);
      } else if (this.apiKey) {
        response = await this.callClaudeAPI(systemPrompt, [
          { role: 'user', content: prompt }
        ]);
      } else {
        return this.fallbackRecommendation(context);
      }

      return this.parseRecommendation(response);

    } catch (error) {
      console.error('[ClaudeAdapter] Recommendation error:', error.message);
      return this.fallbackRecommendation(context);
    }
  }

  /**
   * 调用 Claude CLI (优先级1 - 无需API Key)
   */
  callClaudeCLI(systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const promptText = this.formatPrompt(systemPrompt, messages);

      // 构建命令参数（claude 和 mc --code 都支持 --output-format json）
      const args = [...this.cliArgs, '-p', '--output-format', 'json'];

      console.log(`[ClaudeAdapter] Executing: ${this.cliCommand} ${args.join(' ')}`);

      const child = spawn(this.cliCommand, args, {
        env: process.env,
        timeout: 60000
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('[Claude CLI stderr]:', data.toString());
      });

      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          reject(new Error('Claude CLI not found'));
        } else {
          reject(error);
        }
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Claude CLI exited with code ${code}: ${errorOutput}`));
        } else {
          resolve(output);
        }
      });

      // 发送提示
      child.stdin.write(promptText);
      child.stdin.end();
    });
  }

  /**
   * 流式调用 Claude CLI
   */
  callClaudeCLIStream(systemPrompt, messages, onChunk) {
    return new Promise((resolve, reject) => {
      const promptText = this.formatPrompt(systemPrompt, messages);

      // 构建命令参数
      const args = [...this.cliArgs, '-p'];

      console.log(`[ClaudeAdapter] Executing stream: ${this.cliCommand} ${args.join(' ')}`);

      const child = spawn(this.cliCommand, args, {
        env: process.env,
        timeout: 60000
      });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        onChunk({ text, done: false });
      });

      child.stderr.on('data', (data) => {
        console.error('[Claude CLI stderr]:', data.toString());
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', () => {
        onChunk({ done: true });
        resolve();
      });

      child.stdin.write(promptText);
      child.stdin.end();
    });
  }

  /**
   * 调用 Claude API (优先级2 - 需要API Key)
   */
  callClaudeAPI(systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ];

      const requestBody = JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: apiMessages
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'Anthropic-Version': '2023-06-01'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.error) {
              reject(new Error(response.error.message));
            } else if (response.content && response.content[0]) {
              resolve(response.content[0].text);
            } else {
              resolve(data);
            }
          } catch (e) {
            resolve(data);
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 流式调用 Claude API
   */
  callClaudeAPIStream(systemPrompt, messages, onChunk) {
    return new Promise((resolve, reject) => {
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ];

      const requestBody = JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: apiMessages,
        stream: true
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'Anthropic-Version': '2023-06-01'
        }
      };

      const req = https.request(options, (res) => {
        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                onChunk({ done: true });
                resolve();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta') {
                  onChunk({ text: parsed.delta.text || '', done: false });
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        });

        res.on('end', () => {
          onChunk({ done: true });
          resolve();
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 加载系统提示词
   */
  loadSystemPrompt(type = 'default') {
    const promptFile = type === 'recommendation'
      ? 'dj-persona.md'
      : 'system.md';

    const promptPath = path.join(this.promptsDir, promptFile);

    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, 'utf8');
    }

    return this.getDefaultSystemPrompt();
  }

  /**
   * 构建消息
   */
  buildMessages(context) {
    const messages = [];

    if (context.history) {
      messages.push(...context.history.map(h => ({
        role: h.role,
        content: h.content
      })));
    }

    if (context.userMessage) {
      messages.push({
        role: 'user',
        content: context.userMessage
      });
    }

    return messages;
  }

  /**
   * 构建推荐提示
   */
  buildRecommendationPrompt(context) {
    const { taste, history, currentMood, weather, activity, time } = context;

    return `你是一位专业的音乐DJ，正在为听众选择下一首歌曲。

## 当前情境
- 时间：${time?.toLocaleString() || new Date().toLocaleString()}
- 天气：${weather || '未知'}
- 活动：${activity || '休闲'}
- 心情：${currentMood?.mood || '平静'}

## 用户品味
${taste?.description || '暂无详细描述'}

## 最近播放
${history?.slice(0, 10).map(h => `- ${h.name} - ${h.artist}`).join('\n') || '暂无'}

## 任务
请推荐下一首歌曲，以JSON格式返回：
{
  "song": "歌曲名",
  "artist": "艺术家",
  "reason": "推荐理由（简短）",
  "segue": "过渡语（如：接下来这首歌...）",
  "context": "适合的场景描述"
}`;
  }

  /**
   * 格式化提示 (用于CLI)
   */
  formatPrompt(systemPrompt, messages) {
    let prompt = systemPrompt + '\n\n';

    for (const msg of messages) {
      if (msg.role === 'user') {
        prompt += `User: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        prompt += `Assistant: ${msg.content}\n`;
      }
    }

    prompt += 'Assistant:';
    return prompt;
  }

  /**
   * 解析响应
   * 支持标准 claude 和 mc --code 两种输出格式
   */
  parseResponse(response) {
    try {
      // 尝试解析JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // mc --code 格式: { type: "result", result: "...", usage: {...} }
        if (parsed.type === 'result' && parsed.result) {
          return {
            text: parsed.result,
            reasoning: '',
            play: [],
            segue: '',
            tokens: parsed.usage?.output_tokens || parsed.usage?.outputTokens,
            raw: parsed
          };
        }

        // 标准 claude 格式或自定义格式
        return {
          text: parsed.say || parsed.message || parsed.result || response,
          reasoning: parsed.reason || '',
          play: parsed.play || [],
          segue: parsed.segue || '',
          tokens: parsed.tokens,
          raw: parsed
        };
      }
    } catch (e) {
      // 非JSON响应，直接返回文本
    }

    return {
      text: response.trim(),
      reasoning: '',
      play: [],
      segue: '',
      raw: response
    };
  }

  /**
   * 解析推荐
   */
  parseRecommendation(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse recommendation:', e);
    }

    return this.fallbackRecommendation();
  }

  /**
   * 降级响应
   */
  fallbackResponse(context) {
    return {
      text: '我正在为你挑选合适的音乐，请稍候...',
      reasoning: '系统降级处理',
      play: [],
      segue: '',
      source: 'fallback'
    };
  }

  /**
   * 降级推荐
   */
  fallbackRecommendation(context) {
    return {
      song: '随机推荐',
      artist: '未知',
      reason: '基于你的品味',
      segue: '接下来这首歌...',
      context: '适合当前氛围',
      source: 'fallback'
    };
  }

  /**
   * 默认系统提示词
   */
  getDefaultSystemPrompt() {
    return `你是一位贴心的音乐助手，名叫RadioMind。

你的职责：
1. 根据用户的心情、天气、活动状态推荐合适的音乐
2. 与用户自然对话，了解他们的音乐喜好
3. 记住用户的反馈，不断优化推荐
4. 用温暖、专业的方式介绍歌曲

输出格式：
- 正常对话直接回复
- 推荐歌曲时使用 [PLAY: 歌曲名 - 艺术家]
- 仅建议时使用 [RECOMMEND: 歌曲名]`;
  }
}

module.exports = ClaudeAdapter;
