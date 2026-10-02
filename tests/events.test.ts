import { describe, expect, it } from 'vitest';
import { describeObservation, describeEnvironment, frameKey } from '../src/events.ts';
import { renderSnapshot } from '../src/render.ts';
import type { BuckshotSnapshot } from '../src/protocol.ts';

const snapshot: BuckshotSnapshot = {
  revision: 1, scene: 'main', actions: [], inventory: [], texts: [], shells: {},
  health: { player: null, dealer: null }, observationNumber: 0,
  viewport: { width: 960, height: 540 }, inputActions: [],
};

describe('livestream observations', () => {
  it('describes public shots without inventing damage or hidden health', () => {
    const text = describeObservation({ number: 1, kind: 'shot', facts: { actor: 'dealer', target: 'player', shell: 'blank' } });
    expect(text).toContain('庄家向你开枪');
    expect(text).toContain('空包弹');
    expect(text).not.toContain('生命');
  });
  it('keeps an unrevealed inversion and a masked counter unknown', () => {
    const text = describeObservation({ number: 1, kind: 'inversion', facts: { actor: 'player', ordinal: 2 } });
    expect(text).toContain('未揭示');
    expect(text).not.toMatch(/实弹|空包弹/);
    expect(describeObservation({ number: 2, kind: 'health', facts: { seat: 1, value: null } })).toContain('当前生命未知');
  });
  it('selects frames for phase changes while ignoring regenerated target ids', () => {
    const table = { ...snapshot, mode: 'story', actions: [{ id: 'one', label: 'shotgun', kind: 'interaction' }] };
    expect(frameKey({ ...table, actions: [{ id: 'two', label: 'shotgun', kind: 'interaction' }] })).toBe(frameKey(table));
    expect(frameKey({ ...table, actions: [{ id: 'two', label: 'text you', kind: 'interaction' }] })).not.toBe(frameKey(table));
    expect(frameKey({ ...table, view: 'bathroom' })).not.toBe(frameKey(table));
    expect(frameKey({ ...snapshot, freeLook: true })).not.toBe(frameKey(snapshot));
    expect(describeEnvironment({ ...snapshot, actions: [{ id: 'door', label: 'bathroom door', kind: 'interaction' }] })).toContain('厕所');
  });
  it('reports the selected jammer seat and confirmation light without revealing health', () => {
    const red = { ...snapshot, mode: 'multiplayer', jammerSelection: { seat: 2, light: 'red' as const } };
    expect(renderSnapshot(red)).toContain('选择座位 2；确认灯红色，当前选择无效');
    const green = { ...red, jammerSelection: { seat: 2, light: 'green' as const } };
    expect(renderSnapshot(green)).toContain('确认灯绿色，可确认');
    expect(frameKey(red)).not.toBe(frameKey(green));
    expect(renderSnapshot(green)).toContain('生命：你 未知；庄家 未知');
  });
});
