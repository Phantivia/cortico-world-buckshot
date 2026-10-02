export interface BuckshotTarget {
  id: string;
  label: string;
  kind: string;
  side?: string;
  slot?: number;
  value?: number;
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface BuckshotObservation {
  number: number;
  kind: string;
  facts: Record<string, unknown>;
}

export interface BuckshotSnapshot {
  revision: number;
  scene: string;
  menu?: string;
  mode?: string;
  round?: number;
  outcome?: 'won';
  cash?: number;
  actions: BuckshotTarget[];
  inventory: Array<{ item: string; side: string; slot: number }>;
  texts: string[];
  shells: Record<string, unknown>;
  health: { player: number | null; dealer: number | null };
  observationNumber: number;
  dealerCuffed?: boolean;
  playerCuffed?: boolean;
  barrelSawedOff?: boolean;
  localSeat?: number;
  viewport: { width: number; height: number };
  inputActions: string[];
  players?: Array<{ seat: number; name: string; health: number | null }>;
  freeLook?: boolean;
}

export interface BuckshotReply {
  kind: 'reply';
  id: string;
  ok: boolean;
  detail: string;
  snapshot?: BuckshotSnapshot;
  observations?: BuckshotObservation[];
  png?: string;
}

export function parseSnapshot(value: unknown): BuckshotSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid game snapshot');
  const snapshot = value as BuckshotSnapshot;
  if (!Number.isInteger(snapshot.revision) || typeof snapshot.scene !== 'string'
    || !Array.isArray(snapshot.actions) || !Array.isArray(snapshot.inventory)
    || !Array.isArray(snapshot.texts) || snapshot.texts.some((text) => typeof text !== 'string')
    || typeof snapshot.shells !== 'object' || snapshot.shells === null
    || typeof snapshot.health !== 'object' || snapshot.health === null
    || !Number.isInteger(snapshot.observationNumber)) throw new Error('Malformed game snapshot');
  for (const target of snapshot.actions) {
    if (!target || typeof target.id !== 'string' || typeof target.label !== 'string' || typeof target.kind !== 'string') throw new Error('Malformed game target');
  }
  return snapshot;
}
