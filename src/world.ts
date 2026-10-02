import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlobInput, ToolDef, ToolOutcome, World, WorldHost, WorldConsoleDecl } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { nowIso } from 'cortico/core/util.ts';
import { BuckshotBridge } from './bridge.ts';
import { BUCKSHOT_CONFIG_GROUP, normalizeExecutableFile, type BuckshotConfigSection } from './config.ts';
import { prepareImplant } from './implant.ts';
import { renderSnapshot } from './render.ts';
import { BUCKSHOT_TOOL_DECLS } from './tools.ts';
import type { BuckshotObservation, BuckshotSnapshot } from './protocol.ts';
import { BUCKSHOT_PANEL_DECLS } from './console/panels.ts';
import type { BuckshotGameState } from './console/types.ts';
import { describeObservation, describeEnvironment, frameKey } from './events.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

export class BuckshotWorld implements World {
  readonly id = 'buckshot';
  private host: WorldHost | null = null;
  private bridge: BuckshotBridge | null = null;
  private game: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private state: 'offline' | 'loading' | 'online' | 'error' = 'offline';
  private error = '';
  private eventTail = Promise.resolve();
  private lastActions = '';
  private lastOutcome: string | undefined;
  private lastFrameKey = '';
  private frameTimer: NodeJS.Timeout | null = null;
  private framePending: Promise<void> | null = null;
  private lastFrameAtMs = 0;
  private frameReason = '';

  constructor(private readonly ctx: WorldContext<BuckshotConfigSection>) {}

  envPromptVars(): Record<string, string> { return { 'buckshot.status': this.bridge?.snapshot ? renderSnapshot(this.bridge.snapshot) : '游戏未启动。调用 buckshot_start 启动。' }; }

  tools(): ToolDef[] {
    return BUCKSHOT_TOOL_DECLS.map((declaration) => ({ ...declaration, handler: async (args, context): Promise<ToolOutcome> => {
      if (context.signal?.aborted) return { text: '操作已取消。', failed: true };
      try {
        switch (declaration.name) {
          case 'buckshot_start': await this.startGame(context.signal); return { text: this.bridge?.snapshot ? renderSnapshot(this.bridge.snapshot) : '游戏已连接；等待首个状态事件。' };
          case 'buckshot_close': await this.stopGame(); return { text: '游戏已关闭。' };
          case 'buckshot_observe': {
            const reply = await this.request('snapshot', {}, context.signal);
            return { text: reply.snapshot ? renderSnapshot(reply.snapshot) : reply.detail, ...(!reply.ok ? { failed: true as const } : {}) };
          }
          case 'buckshot_glance': {
            const reply = await this.request('capture', {}, context.signal);
            return reply.ok && reply.png
              ? { text: '游戏当前画面。', blobs: [{ bytes: Buffer.from(reply.png, 'base64'), mime: 'image/png', name: 'buckshot.png', fallbackText: '恶魔轮盘游戏截图' }] }
              : { text: reply.detail, failed: true };
          }
          default: {
            const action = { buckshot_act: 'act', buckshot_type: 'text', buckshot_input: 'input', buckshot_key: 'key', buckshot_pointer: 'pointer', buckshot_controller: 'controller' }[declaration.name];
            if (!action) throw new Error('未知工具。');
            if (action === 'act' && (typeof args.target !== 'string' || !Number.isInteger(args.revision))) throw new Error('target 和 revision 必须来自观察回执。');
            if (action === 'text' && typeof args.text !== 'string') throw new Error('text 必须是字符串。');
            if (action === 'input' && (typeof args.name !== 'string' || (args.durationMs !== undefined && (!Number.isInteger(args.durationMs) || Number(args.durationMs) < 1 || Number(args.durationMs) > 5000)))) throw new Error('输入名称或持续时间无效。');
            if (action === 'key' && (typeof args.key !== 'string' || (args.durationMs !== undefined && (!Number.isInteger(args.durationMs) || Number(args.durationMs) < 1 || Number(args.durationMs) > 5000)))) throw new Error('按键或持续时间无效。');
            if (action === 'pointer' && (!Number.isFinite(args.x) || !Number.isFinite(args.y) || Number(args.x) < 0 || Number(args.y) < 0)) throw new Error('鼠标坐标无效。');
            const reply = await this.request(action, args, context.signal);
            return { text: `${reply.detail}${reply.snapshot ? `\n${renderSnapshot(reply.snapshot)}` : ''}`, ...(!reply.ok ? { failed: true as const } : {}) };
          }
        }
      } catch (error) { return { text: error instanceof Error ? error.message : String(error), failed: true }; }
    } }));
  }

