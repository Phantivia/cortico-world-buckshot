import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPack, readResource, writePatchedPack } from '../src/pck.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function fixture(resources: Record<string, string>, embedded = false): Buffer {
  const pairs = Object.entries(resources);
  const prefix = embedded ? Buffer.from('An executable prefix') : Buffer.alloc(0);
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [path, value] of pairs) {
    const name = Buffer.from(`res://${path}`);
    const padded = Math.ceil(name.length / 4) * 4;
    const record = Buffer.alloc(4 + padded + 36);
    record.writeUInt32LE(padded);
    name.copy(record, 4);
    record.writeBigUInt64LE(BigInt(offset), 4 + padded);
    record.writeBigUInt64LE(BigInt(Buffer.byteLength(value)), 12 + padded);
    createHash('md5').update(value).digest().copy(record, 20 + padded);
    offset += Buffer.byteLength(value);
    directory.push(record);
  }
  const header = Buffer.alloc(100);
  header.write('GDPC'); header.writeUInt32LE(2, 4); header.writeUInt32LE(4, 8); header.writeUInt32LE(1, 12); header.writeUInt32LE(1, 16);
  const index = Buffer.concat(directory);
  header.writeBigUInt64LE(BigInt(prefix.length + header.length + index.length), 24);
  header.writeUInt32LE(pairs.length, 96);
  const pack = Buffer.concat([header, index, ...pairs.map(([, value]) => Buffer.from(value))]);
  const footer = Buffer.alloc(embedded ? 12 : 0);
  if (embedded) { footer.writeBigUInt64LE(BigInt(pack.length)); footer.write('GDPC', 8); }
  return Buffer.concat([prefix, pack, footer]);
}

async function source(bytes: Buffer): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'buckshot-pck-'));
  temporary.push(dir);
  const file = join(dir, 'source.pck');
  await writeFile(file, bytes);
  return { dir, file };
}

describe('Godot packs', () => {
  it.each([false, true])('reads real binary directory and resource checksums (embedded=%s)', async (embedded) => {
    const { file } = await source(fixture({ 'first.gd': 'hello', '另一个.gd': 'world' }, embedded));
    const pack = await readPack(file);
    expect(pack.version).toEqual([4, 1, 1]);
    expect((await readResource(pack, 'res://另一个.gd')).toString()).toBe('world');
  });

  it('replaces and adds resources while preserving untouched bytes and the source', async () => {
    const original = fixture({ 'first.gd': 'old', 'keep.bin': 'unchanged' }, true);
    const { dir, file } = await source(original);
    const output = join(dir, 'patched.pck');
    await writePatchedPack(await readPack(file), new Map([['res://first.gd', Buffer.from('replacement')], ['res://bridge.gd', Buffer.from('new')]]), output);
    const pack = await readPack(output);
    expect((await readResource(pack, 'res://first.gd')).toString()).toBe('replacement');
    expect((await readResource(pack, 'res://keep.bin')).toString()).toBe('unchanged');
    expect((await readResource(pack, 'res://bridge.gd')).toString()).toBe('new');
    expect(await readFile(file)).toEqual(original);
  });

  it('writes a bootstrap pack containing only the selected resources', async () => {
    const { dir, file } = await source(fixture({ 'asset.bin': 'original resource' }, true));
    const output = join(dir, 'bootstrap.pck');
    await writePatchedPack(await readPack(file), new Map([['res://bridge.gd', Buffer.from('bridge')]]), output, false);
    const pack = await readPack(output);
    expect(pack.entries.map((entry) => entry.path)).toEqual(['res://bridge.gd']);
    expect((await readResource(pack, 'res://bridge.gd')).toString()).toBe('bridge');
  });

  it('rejects a directory offset that points outside the pack', async () => {
    const bytes = fixture({ 'a': 'test' });
    bytes.writeBigUInt64LE(BigInt(bytes.length * 2), 100 + 4 + 8);
    const { file } = await source(bytes);
    await expect(readPack(file)).rejects.toThrow();
  });

  it('rejects corrupted payload bytes before using them for a hook', async () => {
    const bytes = fixture({ 'a': 'test' }); bytes[bytes.length - 1] ^= 1;
    const { file } = await source(bytes);
    await expect(readResource(await readPack(file), 'res://a')).rejects.toThrow('checksum');
  });
});
