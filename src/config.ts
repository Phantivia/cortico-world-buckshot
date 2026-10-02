import type { ConfigGroup } from 'cortico/core/types.ts';

export interface BuckshotConfigSection {
  enabled: boolean;
  executableFile: string;
  runtimeDir: string;
  closeOnStop: boolean;
  startupTimeoutMs: number;
  actionTimeoutMs: number;
}

export const BUCKSHOT_DEFAULTS: BuckshotConfigSection = {
  enabled: false, executableFile: '', runtimeDir: '', closeOnStop: true,
  startupTimeoutMs: 30000, actionTimeoutMs: 10000,
};

export const BUCKSHOT_CONFIG_GROUP: ConfigGroup = {
  id: 'world:buckshot', owner: 'world:buckshot', schema: {
    type: 'object', title: '恶魔轮盘', properties: {
      'worlds.buckshot.executableFile': { type: 'string', title: '游戏程序', 'x-hot': false, 'x-path': { kind: 'file', extensions: ['.exe'] } },
      'worlds.buckshot.runtimeDir': { type: 'string', title: '植入资源包目录', description: '留空使用部署的 runtimes/buckshot。游戏资源仅保存在本机。', 'x-hot': false, 'x-path': { kind: 'directory' } },
      'worlds.buckshot.closeOnStop': { type: 'boolean', title: 'World 停止时关闭游戏', 'x-hot': false },
      'worlds.buckshot.startupTimeoutMs': { type: 'integer', title: '等待游戏连接', minimum: 1000, 'x-suffix': 'ms', 'x-hot': false },
      'worlds.buckshot.actionTimeoutMs': { type: 'integer', title: '等待操作回执', minimum: 1000, 'x-suffix': 'ms', 'x-hot': true },
    },
  },
};

export function normalizeExecutableFile(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1');
}
