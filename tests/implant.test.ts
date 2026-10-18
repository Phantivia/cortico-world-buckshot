import { describe, expect, it } from 'vitest';
import { applyHook, setProjectSettings, type ScriptHook } from '../src/implant.ts';

function settings(project: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let at = 8;
  for (let i = 0; i < project.readUInt32LE(4); i++) {
    const length = project.readUInt32LE(at); at += 4;
    const name = project.subarray(at, at + length).toString(); at += length;
    const bytes = project.readUInt32LE(at); at += 4;
    result.set(name, project.subarray(at, at + bytes)); at += bytes;
  }
  expect(at).toBe(project.length);
  return result;
}

describe('implant settings', () => {
  it('keeps existing binary Variants intact and replaces settings without duplicates', () => {
    const empty = Buffer.from('ECFG\0\0\0\0');
    const first = setProjectSettings(empty, new Map<string, string | boolean>([['application/config/name', 'Game'], ['application/config/use_custom_user_dir', false]]));
    const patched = setProjectSettings(first, new Map<string, string | boolean>([['autoload/CorticoBridge', '*res://cortico/bridge.gd'], ['application/config/use_custom_user_dir', true]]));
    const entries = settings(patched);
    expect([...entries.keys()][0]).toBe('autoload/CorticoBridge');
    expect(entries.size).toBe(3);
    expect(entries.get('application/config/name')).toEqual(settings(first).get('application/config/name'));
    expect(entries.get('application/config/use_custom_user_dir')!.readUInt32LE(4)).toBe(1);
  });

  it('rejects a truncated binary project', () => {
    const bytes = Buffer.from('ECFG\x01\0\0\0');
    expect(() => setProjectSettings(bytes, new Map())).toThrow('Truncated');
  });
});

describe('script hooks', () => {
  const hook: ScriptHook = { path: 'example.gd', anchor: '\tshow()\n', insertion: '\tobserve()\n' };
  it('inserts observation after the public reveal while retaining gameplay', () => {
    expect(applyHook('func reveal():\n\tshow()\n\tcontinue_game()\n', hook)).toBe('func reveal():\n\tshow()\n\tobserve()\n\tcontinue_game()\n');
  });
  it('refuses missing or ambiguous anchors', () => {
    expect(() => applyHook('func changed(): pass', hook)).toThrow('missing');
    expect(() => applyHook(hook.anchor.repeat(2), hook)).toThrow('Ambiguous');
  });
  it('routes a Steam call through the bridge at every counted call site', () => {
    const call: ScriptHook = { path: 'example.gd', anchor: 'Steam.joinLobby(', insertion: 'bridge.JoinLobby(', replace: true, occurrences: 2 };
    expect(applyHook('Steam.joinLobby(a)\nSteam.joinLobby(b)\n', call)).toBe('bridge.JoinLobby(a)\nbridge.JoinLobby(b)\n');
  });
  it('observes each public ejection before the game removes that shell', () => {
    const ejection: ScriptHook = { path: 'scripts/ShellEjectManager.gd', anchor: '\tremove()\n', insertion: '\tobserve()\n', before: true, occurrences: 2 };
    expect(applyHook(ejection.anchor.repeat(2), ejection)).toBe('\tobserve()\n\tremove()\n\tobserve()\n\tremove()\n');
  });
});
