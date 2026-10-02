import type { BuckshotObservation, BuckshotSnapshot } from './protocol.ts';

const items: Record<string, string> = {
  handsaw: '手锯', 'hand saw': '手锯', 'magnifying glass': '放大镜', magnifier: '放大镜',
  beer: '啤酒', cigarettes: '香烟', handcuffs: '手铐', 'expired medicine': '过期药',
  inverter: '逆转器', 'burner phone': '一次性电话', adrenaline: '肾上腺素',
  jammer: '干扰器', 'indicator remote': '换向遥控器',
};

const itemFlavor: Record<string, string> = {
  手锯: '锯齿与枪管，让桌上的金属多了一份危险。',
  放大镜: '小小的镜片，要窥看的是枪膛里的秘密。',
  啤酒: '一罐啤酒，也成了这场枪桌赌局的道具。',
  香烟: '桌边的香烟，在这里成了续命的东西。',
  手铐: '冰冷的金属手铐，把下一次行动也押上了赌桌。',
  过期药: '连药都过了期，药效本身也是一场赌博。',
  逆转器: '这只小装置，要改变的是枪膛里那一发。',
  一次性电话: '枪桌上多了一通关于子弹的电话。',
  肾上腺素: '这次道具动作，盯上了对面那一侧的桌面。',
  干扰器: '它要动手脚的，是别人面前的生命显示。',
  换向遥控器: '一只遥控器，就能改变整张枪桌的行动方向。',
};

function actor(value: unknown): string {
  return value === 'player' ? '你' : value === 'dealer' ? '庄家' : `座位 ${String(value)}`;
}

export function describeObservation(event: BuckshotObservation): string {
  const f = event.facts;
  switch (event.kind) {
    case 'load': return `霰弹枪正在装填，新一轮的弹药摆上了赌桌。本次公开展示 ${f.live} 发实弹、${f.blank} 发空包弹；展示后弹序打乱，先后顺序重新藏进枪里。装填编号 ${f.load}。`;
    case 'reveal': return `${items[String(f.reason)] ?? f.reason}揭开了弹序的一角：当前剩余弹药的第 ${f.position} 发是${f.shell === 'live' ? '实弹' : '空包弹'}，本次装填的绝对序号为 ${f.ordinal}。`;
    case 'ejection': return `${actor(f.actor)}一侧弹出一发${f.shell === 'live' ? '实弹' : '空包弹'}弹壳，枪膛里又少了一发。本次装填已消耗到第 ${f.ordinal} 发。`;
    case 'inversion': return `${actor(f.actor)}使用逆转器，反转当前膛内弹药，给这发“翻了个面”（本次装填第 ${f.ordinal} 发）；此事件未揭示弹药种类。`;
    case 'shot': return `${actor(f.actor)}向${actor(f.target)}开枪。${f.shell === 'live' ? '实弹的枪声猛然炸开。' : '空包弹只留下干涩的击发声。'}`;
    case 'item': {
      const name = items[String(f.item).toLowerCase()] ?? String(f.item);
      return `${actor(f.actor)}正在使用${name}。${itemFlavor[name] ?? ''}效果由随后画面和事件显示。`;
    }
    case 'health': return f.seat !== undefined
      ? `座位 ${f.seat} 的生命显示：${f.value === null ? '计数器被遮蔽，当前生命未知' : f.value}。`
      : `生命计数器显示：你 ${f.player ?? '未知'}，庄家 ${f.dealer ?? '未知'}。`;
    case 'dialogue': return `字幕逐字显完，停在画面上。画面文字完整显示：${f.text}`;
    case 'revival': return `黑下去的画面重新亮起。${actor(f.actor)}被除颤器复苏；本轮对局继续。`;
    case 'round': return `轮次指示器显示第 ${f.round} 轮，新一轮枪桌赌局开始。`;
    case 'turn': return `轮到座位 ${f.seat} 行动。`;
    case 'turnorder': return `桌上的回合方向指示器显示${f.direction === 'CW' ? '顺时针' : '逆时针'}；接下来的行动沿着这个方向传递。`;
    case 'result': return f.outcome === 'won' ? `结算显示胜利，奖金 ${f.cash}。这场枪桌赌局，最后以手提箱里的奖金收场。` : '多人对局已进入比赛结果画面，枪桌上的输赢开始结算。';
    case 'clipboard': return `游戏复制的大厅编号：${f.text}`;
    default: return JSON.stringify(f);
  }
}

export function describeEnvironment(s: BuckshotSnapshot): string {
  const labels = new Set(s.actions.map((target) => target.label));
  if (s.scene === 'menu') return `主菜单${s.menu && s.menu !== 'main' ? `，当前页面 ${s.menu}` : ''}。背景散着弹壳与金属器件。`;
  if (s.scene === 'mp_lobby') return '多人大厅；画面中的玩家、对局配置和弹窗由当前文字及操作目标表示。';
  if (s.mode === 'multiplayer') return '四个方向的座位围着枪桌，霰弹枪摆在中央。道具陈列在各人面前，电子生命显示与回合方向指示器也是这场赌局的一部分。';
  if (labels.has('bathroom door')) return '你在俱乐部厕所内。狭窄的洗手间里，门通向外面的走廊。';
  if (labels.has('backroom door')) return '后室门横在面前，门后等着一场以霰弹枪定输赢的赌局。';
  if (labels.has('release form on table') || [...labels].some((label) => label.startsWith('signature '))) return '免责书摊在对局桌上，签名机等着一个名字。庄家就在桌子对面。';
  if (s.outcome === 'won') return '已进入奖金结算；桌上的霰弹枪终于让位给了奖金手提箱。';
  if (labels.has('briefcase lid') || labels.has('latch left')) return '奖金手提箱放在面前，两侧锁扣守着箱盖；打开锁扣和箱盖后显示结算。';
  if (s.mode) return '你坐在庄家对面，霰弹枪横在双方之间。桌沿摆着道具与电子生命计数器，赌局就在这张桌上进行。';
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
