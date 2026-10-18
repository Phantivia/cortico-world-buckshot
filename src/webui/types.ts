export interface BuckshotGameState {
  state: 'offline' | 'loading' | 'online' | 'error';
  error: string;
  stoppable: boolean;
  scene?: string;
  mode?: string;
  round?: number;
  /** The local peer: not running, starting, at its menu, or in this game's lobby. */
  peer: 'offline' | 'starting' | 'menu' | 'joined';
  peerError: string;
}
