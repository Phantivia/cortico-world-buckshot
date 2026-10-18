// Live check of local peer with the real game. The host process hosts a lobby, a local peer joins it, the match starts
// and both sides pick up items and fire; each side prints what it saw.
// --with-remote adds a mock Steam player: another local process the host counts as a Steam member and that sees the
// member list Steam would show it. It checks three players together, the local peer leaving mid-match (everyone goes
// back to the lobby) and the Steam player leaving mid-match (the others play on).
// Usage: pnpm tsx scripts/check-local-peer.ts <Buckshot Roulette.exe> [--with-remote] [--screen=<index>]
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BuckshotBridge } from '../src/bridge.ts';
import { prepareImplant } from '../src/implant.ts';
import { LOCAL_PEER_ID, LocalPeer } from '../src/peer.ts';
import type { BuckshotSnapshot } from '../src/protocol.ts';
import { renderSnapshot } from '../src/render.ts';

const REMOTE_ID = '76561190000000002';
const args = process.argv.slice(2);
const executableFile = args.find((value) => !value.startsWith('--'));
if (!executableFile) throw new Error('Usage: pnpm tsx scripts/check-local-peer.ts <Buckshot Roulette.exe> [--with-remote]');
const withRemote = args.includes('--with-remote');
const screen = args.find((value) => value.startsWith('--screen='))?.slice('--screen='.length);
const runtimeDir = resolve('scratch/local-peer-check');
await mkdir(runtimeDir, { recursive: true });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function snapshot(bridge: BuckshotBridge): Promise<BuckshotSnapshot> {
  const reply = await bridge.request('snapshot', {}, 10000);
  if (!reply.snapshot) throw new Error(reply.detail);
  return reply.snapshot;
}

async function waitFor(bridge: BuckshotBridge, what: string, test: (s: BuckshotSnapshot) => boolean, ms = 60000): Promise<BuckshotSnapshot> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const current = await snapshot(bridge);
    if (test(current)) return current;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function press(bridge: BuckshotBridge, label: RegExp, ms = 60000): Promise<void> {
  const current = await waitFor(bridge, String(label), (s) => s.actions.some((a) => label.test(a.label)), ms);
  const target = current.actions.find((a) => label.test(a.label))!;
  const reply = await bridge.request('act', { target: target.id, revision: current.revision }, 10000);
  console.log(`press ${target.label}: ${reply.detail}`);
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  console.log(`ok: ${message}`);
}

const players = (s: BuckshotSnapshot) => (s.players ?? []).map((p) => `${p.seat}:${p.name || '(空)'}:${p.health ?? '?'}`).sort().join(' ');
const seatsAndHealth = (s: BuckshotSnapshot) => (s.players ?? []).map((p) => `${p.seat}:${p.health ?? '?'}`).sort().join(' ');
const inMatch = (count: number) => (s: BuckshotSnapshot) => s.mode === 'multiplayer' && (s.players?.length ?? 0) === count;

/** Whoever can act picks up items or the shotgun and fires at another seat, until `shots` shots or the time runs out. */
async function play(sides: Array<[string, BuckshotBridge]>, shots: number, ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  let fired = 0;
  while (Date.now() < deadline && fired < shots) {
    for (const [name, bridge] of sides) {
      const current = await snapshot(bridge).catch(() => null);
      if (!current) continue;
      const target = current.actions.find((a) => /^shoot seat/.test(a.label) && a.side !== String(current.localSeat))
        ?? current.actions.find((a) => /shotgun/.test(a.label))
        ?? current.actions.find((a) => a.kind === 'multiplayer interaction' && !/^shoot seat|^jam/.test(a.label));
      if (!target) continue;
      const reply = await bridge.request('act', { target: target.id, revision: current.revision }, 10000);
      console.log(`[${name}] act ${target.label}: ${reply.detail}`);
      if (/^shoot seat/.test(target.label)) fired++;
      await sleep(1500);
    }
    await sleep(1000);
  }
  return fired;
}

const hostPack = await prepareImplant(executableFile, runtimeDir);
const peerPack = await prepareImplant(executableFile, runtimeDir, 'local-peer');
const remotePack = withRemote ? await prepareImplant(executableFile, runtimeDir, 'mock-remote') : '';
const host = new BuckshotBridge();
const port = await host.start();
const log = createWriteStream(join(runtimeDir, 'host.log'));
const game = spawn(executableFile, ['--windowed', '--audio-driver', 'Dummy', ...(screen ? ['--screen', screen] : []), '--main-pack', hostPack, '--', `--cortico-executable=${executableFile}`, `--cortico-port=${port}`, `--cortico-token=${host.token}`], { cwd: dirname(executableFile), stdio: ['ignore', 'pipe', 'pipe'] });
game.stdout?.pipe(log); game.stderr?.pipe(log);
host.on('observation', (event: { kind: string; facts: unknown }) => { if (['load', 'shot', 'health', 'result'].includes(event.kind)) console.log(`[host] ${event.kind} ${JSON.stringify(event.facts)}`); });

