import { once } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BuckshotBridge } from '../src/bridge.ts';

const bridges: BuckshotBridge[] = [];
const sockets: Socket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) socket.destroy(); await Promise.all(bridges.splice(0).map((bridge) => bridge.stop())); });

async function connect(authenticate = true) {
  const bridge = new BuckshotBridge(); bridges.push(bridge);
  const port = await bridge.start();
  const socket = createConnection({ host: '127.0.0.1', port }); sockets.push(socket);
  await once(socket, 'connect');
  if (authenticate) {
    const connected = once(bridge, 'connected');
    socket.write(JSON.stringify({ kind: 'hello', protocol: 1, token: bridge.token, pid: process.pid, version: 'fixture' }) + '\n');
    await connected;
  }
  return { bridge, socket };
}

const snapshot = { revision: 1, scene: 'table', actions: [{ id: 'visible', label: 'shotgun', kind: 'interaction' }], inventory: [], texts: [], shells: {}, health: { player: null, dealer: null }, observationNumber: 0 };

describe('game bridge over real local sockets', () => {
  it('accepts fragmented UTF-8 frames and correlates replies with requests', async () => {
    const { bridge, socket } = await connect();
    const state = once(bridge, 'snapshot');
    const frame = Buffer.from(JSON.stringify({ kind: 'snapshot', snapshot: { ...snapshot, texts: ['实弹'] } }) + '\n');
    const split = frame.indexOf(Buffer.from('实')) + 1;
    socket.write(frame.subarray(0, split)); socket.write(frame.subarray(split));
    const [received] = await state;
    expect(received.texts).toEqual(['实弹']);
    socket.once('data', (chunk) => {
      const request = JSON.parse(chunk.toString());
      socket.write(JSON.stringify({ kind: 'reply', id: request.id, ok: true, detail: 'input delivered' }) + '\n');
    });
    expect((await bridge.request('act', { target: 'visible', revision: 1 }, 1000)).ok).toBe(true);
  });

  it('rejects an unauthenticated peer before accepting game state', async () => {
    const { bridge, socket } = await connect(false);
    const closed = once(socket, 'close');
    socket.write(JSON.stringify({ kind: 'hello', protocol: 1, token: 'wrong', pid: process.pid }) + '\n');
    await closed;
    expect(bridge.pid).toBeNull(); expect(bridge.snapshot).toBeNull();
  });

  it('rejects pending actions on disconnect and does not replay them', async () => {
    const { bridge, socket } = await connect();
    const request = bridge.request('act', { target: 'visible', revision: 1 }, 1000);
    const assertion = expect(request).rejects.toThrow('not replayed');
    socket.destroy();
    await assertion;
    expect(bridge.snapshot).toBeNull();
    await expect(bridge.request('snapshot', {}, 1000)).rejects.toThrow('not connected');
  });

  it('reports uncertain delivery after a missing reply and sends exactly once', async () => {
    const { bridge, socket } = await connect();
    let submitted = 0;
    socket.on('data', () => { submitted += 1; });
    await expect(bridge.request('act', { target: 'visible', revision: 1 }, 30)).rejects.toThrow('may have been delivered');
    expect(submitted).toBe(1);
  });

  it('does not send an action when cancellation precedes input', async () => {
    const { bridge, socket } = await connect();
    let submitted = 0;
    socket.on('data', () => { submitted += 1; });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(bridge.request('act', {}, 1000, cancelled.signal)).rejects.toThrow('cancelled');
    expect(submitted).toBe(0);
  });
});
