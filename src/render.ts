import type { BuckshotSnapshot } from './protocol.ts';
import { describeEnvironment } from './events.ts';

export function renderSnapshot(snapshot: BuckshotSnapshot): string {
  const lines = [`场景：${snapshot.scene}${snapshot.menu ? ` / ${snapshot.menu}` : ''}；状态版本 ${snapshot.revision}`];
  lines.push(`画面环境：${describeEnvironment(snapshot)}`);
  if (snapshot.view) lines.push(`镜头目标：${snapshot.view}`);
  if (snapshot.mode) lines.push(`模式：${snapshot.mode}${snapshot.round !== undefined ? `；第 ${snapshot.round} 轮` : ''}`);
  if (snapshot.outcome) lines.push(`结果：${snapshot.outcome}${snapshot.cash === undefined ? '' : `；奖金 ${snapshot.cash}`}`);
  if (!snapshot.players) lines.push(`最近显示的生命：你 ${snapshot.health.player ?? '未知'}；庄家 ${snapshot.health.dealer ?? '未知'}`);
  if (Object.keys(snapshot.shells).length) lines.push(`已公开弹药信息：${JSON.stringify(snapshot.shells)}`);
  if (snapshot.dealerCuffed || snapshot.playerCuffed || snapshot.barrelSawedOff) lines.push(`手铐：你 ${!!snapshot.playerCuffed}、庄家 ${!!snapshot.dealerCuffed}；枪管锯短 ${!!snapshot.barrelSawedOff}`);
  if (snapshot.inventory.length) lines.push(`桌上道具：${snapshot.inventory.map((item) => `${item.side} #${item.slot} ${item.item}`).join('；')}`);
  if (snapshot.players) lines.push(`座位（本地 ${snapshot.localSeat}）：${snapshot.players.map((player) => `${player.seat} ${player.name}，生命 ${player.health ?? '未知'}`).join('；')}；自由观察 ${!!snapshot.freeLook}`);
  if (snapshot.activeSeat !== undefined) lines.push(`当前回合：座位 ${snapshot.activeSeat}${snapshot.turnOrder ? `；${snapshot.turnOrder === 'CW' ? '顺时针' : '逆时针'}` : ''}`);
  if (snapshot.jammerSelection) lines.push(`干扰器：${snapshot.jammerSelection.seat === null ? '未选目标' : `选择座位 ${snapshot.jammerSelection.seat}`}；确认灯${snapshot.jammerSelection.light === 'green' ? '绿色，可确认' : '红色，当前选择无效'}`);
  if (snapshot.texts.length) lines.push(`屏幕文字：${snapshot.texts.join(' | ')}`);
  lines.push(snapshot.actions.length ? `可操作：\n${snapshot.actions.map((target) => `- ${target.id}：${target.label}${target.caption ? ` [${target.caption}]` : ''}${target.side ? `（${target.side} #${target.slot}）` : ''}${target.kind === 'slider' ? `（${target.minimum}–${target.maximum}，当前 ${target.value}，步长 ${target.step}）` : ''}`).join('\n')}` : '当前没有可操作目标；等待动画或游戏事件。');
  if (snapshot.viewport) lines.push(`视口：${snapshot.viewport.width} × ${snapshot.viewport.height}`);
  if (snapshot.inputActions) lines.push(`输入动作：${snapshot.inputActions.filter((name) => !name.startsWith('ui_') || ['ui_cancel', 'ui_accept', 'ui_left', 'ui_right', 'ui_up', 'ui_down'].includes(name)).join('、')}`);
  return lines.join('\n');
}
