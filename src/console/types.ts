export interface BuckshotGameState {
  state: 'offline' | 'loading' | 'online' | 'error';
  error: string;
  stoppable: boolean;
  scene?: string;
  mode?: string;
  round?: number;
}
