import type { WorldDefinition } from 'cortico/world.ts';
import { BUCKSHOT_DEFAULTS, type BuckshotConfigSection } from './config.ts';
import { BuckshotWorld } from './world.ts';

export const BUCKSHOT: WorldDefinition<BuckshotConfigSection> = {
  id: 'buckshot', label: '恶魔轮盘', defaults: () => structuredClone(BUCKSHOT_DEFAULTS),
  // 挂载不碰游戏,游戏程序在 buckshot_start 时才校验:未配置也能激活,激活后在本 World 页的配置里填。
  preflight: () => {
    if (process.platform !== 'win32') throw new Error('恶魔轮盘 World 当前支持 Windows。');
  },
  create: (ctx) => new BuckshotWorld(ctx),
};