  console(): WorldConsoleDecl {
    return {
      label: '恶魔轮盘', config: [BUCKSHOT_CONFIG_GROUP], panels: [...BUCKSHOT_PANEL_DECLS],
      invoke: async (panel, method) => {
        if (panel !== 'game') throw new Error('未知面板。');
        if (method === 'start') await this.startGame();
        else if (method === 'stop') await this.stopGame();
        else if (method === 'capture') {
          const reply = await this.request('capture', {});
          if (!reply.ok || !reply.png) throw new Error(reply.detail);
          return { $binary: { mime: 'image/png', base64: reply.png } };
        } else if (method !== 'state') throw new Error('未知操作。');
        return this.gameState();
      },
      lamps: [{ label: '游戏桥', state: this.state, hint: this.error || undefined }],
      badges: [{ label: '游戏', value: this.bridge?.snapshot?.scene ?? '未启动', tone: this.state === 'online' ? 'on' : 'off' }],
      promptDocs: [{ key: 'worlds.buckshot.envPrompt', title: '恶魔轮盘 · 环境提示词', description: '游戏工具与可见信息的使用规则。', path: ENV_PROMPT_FILE,
        deploymentPath: join(this.ctx.botDir, 'worlds', 'buckshot', 'ENV_PROMPT.md'), role: 'envPrompt', vars: [{ name: 'buckshot.status', description: '当前游戏状态。', multiline: true }] }],
    };
  }

  private gameState(): BuckshotGameState {
    const snapshot = this.bridge?.snapshot;
    return { state: this.state, error: this.error, stoppable: this.game !== null || this.starting !== null, scene: snapshot?.scene, mode: snapshot?.mode, round: snapshot?.round };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await this.emit('ready', '恶魔轮盘 World 已挂载。调用 buckshot_start 启动游戏。');
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.frameReason = '';
    if (this.ctx.cfg.closeOnStop) await this.stopGame();
    else { await this.bridge?.stop(); this.bridge = null; this.game = null; this.state = 'offline'; }
    await this.eventTail;
    this.host = null;
  }

  private request(action: string, args: Record<string, unknown>, signal?: AbortSignal) {
    if (!this.bridge) throw new Error('游戏未启动。调用 buckshot_start。');
    return this.bridge.request(action, args, this.ctx.cfg.actionTimeoutMs, signal);
  }

