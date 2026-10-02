/** Godot 4 PCK v2 directory reader and resource replacement writer. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const MAGIC = 0x43504447;
const HEADER_BYTES = 100;

export interface PackEntry {
  path: string;
  offset: number;
  size: number;
  md5: Buffer;
}

export interface PackDirectory {
  file: string;
  start: number;
  base: number;
  end: number;
  version: readonly [number, number, number];
  entries: PackEntry[];
}

async function readExactly(file: import('node:fs/promises').FileHandle, size: number, position: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const result = await file.read(bytes, read, size - read, position + read);
    if (!result.bytesRead) throw new Error('Truncated Godot pack');
    read += result.bytesRead;
  }
  return bytes;
}

function integer64(bytes: Buffer, at: number): number {
  const value = bytes.readBigUInt64LE(at);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Godot pack offset exceeds the supported file size');
  return Number(value);
}

export async function readPack(filePath: string): Promise<PackDirectory> {
  const file = await open(filePath, 'r');
  try {
    const { size } = await file.stat();
    if (size < HEADER_BYTES) throw new Error('File is too small for a Godot pack');
    let start = 0;
    let end = size;
    if ((await readExactly(file, 4, 0)).readUInt32LE() !== MAGIC) {
      const footer = await readExactly(file, 12, size - 12);
      if (footer.readUInt32LE(8) !== MAGIC) throw new Error('No embedded Godot pack footer');
      start = size - 12 - integer64(footer, 0);
      end -= 12;
      if (start < 0 || start > end - HEADER_BYTES) throw new Error('Invalid embedded Godot pack range');
    }
    const header = await readExactly(file, HEADER_BYTES, start);
    if (header.readUInt32LE() !== MAGIC || header.readUInt32LE(4) !== 2) throw new Error('Only Godot PCK v2 is supported');
    if (header.readUInt32LE(20) !== 0) throw new Error('Encrypted Godot pack directories are unsupported');
    const base = integer64(header, 24);
    if (base < start + HEADER_BYTES || base > end) throw new Error('Invalid Godot pack data base');
    const index = await readExactly(file, base - start - HEADER_BYTES, start + HEADER_BYTES);
    const count = header.readUInt32LE(96);
    const entries: PackEntry[] = [];
    const paths = new Set<string>();
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 4 > index.length) throw new Error('Truncated Godot pack directory');
      const length = index.readUInt32LE(cursor);
      cursor += 4;
      if (cursor + length + 36 > index.length) throw new Error('Invalid Godot resource name length');
      const path = index.subarray(cursor, cursor + length).toString('utf8').replace(/\0+$/, '');
      cursor += length;
      const offset = integer64(index, cursor);
      const entrySize = integer64(index, cursor + 8);
      const md5 = Buffer.from(index.subarray(cursor + 16, cursor + 32));
      if (index.readUInt32LE(cursor + 32) !== 0) throw new Error(`Encrypted Godot resource: ${path}`);
      cursor += 36;
      if (!path.startsWith('res://') || paths.has(path)) throw new Error(`Invalid or duplicate Godot resource: ${path}`);
      if (offset + entrySize > end - base) throw new Error(`Godot resource outside pack: ${path}`);
      paths.add(path);
      entries.push({ path, offset, size: entrySize, md5 });
    }
    return { file: filePath, start, base, end, version: [header.readUInt32LE(8), header.readUInt32LE(12), header.readUInt32LE(16)], entries };
  } finally {
    await file.close();
  }
}

export async function readResource(pack: PackDirectory, path: string): Promise<Buffer> {
  const entry = pack.entries.find((candidate) => candidate.path === path);
  if (!entry) throw new Error(`Missing Godot resource: ${path}`);
  const file = await open(pack.file, 'r');
  try {
    const bytes = await readExactly(file, entry.size, pack.base + entry.offset);
    if (!createHash('md5').update(bytes).digest().equals(entry.md5)) throw new Error(`Godot resource checksum mismatch: ${path}`);
    return bytes;
  } finally {
    await file.close();
  }
}

/** Resources remain local; the original executable is never written. */
export async function writePatchedPack(pack: PackDirectory, replacements: ReadonlyMap<string, Buffer>, outputFile: string, includeOriginal = true): Promise<void> {
  const entries = includeOriginal ? pack.entries.map((entry) => ({ ...entry })) : [];
  const payloadSize = includeOriginal ? pack.end - pack.base : 0;
  let offset = payloadSize;
  for (const [path, bytes] of replacements) {
    if (!path.startsWith('res://') || path.includes('\0')) throw new Error(`Invalid replacement resource: ${path}`);
    const replacement = { path, offset, size: bytes.length, md5: createHash('md5').update(bytes).digest() };
    const existing = entries.findIndex((entry) => entry.path === path);
    if (existing === -1) entries.push(replacement);
    else entries[existing] = replacement;
    offset += bytes.length;
  }
  const directory = entries.map((entry) => {
    const name = Buffer.from(entry.path);
    const paddedLength = Math.ceil(name.length / 4) * 4;
    const bytes = Buffer.alloc(4 + paddedLength + 36);
    bytes.writeUInt32LE(paddedLength);
    name.copy(bytes, 4);
    bytes.writeBigUInt64LE(BigInt(entry.offset), 4 + paddedLength);
    bytes.writeBigUInt64LE(BigInt(entry.size), 12 + paddedLength);
    entry.md5.copy(bytes, 20 + paddedLength);
    return bytes;
  });
  const indexSize = directory.reduce((sum, bytes) => sum + bytes.length, HEADER_BYTES);
  const base = Math.ceil(indexSize / 16) * 16;
  const header = Buffer.alloc(base);
  header.writeUInt32LE(MAGIC);
  header.writeUInt32LE(2, 4);
  pack.version.forEach((part, i) => header.writeUInt32LE(part, 8 + i * 4));
  header.writeBigUInt64LE(BigInt(base), 24);
  header.writeUInt32LE(entries.length, 96);
  let position = HEADER_BYTES;
  for (const item of directory) { item.copy(header, position); position += item.length; }
  const temporary = `${outputFile}.${randomUUID()}.tmp`;
  const output = await open(temporary, 'wx');
  async function write(bytes: Buffer): Promise<void> {
    let written = 0;
    while (written < bytes.length) {
      const result = await output.write(bytes, written, bytes.length - written);
      if (!result.bytesWritten) throw new Error('Could not write Godot pack');
      written += result.bytesWritten;
    }
  }
  try {
    await write(header);
    if (payloadSize) {
      for await (const chunk of createReadStream(pack.file, { start: pack.base, end: pack.end - 1 })) await write(chunk as Buffer);
    }
    for (const bytes of replacements.values()) await write(bytes);
    await output.close();
    await rename(temporary, outputFile);
  } catch (error) {
    await output.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}
