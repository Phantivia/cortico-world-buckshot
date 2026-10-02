import { existsSync, statSync } from 'node:fs';
import type { WorldDefinition } from 'cortico/world.ts';
import { BUCKSHOT_DEFAULTS, normalizeExecutableFile, type BuckshotConfigSection } from './config.ts';
import { BuckshotWorld } from './world.ts';

export const BUCKSHOT: WorldDefinition<BuckshotConfigSection> = {
  id: 'buckshot', label: '恶魔轮盘', defaults: () => structuredClone(BUCKSHOT_DEFAULTS),
  preflight: (ctx) => {
    if (process.platform !== 'win32') throw new Error('恶魔轮盘 World 当前支持 Windows。');
    const file = normalizeExecutableFile(ctx.cfg.executableFile);
    if (!file || !existsSync(file) || !statSync(file).isFile()) throw new Error('请配置 Buckshot Roulette.exe。');
  },
  create: (ctx) => new BuckshotWorld(ctx),
};
