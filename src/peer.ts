import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { BuckshotBridge } from './bridge.ts';
import type { BuckshotSnapshot } from './protocol.ts';

/** The lobby member id the local peer takes; no Steam account has it. Strings, since ids exceed 2^53. */
export const LOCAL_PEER_ID = '76561190000000001';

export interface LocalPeerOptions {
  /** The lobby member id, LOCAL_PEER_ID unless a check runs several peers. */
  id: string;
  /** Checks how Steam players fare: the host counts this peer as one and lists it what Steam would. */
  mockSteamPlayer?: boolean;
  executableFile: string;
  packFile: string;
  logFile: string;
  name: string;
  screenIndex: number | null;
  muteAudio: boolean;
  startupTimeoutMs: number;
  actionTimeoutMs: number;
  /** Called when the peer enters or leaves the host's lobby, and when its process ends. */
  onChange(change: 'joined' | 'left' | 'closed'): void;
}

/**
 * A second game process on this machine that joins the host game's multiplayer lobby. The host keeps its Steam lobby;
 * the peer never initialises Steam and sits in that lobby as a member only the two bridges know about. Its packets,
 * the host's member list and its join and leave requests pass through here.
 */
export class LocalPeer {
  readonly bridge = new BuckshotBridge();
  private game: ChildProcess | null = null;
  private requests = Promise.resolve();
  private detached = false;
  joined = false;

  constructor(private readonly host: BuckshotBridge, private readonly options: LocalPeerOptions) {}

  get running(): boolean { return this.game !== null && this.game.exitCode === null; }

  /** Starts the peer and sends it from its main menu into the host's lobby `lobby`. */
  async start(lobby: string): Promise<void> {
    const { options, bridge, host } = this;
    const port = await bridge.start();
    const log = createWriteStream(options.logFile, { flags: 'a' });
    log.on('error', () => undefined);
    const args = ['--windowed'];
    if (options.screenIndex !== null) args.push('--screen', String(options.screenIndex));
    if (options.muteAudio) args.push('--audio-driver', 'Dummy');
    const game = spawn(options.executableFile, [...args, '--main-pack', options.packFile, '--', `--cortico-executable=${options.executableFile}`, `--cortico-port=${port}`, `--cortico-token=${bridge.token}`, `--cortico-peer-id=${options.id}`, `--cortico-peer-name=${options.name}`],
      { cwd: dirname(options.executableFile), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.game = game;
    game.stdout?.pipe(log, { end: false }); game.stderr?.pipe(log, { end: false });
    game.once('exit', () => { log.end(); void this.detach().then(() => options.onChange('closed')); });

    host.on('net', this.fromHost);
    host.on('roster', this.rosterFromHost);
    bridge.on('net', this.fromPeer);
    bridge.on('peer', this.lobbyRequest);
    bridge.once('disconnected', () => { void this.detach(); });

    try {
      await this.until('游戏连接', (resolve, reject) => {
        bridge.once('connected', (hello: { pid: number; version: string }) => hello.pid === game.pid && hello.version === 'v2.2.0.6' ? resolve() : reject(new Error('本地客户端的进程或版本与启动请求不匹配。')));
        game.once('error', reject);
        game.once('exit', () => reject(new Error('本地客户端在连接前退出。')));
      });
      await this.until('主菜单', (resolve) => {
        const check = (snapshot: BuckshotSnapshot) => { if (snapshot.scene === 'menu') { bridge.off('snapshot', check); resolve(); } };
        if (bridge.snapshot) check(bridge.snapshot);
        bridge.on('snapshot', check);
      });
      const reply = await bridge.request('peer_enter', { lobby }, options.actionTimeoutMs);
      if (!reply.ok) throw new Error(reply.detail);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const game = this.game;
    if (game?.exitCode === null) await this.bridge.request('quit', {}, this.options.actionTimeoutMs).catch(() => undefined);
    await this.detach();
    await this.bridge.stop();
    if (game?.pid && game.exitCode === null) await new Promise<void>((resolve) => { game.once('close', () => resolve()); if (!game.kill()) resolve(); });
  }

  private until(what: string, wait: (resolve: () => void, reject: (error: Error) => void) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待本地客户端${what}超时；检查 game-peer.log。`)), this.options.startupTimeoutMs);
      wait(() => { clearTimeout(timer); resolve(); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }

  private readonly fromHost = (message: { to?: unknown; from?: unknown; data?: unknown }) => {
    if (message.to === this.options.id) this.bridge.send('net', { from: message.from, data: message.data });
  };

  // The peer talks to the host only, whatever member it addresses.
  private readonly fromPeer = (message: { data?: unknown }) => { this.host.send('net', { from: this.options.id, data: message.data }); };

  private readonly rosterFromHost = (message: { peer?: unknown; roster?: unknown }) => { if (message.peer === this.options.id) this.bridge.send('roster', { roster: message.roster }); };

  /** The peer's lobby scripts asked to join or leave; the host answers in order. */
  private readonly lobbyRequest = (message: { event?: unknown; lobby?: unknown }) => {
    this.requests = this.requests.then(async () => {
      if (message.event === 'leave') { await this.leave(); return; }
      if (message.event !== 'join') return;
      const reply = await this.host.request('peer_attach', { peer: this.options.id, name: this.options.name, mock: this.options.mockSteamPlayer === true }, this.options.actionTimeoutMs).catch(() => null);
      const roster = (reply as { roster?: { lobby?: string } } | null)?.roster;
      const ok = reply?.ok === true && roster?.lobby === message.lobby;
      if (reply?.ok && !ok) await this.leave();
      this.bridge.send('peer_joined', { lobby: message.lobby, ok, roster: ok ? roster : {} });
      if (ok && !this.joined) { this.joined = true; this.options.onChange('joined'); }
    }).catch(() => undefined);
  };

  private async leave(): Promise<void> {
    await this.host.request('peer_detach', { peer: this.options.id }, this.options.actionTimeoutMs).catch(() => undefined);
    if (this.joined) { this.joined = false; this.options.onChange('left'); }
  }

  /** Takes the peer out of the host's lobby for good and stops relaying. */
  private async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    this.host.off('net', this.fromHost);
    this.host.off('roster', this.rosterFromHost);
    await this.requests;
    await this.leave();
  }
}