const peers: LocalPeer[] = [];
async function enter(id: string, name: string, pack: string, mock: boolean): Promise<LocalPeer> {
  let joined = false;
  const peer = new LocalPeer(host, { id, mockSteamPlayer: mock, executableFile: executableFile!, packFile: pack, logFile: join(runtimeDir, `${mock ? 'remote' : 'peer'}.log`), name, screenIndex: null, muteAudio: true, startupTimeoutMs: 60000, actionTimeoutMs: 10000,
    onChange: (change) => { if (change === 'joined') joined = true; console.log(`${name} ${change}`); } });
  peers.push(peer);
  const lobby = await host.request('peer_lobby', { peer: id }, 10000);
  if (!lobby.ok) throw new Error(lobby.detail);
  await peer.start((lobby as { lobby?: string }).lobby ?? '');
  for (let i = 0; i < 60 && !joined; i++) await sleep(1000);
  if (!joined) throw new Error(`${name} did not join`);
  return peer;
}

async function memberLimit(): Promise<unknown> {
  return (await host.request('peer_lobby', { peer: LOCAL_PEER_ID }, 10000) as { memberLimit?: unknown }).memberLimit;
}

try {
  await once(host, 'connected');
  await press(host, /^skip intro$/, 15000).catch(() => undefined);
  await press(host, /^start multiplayer/);
  await waitFor(host, 'lobby scene', (s) => s.scene === 'mp_lobby');
  await press(host, /^create lobby/);
  for (let i = 0; !(await host.request('peer_lobby', { peer: LOCAL_PEER_ID }, 10000)).ok; i++) {
    if (i === 60) throw new Error('the host did not open a lobby');
    await sleep(1000);
  }
  console.log(`member limit before: ${await memberLimit()}`);

  if (!withRemote) {
    const peer = await enter(LOCAL_PEER_ID, 'Player 2', peerPack, false);
    await sleep(4000);
    await press(host, /^start game/);
    const views: Array<[string, BuckshotBridge]> = [['host', host], ['peer', peer.bridge]];
    for (const [name, bridge] of views) console.log(`${name}: ${players(await waitFor(bridge, `${name} match`, inMatch(2), 90000))}`);
    await play(views, 6, 240000);
    for (const [name, bridge] of views) {
      const frame = await bridge.request('capture', {}, 10000);
      if (frame.png) await writeFile(join(runtimeDir, `${name}.png`), Buffer.from(frame.png, 'base64'));
      console.log(`--- ${name}\n${renderSnapshot(await snapshot(bridge))}`);
    }
  } else {
    // 1. a Steam player and the local peer in one lobby
    const remote = await enter(REMOTE_ID, 'Remote', remotePack, true);
    let peer = await enter(LOCAL_PEER_ID, 'Player 2', peerPack, false);
    check(await memberLimit() === 3, 'the local peer takes one of four Steam seats');
    await sleep(4000);
    const lobbyText = async (bridge: BuckshotBridge) => (await snapshot(bridge)).texts.join(' | ');
    const [hostLobby, remoteLobby, peerLobby] = [await lobbyText(host), await lobbyText(remote.bridge), await lobbyText(peer.bridge)];
    console.log(`host lobby: ${hostLobby}\nremote lobby: ${remoteLobby}\npeer lobby: ${peerLobby}`);
    check(hostLobby.includes('Player 2') && hostLobby.includes('Remote'), 'the host lists both');
    check(!remoteLobby.includes('Player 2'), 'the Steam player does not list the local peer, as with Steam');

    // 2. three players in a match; the Steam player seats the local peer from the host's setup
    await press(host, /^start game/);
    let views: Array<[string, BuckshotBridge]> = [['host', host], ['remote', remote.bridge], ['peer', peer.bridge]];
    for (const [name, bridge] of views) console.log(`${name}: ${players(await waitFor(bridge, `${name} match`, inMatch(3), 90000))}`);
    await play(views, 4, 200000);
    await sleep(3000);
    const seen = await Promise.all(views.map(async ([, bridge]) => seatsAndHealth(await snapshot(bridge))));
    console.log(`seats and health: ${seen.join(' / ')}`);
    check(seen.every((value) => value === seen[0]), 'seats and health agree on all three');

    // 3. the local peer leaves mid-match: everyone goes back to the lobby
    await peer.stop();
    for (const [name, bridge] of [['host', host], ['remote', remote.bridge]] as const) await waitFor(bridge, `${name} back in lobby`, (s) => s.scene === 'mp_lobby', 60000);
    check(true, 'host and Steam player are back in the lobby');
    for (let i = 0; !(await host.request('peer_lobby', { peer: LOCAL_PEER_ID }, 10000)).ok; i++) {
      if (i === 60) throw new Error('the host lobby did not reopen');
      await sleep(1000);
    }
    check(await memberLimit() === 4, 'the seat is back for Steam');

    // 4. the local peer comes back; this time the Steam player leaves mid-match and the other two play on
    peer = await enter(LOCAL_PEER_ID, 'Player 2', peerPack, false);
    await sleep(4000);
    await press(host, /^start game/);
    views = [['host', host], ['remote', remote.bridge], ['peer', peer.bridge]];
    for (const [name, bridge] of views) await waitFor(bridge, `${name} match`, inMatch(3), 90000);
    await play(views, 1, 120000);
    await remote.stop();
    views = [['host', host], ['peer', peer.bridge]];
    for (const [name, bridge] of views) console.log(`${name} after the Steam player left: ${players(await waitFor(bridge, `${name} two players`, inMatch(2), 60000))}`);
    check(await play(views, 2, 150000) === 2, 'host and local peer play on');
  }
} finally {
  for (const peer of peers) await peer.stop();
  await host.request('quit', {}, 3000).catch(() => undefined);
  if (game.exitCode === null) { const closed = once(game, 'close'); if (game.kill()) await closed; }
  await host.stop();
}
