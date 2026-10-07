import { describe, expect, it } from 'vitest';
import { Settlement } from '../src/settle.ts';
import type { BuckshotSnapshot, BuckshotTarget } from '../src/protocol.ts';

const at = (revision: number, labels: string[], extra: Partial<BuckshotSnapshot> = {}): BuckshotSnapshot => ({
  revision, scene: 'main', mode: 'story', actions: labels.map((label, i): BuckshotTarget => ({ id: `${revision}-${i}`, label, kind: 'interaction' })),
  inventory: [], texts: [], shells: {}, health: { player: 2, dealer: 2 }, observationNumber: 0,
  viewport: { width: 960, height: 540 }, inputActions: [], ...extra,
});

describe('Settlement', () => {
  it('waits through the animation of a shot until targets are offered again', () => {
    const aim = at(10, ['text you', 'text dealer']);
    const s = new Settlement(aim);
    expect(s.snapshot(at(10, ['text you', 'text dealer']))).toBe(false);
    s.observation(10);
    expect(s.snapshot(at(11, []))).toBe(false);
    expect(s.snapshot(at(12, ['shotgun', 'item 1']))).toBe(true);
  });

  it('settles a blank fired at oneself only after the shot, though the targets come back the same', () => {
    const table = at(20, ['shotgun', 'item 1']);
    const s = new Settlement(table);
    expect(s.snapshot(at(21, ['shotgun', 'item 1']))).toBe(false);
    s.observation(21);
    expect(s.snapshot(at(22, ['shotgun', 'item 1']))).toBe(true);
  });

  it('settles at once on an input whose reply already shows the new state', () => {
    const s = new Settlement(at(5, ['volume'], { scene: 'menu' }));
    expect(s.snapshot({ ...at(6, ['volume'], { scene: 'menu' }), actions: [{ id: 'v', label: 'volume', kind: 'slider', value: .4 }] })).toBe(true);
  });

  it('settles when the outcome changes even without targets', () => {
    const s = new Settlement(at(30, ['text dealer']));
    expect(s.snapshot(at(31, [], { outcome: 'won' }))).toBe(true);
  });

  it('ignores regenerated target ids', () => {
    const s = new Settlement(at(40, ['shotgun']));
    expect(s.snapshot(at(41, ['shotgun']))).toBe(false);
  });
});
