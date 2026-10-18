// Live check of local peer: hosts a lobby, lets a local peer join it, starts the match and reports both views.
// Usage: pnpm tsx scripts/check-local-peer.ts <Buckshot Roulette.exe> [--screen=<index>] [--peer-screen=<index>]
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BuckshotBridge } from '../src/bridge.ts';
import { prepareImplant } from '../src/implant.ts';
import { LocalPeer } from '../src/peer.ts';
import type { BuckshotSnapshot } from '../src/protocol.ts';
import { renderSnapshot } from '../src/render.ts';

const args = process.argv.slice(2);
const executableFile = args.find((value) => !value.startsWith('--'));
if (!executableFile) throw new Error('Usage: pnpm tsx scripts/check-local-peer.ts <Buckshot Roulette.exe>');
const option = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const runtimeDir = resolve('scratch/local-peer-check');
await mkdir(runtimeDir, { recursive: true });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitFor(bridge: BuckshotBridge, what: string, test: (s: BuckshotSnapshot) => boolean, ms = 60000): Promise<BuckshotSnapshot> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const reply = await bridge.request('snapshot', {}, 10000);
    if (reply.snapshot && test(reply.snapshot)) return reply.snapshot;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function press(bridge: BuckshotBridge, label: RegExp, ms = 60000): Promise<void> {
  const snapshot = await waitFor(bridge, String(label), (s) => s.actions.some((a) => label.test(a.label)), ms);
  const target = snapshot.actions.find((a) => label.test(a.label))!;
  const reply = await bridge.request('act', { target: target.id, revision: snapshot.revision }, 10000);
  console.log(`press ${target.label}: ${reply.detail}`);
}

const hostPack = await prepareImplant(executableFile, runtimeDir);
const peerPack = await prepareImplant(executableFile, runtimeDir, true);
const host = new BuckshotBridge();
const port = await host.start();
const log = createWriteStream(join(runtimeDir, 'host.log'));
const screen = option('screen');
const game = spawn(executableFile, ['--windowed', '--audio-driver', 'Dummy', ...(screen ? ['--screen', screen] : []), '--main-pack', hostPack, '--', `--cortico-executable=${executableFile}`, `--cortico-port=${port}`, `--cortico-token=${host.token}`], { cwd: dirname(executableFile), stdio: ['ignore', 'pipe', 'pipe'] });
game.stdout?.pipe(log); game.stderr?.pipe(log);
const changes: string[] = [];
const peerScreen = option('peer-screen');
const peer = new LocalPeer(host, { executableFile, packFile: peerPack, logFile: join(runtimeDir, 'peer.log'), name: 'Player 2', screenIndex: peerScreen ? Number(peerScreen) : null, muteAudio: true, startupTimeoutMs: 60000, actionTimeoutMs: 10000, onChange: (change) => { changes.push(change); console.log(`peer ${change}`); } });
try {
  await once(host, 'connected');
  await press(host, /^skip intro$/, 15000).catch(() => undefined);
  await press(host, /^start multiplayer/);
  await waitFor(host, 'lobby scene', (s) => s.scene === 'mp_lobby');
  await press(host, /^create lobby/);
  let lobby = '';
  for (let i = 0; i < 60 && !lobby; i++) {
    const reply = await host.request('peer_lobby', { peer: '76561190000000001' }, 10000);
    if (reply.ok) lobby = (reply as { lobby?: string }).lobby ?? '';
    else { console.log(`lobby not ready: ${reply.detail}`); await sleep(1000); }
  }
  console.log(`lobby ${lobby}`);
  await peer.start(lobby);
  for (let i = 0; i < 60 && !changes.includes('joined'); i++) await sleep(1000);
  if (!changes.includes('joined')) throw new Error('peer did not join');
  await sleep(4000);
  console.log('--- host in lobby\n' + renderSnapshot((await host.request('snapshot', {}, 10000)).snapshot!));
  console.log('--- peer in lobby\n' + renderSnapshot((await peer.bridge.request('snapshot', {}, 10000)).snapshot!));
  await press(host, /^start game/);
  const hostMain = await waitFor(host, 'host match', (s) => s.mode === 'multiplayer' && (s.players?.length ?? 0) >= 2, 90000);
  const peerMain = await waitFor(peer.bridge, 'peer match', (s) => s.mode === 'multiplayer' && (s.players?.length ?? 0) >= 2, 90000);
  console.log('host players', JSON.stringify(hostMain.players), 'peer players', JSON.stringify(peerMain.players));
  // play: whoever can act picks up the shotgun and shoots the other seat, until someone dies or time runs out
  for (const [name, bridge] of [['host', host], ['peer', peer.bridge]] as const) {
    bridge.on('observation', (event: { kind: string; facts: unknown }) => { if (['load', 'shot', 'health', 'turn', 'result'].includes(event.kind)) console.log(`[${name}] ${event.kind} ${JSON.stringify(event.facts)}`); });
  }
  const deadline = Date.now() + 240000;
  let shots = 0;
  while (Date.now() < deadline && shots < 8) {
    for (const [name, bridge] of [['host', host], ['peer', peer.bridge]] as const) {
      const snapshot = (await bridge.request('snapshot', {}, 10000)).snapshot!;
      const target = snapshot.actions.find((a) => /^shoot seat/.test(a.label) && a.side !== String(snapshot.localSeat)) ?? snapshot.actions.find((a) => /shotgun/.test(a.label)) ?? snapshot.actions.find((a) => a.kind === 'multiplayer interaction' && !/^shoot seat|^jam/.test(a.label));
      if (!target) continue;
      const reply = await bridge.request('act', { target: target.id, revision: snapshot.revision }, 10000);
      console.log(`[${name}] act ${target.label}: ${reply.detail}`);
      if (/^shoot seat/.test(target.label)) shots++;
      await sleep(1500);
    }
    await sleep(1000);
  }
  for (const [name, bridge] of [['host', host], ['peer', peer.bridge]] as const) {
    const frame = await bridge.request('capture', {}, 10000);
    if (frame.png) await writeFile(join(runtimeDir, `${name}.png`), Buffer.from(frame.png, 'base64'));
    console.log(`--- ${name} in match\n` + renderSnapshot((await bridge.request('snapshot', {}, 10000)).snapshot!));
  }
} finally {
  if (!args.includes('--keep')) {
    await peer.stop();
    await host.request('quit', {}, 3000).catch(() => undefined);
    if (game.exitCode === null) { const closed = once(game, 'close'); if (game.kill()) await closed; }
    await host.stop();
  }
}
