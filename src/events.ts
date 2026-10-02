import type { BuckshotObservation, BuckshotSnapshot } from './protocol.ts';

const items: Record<string, string> = {
  handsaw: '手锯', 'hand saw': '手锯', 'magnifying glass': '放大镜', magnifier: '放大镜',
  beer: '啤酒', cigarettes: '香烟', handcuffs: '手铐', 'expired medicine': '过期药',
  inverter: '逆转器', 'burner phone': '一次性电话', adrenaline: '肾上腺素',
  jammer: '干扰器', 'indicator remote': '换向遥控器',
};

function actor(value: unknown): string {
  return value === 'player' ? '你' : value === 'dealer' ? '庄家' : `座位 ${String(value)}`;
}

export function describeObservation(event: BuckshotObservation): string {
  const f = event.facts;
  switch (event.kind) {
    case 'load': return `霰弹枪正在装填。本次公开展示 ${f.live} 发实弹、${f.blank} 发空包弹；展示后弹序打乱。装填编号 ${f.load}。`;
    case 'reveal': return `${items[String(f.reason)] ?? f.reason}揭示：当前剩余弹药的第 ${f.position} 发是${f.shell === 'live' ? '实弹' : '空包弹'}，本次装填的绝对序号为 ${f.ordinal}。`;
    case 'ejection': return `${actor(f.actor)}一侧弹出一发${f.shell === 'live' ? '实弹' : '空包弹'}弹壳。本次装填已消耗到第 ${f.ordinal} 发。`;
    case 'inversion': return `${actor(f.actor)}使用逆转器，反转当前膛内弹药（本次装填第 ${f.ordinal} 发）；此事件未揭示弹药种类。`;
    case 'shot': return `${actor(f.actor)}向${actor(f.target)}开枪。${f.shell === 'live' ? '实弹响起枪声。' : '空包弹发出击发声。'}`;
    case 'item': return `${actor(f.actor)}正在使用${items[String(f.item).toLowerCase()] ?? f.item}；效果由随后画面和事件显示。`;
    case 'health': return f.seat !== undefined
      ? `座位 ${f.seat} 的生命显示：${f.value === null ? '计数器被遮蔽，当前生命未知' : f.value}。`
      : `生命计数器显示：你 ${f.player ?? '未知'}，庄家 ${f.dealer ?? '未知'}。`;
    case 'dialogue': return `画面文字完整显示：${f.text}`;
    case 'revival': return `${actor(f.actor)}被除颤器复苏，画面恢复；本轮对局继续。`;
    case 'round': return `轮次指示器显示第 ${f.round} 轮。`;
    case 'turn': return `轮到座位 ${f.seat} 行动。`;
    case 'turnorder': return `桌上的回合方向指示器显示${f.direction === 'CW' ? '顺时针' : '逆时针'}。`;
    case 'result': return f.outcome === 'won' ? `结算显示胜利，奖金 ${f.cash}。` : '多人对局已进入比赛结果画面。';
    case 'clipboard': return `游戏复制的大厅编号：${f.text}`;
    default: return JSON.stringify(f);
  }
}

export function describeEnvironment(s: BuckshotSnapshot): string {
  const labels = new Set(s.actions.map((target) => target.label));
  if (s.scene === 'menu') return `主菜单${s.menu && s.menu !== 'main' ? `，当前页面 ${s.menu}` : ''}。`;
  if (s.scene === 'mp_lobby') return '多人大厅；画面中的玩家、对局配置和弹窗由当前文字及操作目标表示。';
  if (s.mode === 'multiplayer') return '多人对局桌：四个方向的座位围着霰弹枪，桌面陈列玩家道具，生命和回合方向由电子指示器显示。';
  if (labels.has('bathroom door')) return '你在俱乐部厕所内，门通向外面的走廊。';
  if (labels.has('backroom door')) return '你已走到后室门前，门后是对局房间。';
  if (labels.has('release form on table') || [...labels].some((label) => label.startsWith('signature '))) return '对局桌前是免责书和签名机；庄家坐在桌子对面。';
  if (s.outcome === 'won' || labels.has('briefcase lid') || labels.has('latch left')) return '奖金手提箱放在面前；打开两侧锁扣和箱盖后显示结算。';
  if (s.mode) return '你坐在庄家对面的对局桌前。霰弹枪、双方道具和生命计数器组成当前画面。';
  return `当前场景：${s.scene}。`;
}

export function frameKey(s: BuckshotSnapshot): string {
  const interactions = s.actions.map((target) => target.label);
  const phase = interactions.some((label) => label.startsWith('shoot seat') || label === 'text you') ? 'aim'
    : interactions.includes('shotgun') ? 'table'
      : interactions.some((label) => label.startsWith('place item')) ? 'items'
        : interactions.some((label) => label.startsWith('signature')) ? 'signature'
          : s.actions.length ? 'interaction' : 'animation';
  return JSON.stringify([s.scene, s.menu, s.mode, s.round, s.outcome, s.view, s.freeLook, s.jammerSelection, phase]);
}
