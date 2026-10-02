import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { parseSnapshot, type BuckshotObservation, type BuckshotReply, type BuckshotSnapshot } from './protocol.ts';

export class BuckshotBridge extends EventEmitter {
  readonly token = randomBytes(24).toString('hex');
  private server: Server | null = null;
  private socket: Socket | null = null;
  private candidates = new Set<Socket>();
  private sequence = 0;
  private pending = new Map<string, { resolve(value: BuckshotReply): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  snapshot: BuckshotSnapshot | null = null;
  pid: number | null = null;

  async start(): Promise<number> {
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => { this.server!.removeListener('error', reject); resolve(); });
    });
    this.server.on('error', (error) => this.emit('fault', error));
    return (this.server.address() as import('node:net').AddressInfo).port;
  }

  private accept(socket: Socket): void {
    this.candidates.add(socket);
    let buffer = '';
    let authenticated = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          if (!authenticated) {
            if (this.socket || message.kind !== 'hello' || message.protocol !== 1 || message.token !== this.token || !Number.isInteger(message.pid)) {
              socket.destroy();
              return;
            }
            authenticated = true;
            this.socket = socket;
            this.pid = message.pid as number;
            this.emit('connected', { pid: this.pid, version: message.version });
          } else this.receive(message);
        } catch (error) {
          socket.destroy();
          if (authenticated) this.emit('fault', error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.candidates.delete(socket);
      if (this.socket === socket) {
        this.socket = null;
        this.pid = null;
        this.snapshot = null;
        this.rejectPending(new Error('Game bridge disconnected; submitted actions are not replayed'));
        this.emit('disconnected');
      }
    });
  }

  private receive(message: Record<string, unknown>): void {
    switch (message.kind) {
      case 'snapshot': {
        const snapshot = parseSnapshot(message.snapshot);
        this.snapshot = snapshot;
        this.emit('snapshot', snapshot);
        break;
      }
      case 'observation': {
        const event = message.event as BuckshotObservation;
        if (!event || !Number.isInteger(event.number) || typeof event.kind !== 'string' || typeof event.facts !== 'object' || event.facts === null) throw new Error('Malformed game observation');
        this.emit('observation', event);
        break;
      }
      case 'reply': {
        if (typeof message.id !== 'string' || typeof message.ok !== 'boolean' || typeof message.detail !== 'string') throw new Error('Malformed game reply');
        const request = this.pending.get(message.id);
        if (!request) return;
        const reply = message as unknown as BuckshotReply;
        if (reply.snapshot) reply.snapshot = parseSnapshot(reply.snapshot);
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        request.resolve(reply);
        break;
      }
      default: throw new Error('Unknown game bridge message');
    }
  }

  request(action: string, args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<BuckshotReply> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('Game bridge is not connected'));
    if (signal?.aborted) return Promise.reject(new Error('Tool call cancelled before input'));
    const id = String(++this.sequence);
    return new Promise<BuckshotReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Game reply timed out for ${action}; input may have been delivered; observe before trying again`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(JSON.stringify({ id, action, ...args }) + '\n', (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  async stop(): Promise<void> {
    this.rejectPending(new Error('Game bridge stopped'));
    for (const socket of this.candidates) socket.destroy();
    this.candidates.clear();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this.socket = null;
    this.snapshot = null;
  }
}
