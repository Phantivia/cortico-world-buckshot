import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export const BUCKSHOT_PROFILE = {
  id: 'steam-windows-2.2.0.6',
  engine: '4.1.1',
  bytes: 796325472,
  sha256: 'df2f8a31bd469438a1a29f831945ccea7b26963ab735f73b32936792207b1663',
} as const;

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export async function verifyInstallation(executableFile: string): Promise<void> {
  const info = await stat(executableFile);
  if (!info.isFile() || info.size !== BUCKSHOT_PROFILE.bytes || await hashFile(executableFile) !== BUCKSHOT_PROFILE.sha256) {
    throw new Error(`Unsupported Buckshot Roulette build; expected ${BUCKSHOT_PROFILE.id}`);
  }
}
