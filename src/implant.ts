import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKSHOT_PROFILE, hashFile, verifyInstallation } from './fingerprint.ts';
import { readPack, readResource, writePatchedPack } from './pck.ts';

const BRIDGE_FILE = fileURLToPath(new URL('./native/bridge.gd', import.meta.url));
const BRIDGE_NODE = 'get_node("/root/CorticoBridge")';

export interface ScriptHook { path: string; anchor: string; insertion: string; before?: boolean; occurrences?: number; }

export const BUCKSHOT_SCRIPT_HOOKS: readonly ScriptHook[] = [
  { path: 'scripts/ShellSpawner.gd', anchor: '\tanim_compartment.play("show shells")\n', insertion: `\t${BRIDGE_NODE}.ObserveLoad(temp_live, temp_blank)\n` },
  { path: 'scripts/ShellExamine.gd', anchor: '\tshellParent.visible = true\n', insertion: `\t${BRIDGE_NODE}.ObserveReveal(0, shellState, "magnifying glass")\n` },
  { path: 'scripts/BurnerPhone.gd', anchor: '\tdia.ShowText_Forever(fulldia)\n', insertion: `\tif len != 1: ${BRIDGE_NODE}.ObserveReveal(randindex, sequence[randindex], "burner phone")\n` },
  { path: 'scripts/ShellEjectManager.gd', anchor: '\tshellSpawner.sequenceArray.remove_at(0)\n', insertion: `\t${BRIDGE_NODE}.ObserveEjection(shellSpawner.sequenceArray[0], isDealerSide)\n`, before: true, occurrences: 4 },
  { path: 'scripts/ItemInteraction.gd', anchor: '\t\t"inverter":\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveInverter()\n` },
  { path: 'scripts/HealthCounter.gd', anchor: '\tFlickerLastDigit()\n', insertion: `\t${BRIDGE_NODE}.ObserveHealth(roundManager.health_player if !defibCutter.displayBroken_player else null, roundManager.health_opponent if !defibCutter.displayBroken_dealer else null)\n` },
  { path: 'multiplayer/scripts/global scripts/MP_ShellLoader.gd', anchor: '\tvar sequence = game_state.MAIN_active_sequence_dict.sequence_visible\n', insertion: `\t${BRIDGE_NODE}.ObserveLoad(sequence.count("live"), sequence.count("blank"))\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ShellEjection.gd', anchor: '\tanimator_fade_out.play("set visible")\n', insertion: `\t${BRIDGE_NODE}.ObserveEjection(shell_to_eject, str(properties.socket_number))\n` },
  { path: 'multiplayer/scripts/user scripts/MP_BurnerPhone.gd', anchor: '\tproperties.dialogue.ShowText_Forever(GetBurnerPhoneString(game_state.MAIN_phone_verbal_index, game_state.MAIN_phone_verbal_shell))\n', insertion: `\tif properties.is_active and game_state.MAIN_phone_verbal_index > 0: ${BRIDGE_NODE}.ObserveReveal(game_state.MAIN_phone_verbal_index - 1, game_state.MAIN_phone_verbal_shell, "burner phone")\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ItemInteraction.gd', anchor: '\t\t\tshell_branch_inspection.SetState_Inspecting(shell_in_chamber)\n', insertion: `\t\t\tif properties.is_active: ${BRIDGE_NODE}.ObserveLocalReveal(shell_in_chamber, shell_branch_inspection.shell)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ItemInteraction.gd', anchor: '\t\t\tif GlobalSteam.STEAM_ID == GlobalSteam.HOST_ID:\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveInverter()\n`, before: true },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tif properties.is_active: speaker_health_bootup.play()\n', insertion: `\t${BRIDGE_NODE}.ObserveSeatHealth(properties.socket_number, starting_health)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tprev_health = health\n', insertion: `\t${BRIDGE_NODE}.ObserveSeatHealth(properties.socket_number, health)\n` },
];

export function applyHook(source: string, hook: ScriptHook): string {
  const segments = source.split(hook.anchor);
  if (segments.length === 1) throw new Error(`Game hook anchor missing: ${hook.path}`);
  if (segments.length - 1 !== (hook.occurrences ?? 1)) throw new Error(`Ambiguous game hook anchor: ${hook.path}`);
  return segments.join(hook.before ? hook.insertion + hook.anchor : hook.anchor + hook.insertion);
}

/** Adds an autoload to ECFG without re-encoding existing Variant values. */
export function setProjectSettings(project: Buffer, values: ReadonlyMap<string, string | boolean>): Buffer {
  if (project.subarray(0, 4).toString() !== 'ECFG') throw new Error('Expected binary Godot project settings');
  const records: Buffer[] = [];
  let cursor = 8;
  for (let i = 0; i < project.readUInt32LE(4); i++) {
    const start = cursor;
    if (cursor + 4 > project.length) throw new Error('Truncated Godot project setting');
    const nameLength = project.readUInt32LE(cursor);
    cursor += 4;
    if (cursor + nameLength + 4 > project.length) throw new Error('Invalid Godot project setting name');
    const name = project.subarray(cursor, cursor + nameLength).toString();
    cursor += nameLength;
    const length = project.readUInt32LE(cursor);
    cursor += 4 + length;
    if (cursor > project.length) throw new Error('Truncated Godot project setting value');
    if (!values.has(name)) records.push(project.subarray(start, cursor));
  }
  for (const [key, setting] of values) {
    const name = Buffer.from(key);
    let variant: Buffer;
    if (typeof setting === 'boolean') {
      variant = Buffer.alloc(8);
      variant.writeUInt32LE(1);
      variant.writeUInt32LE(setting ? 1 : 0, 4);
    } else {
      const value = Buffer.from(setting);
      variant = Buffer.alloc(8 + Math.ceil(value.length / 4) * 4);
      variant.writeUInt32LE(4);
      variant.writeUInt32LE(value.length, 4);
      value.copy(variant, 8);
    }
    const record = Buffer.alloc(8 + name.length);
    record.writeUInt32LE(name.length);
    name.copy(record, 4);
    record.writeUInt32LE(variant.length, 4 + name.length);
    if (key === 'autoload/CorticoBridge') records.unshift(Buffer.concat([record, variant]));
    else records.push(Buffer.concat([record, variant]));
  }
  const header = Buffer.from('ECFG\0\0\0\0');
  header.writeUInt32LE(records.length, 4);
  return Buffer.concat([header, ...records]);
}

export async function prepareImplant(executableFile: string, runtimeDir: string): Promise<string> {
  await verifyInstallation(executableFile);
  const bridge = await readFile(BRIDGE_FILE);
  const saveProfile = createHash('sha256').update(resolve(runtimeDir)).digest('hex').slice(0, 16);
  const revision = createHash('sha256').update(bridge).update(JSON.stringify(BUCKSHOT_SCRIPT_HOOKS)).update(setProjectSettings.toString()).update(prepareImplant.toString()).update(saveProfile).digest('hex');
  const directory = join(runtimeDir, BUCKSHOT_PROFILE.id, revision);
  const outputFile = join(directory, 'buckshot.pck');
  const manifestFile = join(directory, 'artifact.json');
  const cached = await readFile(manifestFile, 'utf8').then((text) => JSON.parse(text) as { sha256: string }).catch(() => null);
  if (cached && await hashFile(outputFile).catch(() => '') === cached.sha256) return outputFile;
  const pack = await readPack(executableFile);
  const replacements = new Map<string, Buffer>();
  replacements.set('res://cortico/bridge.gd', bridge);
  replacements.set('res://.godot/global_script_class_cache.cfg', await readResource(pack, 'res://.godot/global_script_class_cache.cfg'));
  for (const entry of pack.entries) {
    if (entry.path.endsWith('.translation') || entry.path.endsWith('/uid_cache.bin')
      || entry.path.includes('default_bus_layout') || entry.path.includes('cursor xp_point.png')) {
      replacements.set(entry.path, await readResource(pack, entry.path));
    }
  }
  replacements.set('res://project.binary', setProjectSettings(await readResource(pack, 'res://project.binary'), new Map<string, string | boolean>([
    ['autoload/CorticoBridge', '*res://cortico/bridge.gd'],
    ['application/config/use_custom_user_dir', true],
    ['application/config/custom_user_dir_name', `Cortico/Buckshot/${saveProfile}`],
  ])));
  for (const hook of BUCKSHOT_SCRIPT_HOOKS) {
    const path = `res://${hook.path}`;
    replacements.set(path, Buffer.from(applyHook((replacements.get(path) ?? await readResource(pack, path)).toString('utf8'), hook)));
  }
  await mkdir(directory, { recursive: true });
  await writePatchedPack(pack, replacements, outputFile, false);
  await writeFile(manifestFile, JSON.stringify({ profile: BUCKSHOT_PROFILE.id, sha256: await hashFile(outputFile), saveProfile }, null, 2));
  return outputFile;
}
