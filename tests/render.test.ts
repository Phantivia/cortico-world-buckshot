import { describe, expect, it } from 'vitest';
import { renderSnapshot, StateNarrator } from '../src/render.ts';
import type { BuckshotSnapshot } from '../src/protocol.ts';

const table = (revision: number, extra: Partial<BuckshotSnapshot> = {}): BuckshotSnapshot => ({
  revision, scene: 'main', mode: 'story', round: 1, view: 'home',
  actions: [{ id: 'gun', label: 'shotgun', kind: 'interaction' }, { id: 'beer', label: 'beer', kind: 'interaction', side: 'player', slot: 1 }],
  inventory: [{ item: 'beer', side: 'player', slot: 1 }], texts: [], shells: {}, health: { player: 2, dealer: 2 },
  observationNumber: 0, viewport: { width: 960, height: 540 }, inputActions: [],
  playerCuffed: false, dealerCuffed: true, barrelSawedOff: false, ...extra,
});

describe('StateNarrator', () => {
  it('states a line that became empty and names the revision the omitted lines still match', () => {
    const narrator = new StateNarrator();
    narrator.full(table(10));
    const text = narrator.changes(table(11, { actions: [{ id: 'gun', label: 'shotgun', kind: 'interaction' }], inventory: [] }));
    expect(text).toContain('状态版本 11');
    expect(text).toContain('道具：无');
    expect(text).toContain('- gun：shotgun');
    expect(text).not.toContain('生命');
    expect(text).toContain('版本 10');
  });

  it('keeps a line the game did not report this time instead of declaring it empty', () => {
    const narrator = new StateNarrator();
    narrator.full(table(10));
    const hidden = narrator.changes(table(11, { playerCuffed: undefined, dealerCuffed: undefined, barrelSawedOff: undefined }));
    expect(hidden).not.toMatch(/被铐|锯/);
    expect(narrator.changes(table(12, { dealerCuffed: false }))).toContain('无人被铐');
  });
});

describe('renderSnapshot', () => {
  it('lists inversions and reveals of the load without deriving the remaining counts', () => {
    const text = renderSnapshot(table(1, { shells: {
      load: 2, initialLive: 2, initialBlank: 2, consumed: 1, known: { 2: 'live' }, inversions: [2],
      ejected: [{ actor: 'dealer', load: 2, ordinal: 1, shell: 'blank' }],
    } }));
    expect(text).toContain('逆转过第 2 发');
    expect(text).toContain('当前是第 2 发');
    expect(text).toContain('第 3 发实弹');
    expect(text).not.toContain('剩余');
    expect(text).not.toContain('{');
  });
});
