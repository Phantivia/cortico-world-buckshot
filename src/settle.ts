import type { BuckshotSnapshot } from './protocol.ts';

/** What the player sees of a state: scene, view, outcome and the targets by label (ids are regenerated per snapshot). */
export function stateSignature(s: BuckshotSnapshot): string {
  return JSON.stringify([s.scene, s.menu, s.view, s.outcome, s.actions.map((target) => [target.label, target.value ?? null])]);
}

/**
 * Settlement of one input. The input has taken effect once an observation arrives or the state differs from the one
 * before it; the game has settled at the first later snapshot that offers targets again or shows another outcome.
 * A state the input left with the same targets (a blank fired at oneself) settles only after something happened.
 */
export class Settlement {
  /** Revision after which a snapshot can settle; Infinity until the input has visibly taken effect. */
  private after = Infinity;

  constructor(private readonly before: BuckshotSnapshot | null) {}

  /** The snapshot the input's reply carried, then each published snapshot; returns true once settled. */
  snapshot(s: BuckshotSnapshot): boolean {
    if (this.after === Infinity && (!this.before || stateSignature(s) !== stateSignature(this.before))) this.after = s.revision - 1;
    return s.revision > this.after && (s.actions.length > 0 || s.outcome !== this.before?.outcome);
  }

  /** An observation during the wait: only snapshots published after it can settle. */
  observation(latestRevision: number): void {
    if (this.after === Infinity) this.after = latestRevision;
  }
}
