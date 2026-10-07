import type { BuckshotSnapshot, BuckshotTarget } from './protocol.ts';
import { describeEnvironment, itemName } from './events.ts';

/** One line of the state text, keyed by topic. A quiet line (nothing on the table, no cuffs) is left out of a full rendering. */
interface Line { key: string; text: string; quiet?: boolean }

/** The public ammo record the game bridge keeps per load; ordinals count from one, `known` keys from zero. */
interface Shells {
  load: number;
  initialLive: number;
  initialBlank: number;
  consumed: number;
  known: Record<string, 'live' | 'blank'>;
  inversions: number[];
  ejected: Array<{ ordinal: number; shell: 'live' | 'blank' }>;
}

const MODES: Record<string, string> = { story: '剧情模式', 'double or nothing': 'Double or Nothing', multiplayer: '多人对局' };
const INPUT_ACTIONS = new Set(['ui_cancel', 'ui_accept', 'ui_left', 'ui_right', 'ui_up', 'ui_down']);

function owner(side: string): string {
  return side === 'player' ? '你' : side === 'dealer' ? '庄家' : side === 'held' ? '手里' : `座位 ${side}`;
}

/** The public record of the current load; the remaining live and blank counts are left to the reader. */
function ammo(shells: Shells): string {
  const parts = [`第 ${shells.load} 次装填 ${shells.initialLive} 实 ${shells.initialBlank} 空`];
  if (shells.ejected.length) parts.push(`已退出 ${shells.ejected.length} 发（${shells.ejected.map((shell) => shell.shell === 'live' ? '实' : '空').join('、')}）`);
  const inversions = new Map<number, number>();
  for (const at of shells.inversions) inversions.set(at, (inversions.get(at) ?? 0) + 1);
  if (inversions.size) parts.push(`逆转过${[...inversions].map(([at, times]) => `第 ${at} 发${times > 1 ? `（${times} 次）` : ''}`).join('、')}`);
  parts.push(shells.consumed < shells.initialLive + shells.initialBlank ? `当前是第 ${shells.consumed + 1} 发` : '已全部退出');
  const known = Object.entries(shells.known).sort(([a], [b]) => Number(a) - Number(b));
  if (known.length) parts.push(`已揭示：${known.map(([at, shell]) => `第 ${Number(at) + 1} 发${shell === 'live' ? '实弹' : '空包弹'}`).join('、')}`);
  return parts.join('；');
}

function target(t: BuckshotTarget): string {
  const place = t.side ? `（${owner(t.side)}${t.slot ? ` #${t.slot}` : ''}）` : '';
  const slider = t.kind === 'slider' ? `（${t.minimum}–${t.maximum}，当前 ${t.value}，步长 ${t.step}）` : '';
  return `- ${t.id}：${t.label}${t.caption ? ` [${t.caption}]` : ''}${place}${slider}`;
}

