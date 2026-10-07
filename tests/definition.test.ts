import { describe, expect, it } from 'vitest';
import { BUCKSHOT } from '../src/definition.ts';
import { BUCKSHOT_CONFIG_GROUP, BUCKSHOT_DEFAULTS } from '../src/config.ts';
import type { WorldContext } from 'cortico/world.ts';
import type { BuckshotConfigSection } from '../src/config.ts';

function context(): WorldContext<BuckshotConfigSection> {
  return { id: BUCKSHOT.id, cfg: BUCKSHOT.defaults(), timezone: 'UTC', botName: 'fixture', botDir: '', packageDir: '', dataDir: '', repoRoot: '', secret: () => '', storeSecret: () => undefined, persist: () => undefined, restart: async () => undefined };
}

describe('World contract', () => {
  it('constructs without a configured game and declares owned configuration', () => {
    const ctx = context();
    const world = BUCKSHOT.create(ctx);
    expect(ctx.cfg).toEqual(BUCKSHOT_DEFAULTS);
    expect(world.id).toBe(BUCKSHOT.id);
    expect(world.console!().config).toEqual([BUCKSHOT_CONFIG_GROUP]);
    for (const path of Object.keys(BUCKSHOT_CONFIG_GROUP.schema.properties)) {
      expect(path.startsWith(`worlds.${BUCKSHOT.id}.`)).toBe(true);
      expect(ctx.cfg).toHaveProperty(path.slice(`worlds.${BUCKSHOT.id}.`.length));
    }
  });
  it('keeps definitions independent between deployments', () => {
    const first = BUCKSHOT.defaults(); first.executableFile = 'configured';
    expect(BUCKSHOT.defaults()).toEqual(BUCKSHOT_DEFAULTS);
  });
  it('serializes player actions and declares read observations', () => {
    const world = BUCKSHOT.create(context());
    const tools = world.tools();
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    const act = tools.find((tool) => tool.name === 'buckshot_act')!;
    expect(act.barrierAfter).toBe(true); expect(act.endsTurn).toBeUndefined();
    expect(tools.map((tool) => tool.name)).toContain('buckshot_start');
    expect(tools.map((tool) => tool.name)).toContain('buckshot_observe');
  });
});
