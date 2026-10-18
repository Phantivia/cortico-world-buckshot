import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlobInput, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { nowIso } from 'cortico/core/util.ts';
import { BuckshotBridge } from './bridge.ts';
import { BUCKSHOT_CONFIG_GROUP, normalizeExecutableFile, type BuckshotConfigSection } from './config.ts';
import { prepareImplant } from './implant.ts';
import { renderSnapshot, StateNarrator } from './render.ts';
import { BUCKSHOT_TOOL_DECLS } from './tools.ts';
import type { BuckshotObservation, BuckshotSnapshot } from './protocol.ts';
import { BUCKSHOT_PANEL_DECLS } from './webui/panels.ts';
import type { BuckshotGameState } from './webui/types.ts';
import { describeObservation, frameKey } from './events.ts';
import { Settlement } from './settle.ts';
import { LOCAL_PEER_ID, LocalPeer } from './peer.ts';

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
  private frameWanted = false;
  /** The state text told so far; receipts and events after the first full one state only what changed. */
  private readonly narrator = new StateNarrator();
  /** While an input waits for its settlement: the observations go into its receipt instead of events. */
  private settling: { observations: string[] } | null = null;
  /** The second local game process that joins this game's multiplayer lobby; see LocalPeer. */
  private peer: LocalPeer | null = null;
  private peerStarting: Promise<void> | null = null;
  private peerError = '';

  constructor(private readonly ctx: WorldContext<BuckshotConfigSection>) {}

  envPromptVars(): Record<string, string> { return { 'buckshot.status': this.bridge?.snapshot ? renderSnapshot(this.bridge.snapshot) : '游戏未启动。调用 buckshot_start 启动。' }; }

  tools(): ToolDef[] {
    return BUCKSHOT_TOOL_DECLS.map((declaration) => ({ ...declaration, handler: async (args, context): Promise<ToolOutcome> => {
      if (context.signal?.aborted) return { text: '操作已取消。', failed: true };
      try {
        switch (declaration.name) {
          case 'buckshot_start': await this.startGame(context.signal); return { text: this.bridge?.snapshot ? this.narrator.full(this.bridge.snapshot) : '游戏已连接；等待首个状态事件。' };
          case 'buckshot_close': await this.stopGame(); return { text: '游戏已关闭。' };
          case 'buckshot_observe': {
            const reply = await this.request('snapshot', {}, context.signal);
            return { text: reply.snapshot ? this.narrator.full(reply.snapshot) : reply.detail, ...(!reply.ok ? { failed: true as const } : {}) };
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
            return await this.input(action, args, context.signal);
          }
        }
      } catch (error) { return { text: error instanceof Error ? error.message : String(error), failed: true }; }
    } }));
  }

  webUi(): WorldWebUiDecl {
    return {
      label: '恶魔轮盘', config: [BUCKSHOT_CONFIG_GROUP], panels: [...BUCKSHOT_PANEL_DECLS],
      invoke: async (panel, method) => {
        if (panel !== 'game') throw new Error('未知面板。');
        if (method === 'start') await this.startGame();
        else if (method === 'stop') await this.stopGame();
        else if (method === 'peerJoin') await this.startPeer();
        else if (method === 'peerLeave') await this.stopPeer();
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
    const peer = this.peerStarting ? 'starting' : this.peer?.joined ? 'joined' : this.peer ? 'menu' : 'offline';
    return { state: this.state, error: this.error, stoppable: this.game !== null || this.starting !== null, scene: snapshot?.scene, mode: snapshot?.mode, round: snapshot?.round, peer, peerError: this.peerError };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await this.emit('ready', '恶魔轮盘 World 已挂载。调用 buckshot_start 启动游戏。');
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.frameWanted = false;
    await this.stopPeer();
    if (this.ctx.cfg.closeOnStop) await this.stopGame();
    else { await this.bridge?.stop(); this.bridge = null; this.game = null; this.state = 'offline'; }
    await this.eventTail;
    this.host = null;
  }

  /**
   * Sends an input and waits until the game settles (see Settlement) or the settle deadline passes. The receipt carries
   * what happened meanwhile, the state it settled in and, with screenshot events on, the frame it shows.
   */
  private async input(action: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    const bridge = this.bridge;
    if (!bridge) throw new Error('游戏未启动。调用 buckshot_start。');
    const settlement = new Settlement(bridge.snapshot);
    const settling = { observations: [] as string[] };
    this.settling = settling;
    try {
      const reply = await this.request(action, args, signal);
      if (!reply.ok) return { text: `${reply.detail}${reply.snapshot ? `\n${this.narrator.changes(reply.snapshot)}` : ''}`, failed: true };
      const { snapshot, timedOut } = await this.settle(bridge, settlement, reply.snapshot, signal);
      const lines = [reply.detail];
      if (settling.observations.length) lines.push(`这期间：\n${settling.observations.map((text) => `- ${text}`).join('\n')}`);
      if (timedOut) lines.push(`${this.ctx.cfg.settleTimeoutMs} ms 内游戏还没有回到可操作状态；之后的变化作为事件送达。`);
      if (snapshot) lines.push(this.narrator.changes(snapshot));
      this.settling = null;
      if (snapshot) this.onSnapshot(snapshot, false);
      const frame = this.ctx.cfg.screenshotEvents.enabled && this.bridge === bridge
        ? await bridge.request('capture', {}, this.ctx.cfg.actionTimeoutMs).catch(() => null) : null;
      return { text: lines.join('\n'), ...(frame?.ok && frame.png ? { blobs: [{ bytes: Buffer.from(frame.png, 'base64'), mime: 'image/png', name: 'buckshot.png', fallbackText: '恶魔轮盘结算后的画面' }] } : {}) };
    } finally {
      if (this.settling === settling) this.settling = null;
    }
  }

  private settle(bridge: BuckshotBridge, settlement: Settlement, replied: BuckshotSnapshot | undefined, signal?: AbortSignal): Promise<{ snapshot: BuckshotSnapshot | null; timedOut: boolean }> {
    if (replied && settlement.snapshot(replied)) return Promise.resolve({ snapshot: replied, timedOut: false });
    return new Promise((resolve) => {
      const finish = (timedOut: boolean, snapshot = bridge.snapshot) => {
        clearTimeout(timer);
        bridge.off('snapshot', onSnapshot); bridge.off('observation', onObservation); bridge.off('disconnected', onGone);
        signal?.removeEventListener('abort', onGone);
        resolve({ snapshot, timedOut });
      };
      const onSnapshot = (s: BuckshotSnapshot) => { if (settlement.snapshot(s)) finish(false, s); };
      const onObservation = () => settlement.observation(bridge.snapshot?.revision ?? 0);
      const onGone = () => finish(false);
      const timer = setTimeout(() => finish(true), this.ctx.cfg.settleTimeoutMs);
      bridge.on('snapshot', onSnapshot);
      bridge.on('observation', onObservation);
      bridge.once('disconnected', onGone);
      signal?.addEventListener('abort', onGone, { once: true });
    });
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
    this.narrator.reset();
    try {
      await this.stopGame();
      this.state = 'loading';
      const executableFile = normalizeExecutableFile(this.ctx.cfg.executableFile);
      if (!executableFile || !existsSync(executableFile) || !statSync(executableFile).isFile()) {
        throw new Error(executableFile ? `找不到游戏程序: ${executableFile}` : '未配置游戏程序。在 WebUI 恶魔轮盘页的配置里选择 Buckshot Roulette.exe。');
      }
      const runtimeDir = this.ctx.cfg.runtimeDir || join(this.ctx.botDir, 'runtimes', 'buckshot');
      const packFile = await prepareImplant(executableFile, runtimeDir);
      signal?.throwIfAborted();
      const bridge = new BuckshotBridge();
      this.bridge = bridge;
      bridge.on('snapshot', (snapshot: BuckshotSnapshot) => this.onSnapshot(snapshot));
      bridge.on('observation', (event: BuckshotObservation) => {
        const text = describeObservation(event);
        if (this.settling) { this.settling.observations.push(text); return; }
        void this.emit(event.kind, text);
        if (['shot', 'reveal', 'revival', 'result', 'dialogue'].includes(event.kind)) this.scheduleFrame();
      });
      bridge.on('fault', (error: Error) => { this.state = 'error'; this.error = error.message; void this.emit('error', error.message); });
      bridge.on('disconnected', () => { void this.stopPeer(); if (this.bridge === bridge) { this.state = 'offline'; void this.emit('disconnected', '游戏事件桥已断开。'); } });
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

  /** Starts the local peer once this game hosts a lobby on its lobby screen; it joins that lobby on its own. */
  async startPeer(): Promise<void> {
    if (this.peerStarting) return this.peerStarting;
    if (this.peer) throw new Error('本地客户端已在运行。');
    const bridge = this.bridge;
    if (!bridge || this.state !== 'online') throw new Error('先启动游戏并等它连接。');
    this.peerError = '';
    this.peerStarting = (async () => {
      const lobby = await bridge.request('peer_lobby', { peer: LOCAL_PEER_ID }, this.ctx.cfg.actionTimeoutMs);
      if (!lobby.ok) throw new Error(`${{ 'not hosting a lobby': '可缇还没有在多人模式里建房间。', 'not on the lobby screen': '房间已经离开大厅界面（对局进行中）。', 'the lobby has other players': '房间里已有其他玩家；本地加入只用于两人对打。' }[lobby.detail] ?? lobby.detail}`);
      const executableFile = normalizeExecutableFile(this.ctx.cfg.executableFile);
      const runtimeDir = this.ctx.cfg.runtimeDir || join(this.ctx.botDir, 'runtimes', 'buckshot');
      const packFile = await prepareImplant(executableFile, runtimeDir, true);
      const logDir = join(this.ctx.dataDir, 'buckshot');
      await mkdir(logDir, { recursive: true });
      const options = this.ctx.cfg.localPeer;
      const name = options.name.trim() || 'Player 2';
      const peer = new LocalPeer(bridge, {
        executableFile, packFile, logFile: join(logDir, 'game-peer.log'), name, screenIndex: options.screenIndex, muteAudio: options.muteAudio,
        startupTimeoutMs: this.ctx.cfg.startupTimeoutMs, actionTimeoutMs: this.ctx.cfg.actionTimeoutMs,
        onChange: (change) => {
          if (change === 'joined') void this.emit('peer', `本地玩家 ${name} 加入了房间。`);
          if (change === 'left') void this.emit('peer', `本地玩家 ${name} 离开了房间。`);
          if (change === 'closed' && this.peer === peer) this.peer = null;
        },
      });
      this.peer = peer;
      await peer.start((lobby as { lobby?: string }).lobby ?? '');
    })().catch((error) => {
      this.peer = null;
      this.peerError = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => { this.peerStarting = null; });
    return this.peerStarting;
  }

  async stopPeer(): Promise<void> {
    if (this.peerStarting) await this.peerStarting.catch(() => undefined);
    const peer = this.peer;
    this.peer = null;
    await peer?.stop();
  }

  async stopGame(): Promise<void> {
    await this.stopPeer();
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.frameWanted = false;
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

  /** A new state: announced as events, unless `announce` is false (an input's receipt already reports it). */
  private onSnapshot(snapshot: BuckshotSnapshot, announce = true): void {
    // the input's receipt reports this state once it settles
    if (this.settling) return;
    const signature = JSON.stringify({ actions: snapshot.actions, scene: snapshot.scene, menu: snapshot.menu, mode: snapshot.mode, round: snapshot.round, outcome: snapshot.outcome, cash: snapshot.cash, view: snapshot.view, activeSeat: snapshot.activeSeat, turnOrder: snapshot.turnOrder, jammerSelection: snapshot.jammerSelection });
    if (signature !== this.lastActions) {
      this.lastActions = signature;
      if (announce) void this.emit('state', this.narrator.changes(snapshot));
    }
    if (snapshot.outcome !== this.lastOutcome) {
      this.lastOutcome = snapshot.outcome;
      if (announce && snapshot.outcome === 'won') void this.emit('victory', `结算：胜利${snapshot.cash === undefined ? '' : `，奖金 ${snapshot.cash}`}。`);
    }
    const key = frameKey(snapshot);
    if (key !== this.lastFrameKey) {
      this.lastFrameKey = key;
      if (announce && snapshot.scene !== 'loading') this.scheduleFrame();
    }
  }

  private scheduleFrame(): void {
    if (!this.ctx.cfg.screenshotEvents.enabled || !this.bridge) return;
    this.frameWanted = true;
    if (this.frameTimer || this.framePending) return;
    const delay = Math.max(150, this.lastFrameAtMs + this.ctx.cfg.screenshotEvents.minIntervalMs - Date.now());
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      const bridge = this.bridge;
      if (!bridge || !this.ctx.cfg.screenshotEvents.enabled) return;
      this.frameWanted = false;
      this.framePending = (async () => {
        const reply = await bridge.request('capture', {}, this.ctx.cfg.actionTimeoutMs);
        // an input's receipt carries its own frame and state
        if (this.bridge !== bridge || !reply.ok || !reply.png || this.settling) return;
        this.lastFrameAtMs = Date.now();
        await this.emit('frame', `截图为当前渲染帧。${bridge.snapshot ? `\n${this.narrator.changes(bridge.snapshot)}` : ''}`, [{ bytes: Buffer.from(reply.png, 'base64'), mime: 'image/png', name: 'buckshot.png', fallbackText: '恶魔轮盘当前画面' }]);
      })().catch((error) => { if (this.bridge === bridge) this.host?.log.warn(`Buckshot frame event failed: ${String(error)}`); }).finally(() => {
        this.framePending = null;
        if (this.frameWanted && this.bridge === bridge) this.scheduleFrame();
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