function lines(s: BuckshotSnapshot): Line[] {
  const out: Line[] = [{ key: 'scene', text: `画面：${describeEnvironment(s)}` }];
  if (s.mode) out.push({ key: 'mode', text: `模式：${MODES[s.mode] ?? s.mode}${s.round !== undefined ? `，第 ${s.round} 轮` : ''}` });
  out.push(s.view ? { key: 'view', text: `镜头：${s.view}` } : { key: 'view', text: '镜头：无目标', quiet: true });
  const outcome = [s.outcome && (s.outcome === 'won' ? '胜利' : '多人对局结束'), s.cash !== undefined && `奖金 ${s.cash}`].filter(Boolean);
  out.push(outcome.length ? { key: 'outcome', text: `结算：${outcome.join('，')}` } : { key: 'outcome', text: '结算：无', quiet: true });
  if (s.players) {
    out.push({ key: 'seats', text: `玩家：${s.players.map((p) => `座位 ${p.seat} ${p.name}${p.seat === s.localSeat ? '（你）' : ''}，生命 ${p.health ?? '未知'}`).join('；')}` });
  } else if (s.mode) out.push({ key: 'health', text: `生命：你 ${s.health.player ?? '未知'}，庄家 ${s.health.dealer ?? '未知'}` });
  if (s.activeSeat !== undefined) out.push({ key: 'turn', text: `回合：座位 ${s.activeSeat}${s.turnOrder ? `，${s.turnOrder === 'CW' ? '顺时针' : '逆时针'}` : ''}` });
  if (s.freeLook !== undefined) out.push(s.freeLook ? { key: 'look', text: '自由观察：开' } : { key: 'look', text: '自由观察：关', quiet: true });
  if (s.shells.load !== undefined) out.push({ key: 'ammo', text: `弹药：${ammo(s.shells as unknown as Shells)}` });
  else if (s.mode) out.push({ key: 'ammo', text: '弹药：本场景还没有装填', quiet: true });
  // The game reports cuffs and the saw only while the cursor is shown; otherwise the line keeps its last value.
  if (s.playerCuffed !== undefined || s.dealerCuffed !== undefined || s.barrelSawedOff !== undefined) {
    const status = [s.playerCuffed && '你被铐', s.dealerCuffed && '庄家被铐', s.barrelSawedOff && '枪管已锯短'].filter(Boolean);
    out.push(status.length ? { key: 'status', text: `状态：${status.join('，')}` } : { key: 'status', text: '状态：无人被铐，枪管未锯', quiet: true });
  }
  if (s.mode || s.inventory.length) {
    const sides = [...new Set(s.inventory.map((item) => item.side))];
    const groups = sides.map((side) => `${owner(side)} ${s.inventory.filter((item) => item.side === side).map((item) => `${side === 'held' ? '' : `#${item.slot} `}${itemName(item.item)}`).join('、')}`);
    out.push(groups.length ? { key: 'items', text: `道具：${groups.join('；')}` } : { key: 'items', text: '道具：无', quiet: true });
  }
  if (s.jammerSelection) {
    const { seat, light } = s.jammerSelection;
    out.push({ key: 'jammer', text: `干扰器：${seat === null ? '未选目标' : `选中座位 ${seat}`}，确认灯${light === 'green' ? '绿色，可确认' : '红色，当前选择无效'}` });
  } else if (s.mode === 'multiplayer') out.push({ key: 'jammer', text: '干扰器：未在选择', quiet: true });
  out.push(s.texts.length ? { key: 'texts', text: `屏幕文字：${s.texts.join(' | ')}` } : { key: 'texts', text: '屏幕文字：无', quiet: true });
  out.push({ key: 'actions', text: s.actions.length ? `可操作：\n${s.actions.map(target).join('\n')}` : '可操作：无' });
  out.push({ key: 'input', text: `视口 ${s.viewport.width}×${s.viewport.height}；输入动作：${s.inputActions.filter((name) => !name.startsWith('ui_') || INPUT_ACTIONS.has(name)).join('、')}` });
  return out;
}

/** Every line of a snapshot. */
export function renderSnapshot(s: BuckshotSnapshot): string {
  return [`状态版本 ${s.revision}`, ...lines(s).filter((line) => !line.quiet).map((line) => line.text)].join('\n');
}

/**
 * The state text told to the model across receipts and events. `full` states every line; `changes` states the lines
 * that differ from what was last told and names the revision the rest still matches. Both advance the baseline. A
 * line the snapshot does not report keeps its last told value.
 */
export class StateNarrator {
  private told = new Map<string, string>();
  private revision: number | null = null;

  full(s: BuckshotSnapshot): string {
    this.remember(s, lines(s));
    return renderSnapshot(s);
  }

  changes(s: BuckshotSnapshot): string {
    const before = this.revision;
    if (before === null) return this.full(s);
    const current = lines(s);
    const changed = current.filter((line) => this.told.get(line.key) !== line.text);
    this.remember(s, current);
    if (!changed.length) return s.revision === before ? `状态版本 ${s.revision}，未变。` : `状态版本 ${s.revision}，与版本 ${before} 相同。`;
    return [`状态版本 ${s.revision}`, ...changed.map((line) => line.text), `其余同版本 ${before}。`].join('\n');
  }

  reset(): void {
    this.told.clear();
    this.revision = null;
  }

  private remember(s: BuckshotSnapshot, current: Line[]): void {
    for (const line of current) this.told.set(line.key, line.text);
    this.revision = s.revision;
  }
}
