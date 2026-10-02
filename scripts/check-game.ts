import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BuckshotBridge } from '../src/bridge.ts';
import { BUCKSHOT_PROFILE, verifyInstallation } from '../src/fingerprint.ts';
import { prepareImplant } from '../src/implant.ts';
import { renderSnapshot } from '../src/render.ts';

const args = process.argv.slice(2);
const executableFile = args.find((value) => !value.startsWith('--'));
if (!executableFile) throw new Error('Usage: pnpm check:game <Buckshot Roulette.exe> [--launch] [--headless] [--runtime-dir=<directory>]');
await verifyInstallation(executableFile);
console.log(`Verified ${BUCKSHOT_PROFILE.id}`);
if (args.includes('--launch')) {
  const runtimeDir = resolve(args.find((value) => value.startsWith('--runtime-dir='))?.slice('--runtime-dir='.length) ?? 'scratch/game-check');
  const packFile = await prepareImplant(executableFile, runtimeDir);
  const bridge = new BuckshotBridge();
  const port = await bridge.start();
  await mkdir(runtimeDir, { recursive: true });
  const log = createWriteStream(join(runtimeDir, 'game.log'));
  log.on('error', (error) => console.error(error.message));
  const connected = once(bridge, 'connected');
  const fault = new Promise<never>((_, reject) => bridge.once('fault', reject));
  const game = spawn(executableFile, [...(args.includes('--headless') ? ['--headless'] : ['--windowed']), '--main-pack', packFile, '--', `--cortico-executable=${executableFile}`, `--cortico-port=${port}`, `--cortico-token=${bridge.token}`], { cwd: dirname(executableFile), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  game.stdout?.pipe(log, { end: false }); game.stderr?.pipe(log, { end: false });
  const failed = new Promise<never>((_, reject) => { game.once('error', reject); game.once('exit', (code) => reject(new Error(`Game exited: ${code}`))); });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Game check timed out')), 30000); });
  try {
    await Promise.race([connected, fault, failed, deadline]);
    const reply = await bridge.request('snapshot', {}, 10000);
    if (!reply.ok || !reply.snapshot) throw new Error(reply.detail);
    console.log(renderSnapshot(reply.snapshot));
  } finally {
    clearTimeout(timer);
    await bridge.request('quit', {}, 3000).catch(() => undefined);
    if (game.pid && game.exitCode === null) { const closed = once(game, 'close'); if (game.kill()) await closed; }
    await bridge.stop(); log.end();
  }
}
