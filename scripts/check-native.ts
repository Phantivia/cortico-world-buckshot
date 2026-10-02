import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuckshotBridge } from '../src/bridge.ts';
import { setProjectSettings } from '../src/implant.ts';
import { readPack, writePatchedPack } from '../src/pck.ts';
import { verifyInstallation } from '../src/fingerprint.ts';
import type { BuckshotSnapshot } from '../src/protocol.ts';

const executableFile = process.argv[2];
if (!executableFile) throw new Error('Usage: pnpm check:native <Buckshot Roulette.exe>');
await verifyInstallation(executableFile);
await mkdir('scratch', { recursive: true });
const directory = await mkdtemp(resolve('scratch/native-'));
const sources = new Map<string, Buffer>();
const fixtureDir = fileURLToPath(new URL('./native-fixture/', import.meta.url));
for (const file of await readdir(fixtureDir)) sources.set(`res://fixture/${file}`, await readFile(join(fixtureDir, file)));
sources.set('res://cortico/bridge.gd', await readFile(fileURLToPath(new URL('../src/native/bridge.gd', import.meta.url))));
sources.set('res://project.binary', setProjectSettings(Buffer.from('ECFG\0\0\0\0'), new Map([
  ['autoload/CorticoBridge', '*res://cortico/bridge.gd'], ['autoload/GlobalVariables', '*res://fixture/GlobalVariables.gd'],
  ['application/run/main_scene', 'res://fixture/main.tscn'],
])));
const packFile = join(directory, 'fixture.pck');
await writePatchedPack(await readPack(executableFile), sources, packFile, false);
const bridge = new BuckshotBridge();
const port = await bridge.start();
const log = createWriteStream(join(directory, 'engine.log'));
log.on('error', (error) => console.error(error.message));
const ready = once(bridge, 'connected');
const fault = new Promise<never>((_, reject) => bridge.once('fault', reject));
const game = spawn(executableFile, ['--headless', '--main-pack', packFile, '--', `--cortico-port=${port}`, `--cortico-token=${bridge.token}`], { cwd: dirname(executableFile), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
game.stdout?.pipe(log, { end: false }); game.stderr?.pipe(log, { end: false });
const failed = new Promise<never>((_, reject) => { game.once('error', reject); game.once('exit', (code) => reject(new Error(`Fixture engine exited: ${code}`))); });
const timeout = setTimeout(() => { game.kill(); }, 30000);
async function observe(): Promise<BuckshotSnapshot> {
  const reply = await bridge.request('snapshot', {}, 3000);
  assert(reply.ok && reply.snapshot); return reply.snapshot;
}
async function select(snapshot: BuckshotSnapshot) {
  const target = snapshot.actions.find((target) => target.label === 'confirm');
  assert(target, 'Transparent UI hitbox is actionable');
  const reply = await bridge.request('act', { target: target.id, revision: snapshot.revision }, 3000);
  assert(reply.ok && reply.snapshot); return reply.snapshot;
}
try {
  await Promise.race([ready, fault, failed]);
  let snapshot = await observe();
  assert(snapshot.texts.includes('READY'), 'Automatic translation matches displayed text');
  assert(snapshot.texts.includes('fixture.ready'), 'Literal labels retain their text');
  assert.equal(snapshot.actions.find(target => target.label === 'confirm')?.caption, 'READY');
  assert.equal(snapshot.outcome, undefined, 'Default visible ending resources do not signal victory');
  const target = snapshot.actions.find((target) => target.label === 'confirm')!;
  assert.equal((await bridge.request('act', { target: target.id, revision: snapshot.revision - 1 }, 3000)).ok, false);
  snapshot = await select(snapshot);
  assert.equal(snapshot.outcome, undefined);
  assert.deepEqual(snapshot.shells, { load: 1, initialLive: 1, initialBlank: 2, consumed: 0, known: {}, inversions: [], ejected: [] });
  snapshot = await select(snapshot);
  assert.deepEqual(snapshot.shells.known, { '1': 'blank' });
  snapshot = await select(snapshot);
  assert.equal(snapshot.shells.consumed, 1);
  assert.deepEqual(snapshot.shells.ejected, [{ load: 1, ordinal: 1, shell: 'blank', actor: 'player' }]);
  assert.deepEqual(snapshot.shells.inversions, [1]);
  assert.deepEqual(snapshot.shells.known, { '1': 'blank' });
  assert.equal(snapshot.outcome, undefined);
  snapshot = await select(snapshot);
  assert.equal(snapshot.outcome, 'won'); assert.equal(snapshot.cash, 100);
  await select(snapshot);
  await new Promise((resolve) => setTimeout(resolve, 200));
  snapshot = await observe();
  assert.equal(snapshot.outcome, undefined);
  assert.deepEqual(snapshot.shells, {});
  console.log('Native checks passed: visible translations, target permissions, stale input, public shell ledger, explicit result, scene reset');
} finally {
  clearTimeout(timeout);
  await bridge.request('quit', {}, 3000).catch(() => undefined);
  if (game.pid && game.exitCode === null) { const closed = once(game, 'close'); if (game.kill()) await closed; }
  await bridge.stop(); log.end();
}
