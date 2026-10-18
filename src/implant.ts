import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKSHOT_PROFILE, hashFile, verifyInstallation } from './fingerprint.ts';
import { readPack, readResource, writePatchedPack } from './pck.ts';

const BRIDGE_FILE = fileURLToPath(new URL('./native/bridge.gd', import.meta.url));
const BRIDGE_NODE = 'get_node("/root/CorticoBridge")';

export interface ScriptHook { path: string; anchor: string; insertion: string; before?: boolean; replace?: boolean; occurrences?: number; }

export const BUCKSHOT_SCRIPT_HOOKS: readonly ScriptHook[] = [
  { path: 'scripts/ShellSpawner.gd', anchor: '\tanim_compartment.play("show shells")\n', insertion: `\t${BRIDGE_NODE}.ObserveLoad(temp_live, temp_blank)\n` },
  { path: 'scripts/ShellExamine.gd', anchor: '\tshellParent.visible = true\n', insertion: `\t${BRIDGE_NODE}.ObserveReveal(0, shellState, "magnifying glass")\n` },
  { path: 'scripts/BurnerPhone.gd', anchor: '\tdia.ShowText_Forever(fulldia)\n', insertion: `\tif len != 1: ${BRIDGE_NODE}.ObserveReveal(randindex, sequence[randindex], "burner phone")\n` },
  { path: 'scripts/ShellEjectManager.gd', anchor: '\tshellSpawner.sequenceArray.remove_at(0)\n', insertion: `\t${BRIDGE_NODE}.ObserveEjection(shellSpawner.sequenceArray[0], isDealerSide)\n`, before: true, occurrences: 4 },
  { path: 'scripts/ItemInteraction.gd', anchor: '\t\t"inverter":\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveInverter()\n` },
  { path: 'scripts/HandManager.gd', anchor: '\t\t\thand_inverter.visible = true\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveInverter("dealer")\n` },
  { path: 'scripts/HealthCounter.gd', anchor: '\tFlickerLastDigit()\n', insertion: `\t${BRIDGE_NODE}.ObserveHealth(roundManager.health_player if !defibCutter.displayBroken_player else null, roundManager.health_opponent if !defibCutter.displayBroken_dealer else null)\n` },
  { path: 'scripts/EndingManager.gd', anchor: '\tdia.ShowText_Forever(glob_text_congratulations)\n', insertion: `\t${BRIDGE_NODE}.ObserveOutcome("won", cash_gl)\n` },
  { path: 'scripts/ShotgunShooting.gd', anchor: '\tPlayShootingSound()\n', insertion: `\t${BRIDGE_NODE}.ObserveShot("player", whoshot, currentRoundInChamber)\n` },
  { path: 'scripts/DealerIntelligence.gd', anchor: '\t\t\tshotgunShooting.PlayShootingSound()\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveShot("dealer", shotgunShooting.whoshot, currentRoundInChamber)\n`, occurrences: 2 },
  { path: 'scripts/ItemInteraction.gd', anchor: 'func InteractWith(itemName : String):\n', insertion: `\t${BRIDGE_NODE}.Record("item", {"actor": "player", "item": itemName})\n` },
  { path: 'scripts/HandManager.gd', anchor: '\tanimator_hands.play(animationName)\n', insertion: `\t${BRIDGE_NODE}.Record("item", {"actor": "dealer", "item": itemName})\n` },
  { path: 'scripts/DeathManager.gd', anchor: '\t\t\t\tviewblocker.visible = false\n', insertion: `\t\t\t\t${BRIDGE_NODE}.Record("revival", {"actor": "player"})\n` },
  ...['scripts/DialogueManager.gd', 'scripts/DialogueManager_Ending.gd', 'multiplayer/scripts/user scripts/MP_DialogueManager.gd'].map((path): ScriptHook => ({ path, anchor: '\t\tif (dialogueUI.visible_ratio >= 1):\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveDialogue(dialogueUI)\n` })),
  { path: 'multiplayer/scripts/global scripts/MP_ShellLoader.gd', anchor: '\tvar sequence = game_state.MAIN_active_sequence_dict.sequence_visible\n', insertion: `\t${BRIDGE_NODE}.ObserveLoad(sequence.count("live"), sequence.count("blank"))\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ShellEjection.gd', anchor: '\tanimator_fade_out.play("set visible")\n', insertion: `\t${BRIDGE_NODE}.ObserveEjection(shell_to_eject, str(properties.socket_number))\n` },
  { path: 'multiplayer/scripts/user scripts/MP_BurnerPhone.gd', anchor: '\tproperties.dialogue.ShowText_Forever(GetBurnerPhoneString(game_state.MAIN_phone_verbal_index, game_state.MAIN_phone_verbal_shell))\n', insertion: `\tif properties.is_active and game_state.MAIN_phone_verbal_index > 0: ${BRIDGE_NODE}.ObserveReveal(game_state.MAIN_phone_verbal_index - 1, game_state.MAIN_phone_verbal_shell, "burner phone")\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ItemInteraction.gd', anchor: '\t\t\tshell_branch_inspection.SetState_Inspecting(shell_in_chamber)\n', insertion: `\t\t\tif properties.is_active: ${BRIDGE_NODE}.ObserveLocalReveal(shell_in_chamber, shell_branch_inspection.shell)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ItemInteraction.gd', anchor: '\t\t\tif GlobalSteam.STEAM_ID == GlobalSteam.HOST_ID:\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveInverter(str(properties.socket_number))\n`, before: true },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tif properties.is_active: speaker_health_bootup.play()\n', insertion: `\t${BRIDGE_NODE}.ObserveSeatHealth(properties.socket_number, starting_health)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tui_round_indicator_selector.visible = true\n', insertion: `\tif properties.is_active: ${BRIDGE_NODE}.ObserveRound(current_round)\n` },
  { path: 'multiplayer/scripts/global scripts/MP_TurnOrder.gd', anchor: '\t\tanimator_indicator.play("loop clockwise")\n', insertion: `\t\t${BRIDGE_NODE}.ObserveTurnOrder(direction)\n` },
  { path: 'multiplayer/scripts/global scripts/MP_TurnOrder.gd', anchor: '\t\tanimator_indicator.play_backwards("loop clockwise")\n', insertion: `\t\t${BRIDGE_NODE}.ObserveTurnOrder(direction)\n` },
  { path: 'multiplayer/scripts/global scripts/MP_RoundManager.gd', anchor: '\n\t\t\tactive_properties.has_turn = true\n', insertion: `\t\t\t${BRIDGE_NODE}.ObserveTurn(to_socket)\n` },
  { path: 'multiplayer/scripts/global scripts/MP_RoundManager.gd', anchor: '\n\t\tactive_properties.has_turn = true\n', insertion: `\t\t${BRIDGE_NODE}.ObserveTurn(to_socket)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tprev_health = health\n', insertion: `\tif ui_main_parent.visible: ${BRIDGE_NODE}.ObserveSeatHealth(properties.socket_number, health)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tui_main_parent.visible = false\n', insertion: `\t${BRIDGE_NODE}.ObserveSeatHealth(properties.socket_number, null)\n` },
  { path: 'multiplayer/scripts/user scripts/MP_HealthCounter.gd', anchor: '\tui_main_parent.visible = true\n', insertion: `\t${BRIDGE_NODE}.ObserveSeatHealth(properties.socket_number, properties.health_current)\n` },
  { path: 'multiplayer/scripts/MP_LobbyManager.gd', anchor: '\tDisplayServer.clipboard_set(str(GlobalSteam.LOBBY_ID))\n', insertion: `\t${BRIDGE_NODE}.Record("clipboard", {"text": str(GlobalSteam.LOBBY_ID)})\n` },
  { path: 'multiplayer/scripts/global scripts/MP_OutroManager.gd', anchor: '\tdialogue_results.ShowText_Forever(tr("MP_UI MATCH RESULTS"))\n', insertion: `\t${BRIDGE_NODE}.ObserveOutcome("completed")\n` },
  { path: 'multiplayer/scripts/user scripts/MP_ShotgunInteraction.gd', anchor: '\tvar current_shell = intermediary.game_state.MAIN_shooter_shell\n', insertion: `\t${BRIDGE_NODE}.ObserveShot(str(active_shooter_socket_self), str(active_shooter_socket_target), current_shell)\n` },
  ...['firstperson', 'thirdperson'].map((person): ScriptHook => ({ path: 'multiplayer/scripts/user scripts/MP_ItemInteraction.gd', anchor: `\tanimator_items_${person}.play(animation_name)\n`, insertion: `\t${BRIDGE_NODE}.ObserveItem(str(properties.socket_number), active_id, properties.intermediary.game_state.MAIN_item_resource_array)\n` })),
  // Local peer: a second game process sits in the host's lobby as a member Steam does not know about. Its packets,
  // membership and name go through CorticoBridge, which hands every other member to Steam.
  ...([
    ['multiplayer/scripts/MP_PacketManager.gd', 'Steam.sendP2PPacket(', 'SendP2PPacket(', 2],
    ['multiplayer/scripts/MP_PacketManager.gd', 'Steam.getAvailableP2PPacketSize(0)', 'GetAvailableP2PPacketSize(0)', 2],
    ['multiplayer/scripts/MP_PacketManager.gd', 'Steam.readP2PPacket(packet_size, 0)', 'ReadP2PPacket(packet_size, 0)', 1],
    ['multiplayer/scripts/MP_PacketManager.gd', 'Steam.getFriendPersonaName(', 'PersonaName(', 1],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.getNumLobbyMembers(', 'NumLobbyMembers(', 1],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.getLobbyMemberByIndex(', 'LobbyMemberByIndex(', 1],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.getLobbyOwner(', 'LobbyOwner(', 2],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.joinLobby(', 'JoinLobby(', 1],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.leaveLobby(', 'LeaveLobby(', 1],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.getFriendPersonaName(', 'PersonaName(', 4],
    ['multiplayer/scripts/MP_LobbyManager.gd', 'Steam.setLobbyMemberLimit(', 'SetLobbyMemberLimit(', 2],
    ['multiplayer/scripts/global scripts/MP_OutroManager.gd', 'Steam.getFriendPersonaName(', 'PersonaName(', 6],
    ['multiplayer/scripts/global scripts/MP_UserInstanceHandler.gd', 'Steam.getFriendPersonaName(', 'PersonaName(', 1],
    ['multiplayer/scripts/user scripts/MP_UserStateManager.gd', 'Steam.getFriendPersonaName(', 'PersonaName(', 1],
  ] as const).map(([path, anchor, call, occurrences]): ScriptHook => ({ path, anchor, insertion: `${BRIDGE_NODE}.${call}`, replace: true, occurrences })),
  // The local peer leaves Steam uninitialised, so it never acts as the account the host is signed in with.
  { path: 'scripts/Steam.gd', anchor: 'func InitializeSteam():\n', insertion: `\tif ${BRIDGE_NODE}.IsLocalPeer(): return\n` },
  { path: 'scripts/Steam.gd', anchor: '\tif GlobalVariables.mp_debugging: STEAM_ID = 1234\n', insertion: `\t${BRIDGE_NODE}.AdoptPeerIdentity(self)\n` },
];

export function applyHook(source: string, hook: ScriptHook): string {
  const segments = source.split(hook.anchor);
  if (segments.length === 1) throw new Error(`Game hook anchor missing: ${hook.path}`);
  if (segments.length - 1 !== (hook.occurrences ?? 1)) throw new Error(`Ambiguous game hook anchor: ${hook.path}`);
  return segments.join(hook.replace ? hook.insertion : hook.before ? hook.insertion + hook.anchor : hook.anchor + hook.insertion);
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

/** A `profile` such as 'local-peer' builds the pack for another local process, which keeps its settings and saves apart. */
export async function prepareImplant(executableFile: string, runtimeDir: string, profile = ''): Promise<string> {
  await verifyInstallation(executableFile);
  const bridge = await readFile(BRIDGE_FILE);
  const saveProfile = createHash('sha256').update(resolve(runtimeDir)).update(profile ? `:${profile}` : '').digest('hex').slice(0, 16);
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