  async startGame(signal?: AbortSignal): Promise<void> {
    if (!this.host) throw new Error('World 尚未挂载。');
    if (this.state === 'online') return;
    if (this.starting) return this.starting;
    this.starting = this.launch(signal).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async launch(signal?: AbortSignal): Promise<void> {
    this.state = 'loading';
    this.error = '';
    this.lastActions = '';
    this.lastOutcome = undefined;
    try {
      await this.stopGame();
      this.state = 'loading';
      const executableFile = normalizeExecutableFile(this.ctx.cfg.executableFile);
      const runtimeDir = this.ctx.cfg.runtimeDir || join(this.ctx.botDir, 'runtimes', 'buckshot');
      const packFile = await prepareImplant(executableFile, runtimeDir);
      signal?.throwIfAborted();
      const bridge = new BuckshotBridge();
      this.bridge = bridge;
      bridge.on('snapshot', (snapshot: BuckshotSnapshot) => this.onSnapshot(snapshot));
      bridge.on('observation', (event: BuckshotObservation) => {
        const text = describeObservation(event);
        void this.emit(event.kind, text);
        if (['shot', 'reveal', 'revival', 'result', 'dialogue'].includes(event.kind)) this.scheduleFrame(text);
      });
      bridge.on('fault', (error: Error) => { this.state = 'error'; this.error = error.message; void this.emit('error', error.message); });
      bridge.on('disconnected', () => { if (this.bridge === bridge) { this.state = 'offline'; void this.emit('disconnected', '游戏事件桥已断开。'); } });
      const port = await bridge.start();
      const logDir = join(this.ctx.dataDir, 'buckshot');
      await mkdir(logDir, { recursive: true });
      const log = createWriteStream(join(logDir, 'game.log'), { flags: 'a' });
      log.on('error', (error) => { this.host?.log.error(`Buckshot game log failed: ${error.message}`); });
      const connected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('等待游戏连接超时；检查游戏日志。')); }, this.ctx.cfg.startupTimeoutMs);
        const cleanup = () => { clearTimeout(timer); bridge.off('connected', onConnected); bridge.off('fault', onFault); this.game?.off('error', onFault); this.game?.off('exit', onExit); signal?.removeEventListener('abort', onAbort); };
        const onConnected = (hello: { pid: number; version: string }) => {
          if (hello.pid !== this.game?.pid || hello.version !== 'v2.2.0.6') { cleanup(); reject(new Error('游戏进程或版本与启动请求不匹配。')); return; }
          cleanup(); resolve();
        };
        const onFault = (error: Error) => { cleanup(); reject(error); };
        const onExit = () => { cleanup(); reject(new Error('游戏在连接前退出。')); };
        const onAbort = () => { cleanup(); reject(new Error('游戏启动已取消。')); };
        if (signal?.aborted) { cleanup(); reject(new Error('游戏启动已取消。')); log.end(); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
        bridge.once('connected', onConnected);
        bridge.once('fault', onFault);
        const displayArgs = this.ctx.cfg.display.screenIndex === null ? [] : ['--screen', String(this.ctx.cfg.display.screenIndex)];
        if (this.ctx.cfg.display.muteAudio) displayArgs.push('--audio-driver', 'Dummy');
        this.game = spawn(executableFile, [...displayArgs, '--main-pack', packFile, '--', `--cortico-executable=${executableFile}`, `--cortico-port=${port}`, `--cortico-token=${bridge.token}`], { cwd: dirname(executableFile), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.game.once('error', onFault);
        this.game.on('error', (error) => { log.end(); this.host?.log.error(`Buckshot game process failed: ${error.message}`); });
        this.game.once('exit', onExit);
        this.game.stdout?.pipe(log, { end: false }); this.game.stderr?.pipe(log, { end: false });
        this.game.once('exit', () => { log.end(); if (this.bridge === bridge) { this.state = 'offline'; void this.emit('closed', '游戏进程已退出。'); } });
      });
      await connected;
      this.state = 'online';
      await this.emit('connected', '恶魔轮盘已连接。等待画面中的可操作目标。');
    } catch (error) {
      await this.stopGame();
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stopGame(): Promise<void> {
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.frameReason = '';
    this.lastFrameKey = '';
    this.lastFrameAtMs = 0;
    const bridge = this.bridge;
    const game = this.game;
    this.bridge = null;
    this.game = null;
    if (bridge && game?.exitCode === null) {
      await bridge.request('quit', {}, this.ctx.cfg.actionTimeoutMs).catch(() => undefined);
    }
    await bridge?.stop();
    if (game?.pid && game.exitCode === null) {
      await new Promise<void>((resolve) => { game.once('close', () => resolve()); if (!game.kill()) resolve(); });
    }
    this.state = 'offline';
  }

  private onSnapshot(snapshot: BuckshotSnapshot): void {
    const signature = JSON.stringify({ actions: snapshot.actions, scene: snapshot.scene, menu: snapshot.menu, mode: snapshot.mode, round: snapshot.round, outcome: snapshot.outcome, cash: snapshot.cash, view: snapshot.view, activeSeat: snapshot.activeSeat, turnOrder: snapshot.turnOrder, jammerSelection: snapshot.jammerSelection });
    if (signature !== this.lastActions) {
      this.lastActions = signature;
      void this.emit('state', renderSnapshot(snapshot));
    }
    if (snapshot.outcome !== this.lastOutcome) {
      this.lastOutcome = snapshot.outcome;
      if (snapshot.outcome === 'won') void this.emit('victory', renderSnapshot(snapshot));
    }
    const key = frameKey(snapshot);
    if (key !== this.lastFrameKey) {
      this.lastFrameKey = key;
      if (snapshot.scene !== 'loading') this.scheduleFrame(describeEnvironment(snapshot));
    }
  }

  private scheduleFrame(reason: string): void {
    if (!this.ctx.cfg.screenshotEvents.enabled || !this.bridge) return;
    this.frameReason = reason;
    if (this.frameTimer || this.framePending) return;
    const delay = Math.max(150, this.lastFrameAtMs + this.ctx.cfg.screenshotEvents.minIntervalMs - Date.now());
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      const bridge = this.bridge;
      if (!bridge || !this.ctx.cfg.screenshotEvents.enabled) return;
      const reason = this.frameReason;
      this.frameReason = '';
      this.framePending = (async () => {
        const reply = await bridge.request('capture', {}, this.ctx.cfg.actionTimeoutMs);
        if (this.bridge !== bridge || !reply.ok || !reply.png) return;
        this.lastFrameAtMs = Date.now();
        await this.emit('frame', `${reason}\n截图为当前渲染帧。${bridge.snapshot ? `\n${renderSnapshot(bridge.snapshot)}` : ''}`, [{ bytes: Buffer.from(reply.png, 'base64'), mime: 'image/png', name: 'buckshot.png', fallbackText: '恶魔轮盘当前画面' }]);
      })().catch((error) => { if (this.bridge === bridge) this.host?.log.warn(`Buckshot frame event failed: ${String(error)}`); }).finally(() => {
        this.framePending = null;
        if (this.frameReason && this.bridge === bridge) this.scheduleFrame(this.frameReason);
      });
    }, delay);
  }

  private emit(kind: string, text: string, blobs?: BlobInput[]): Promise<void> {
    this.eventTail = this.eventTail.then(async () => {
      await this.host?.pushEvent({ type: `buckshot.${kind}`, source: this.id, senderKey: this.id, ts: nowIso(this.ctx.timezone), text, ...(blobs ? { blobs } : {}) }, { trigger: kind === 'state' || kind === 'victory' ? 'flush' : 'debounce' });
    }).catch((error) => { this.host?.log.error(`Buckshot event delivery failed: ${String(error)}`); });
    return this.eventTail;
  }
}
