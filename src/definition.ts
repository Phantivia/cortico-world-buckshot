import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { BUCKSHOT_DEFAULTS, type BuckshotConfigSection } from './config.ts';
import { BUCKSHOT_TOOL_DECLS } from './tools.ts';
import { BuckshotWorld } from './world.ts';

export const BUCKSHOT: WorldDefinition<BuckshotConfigSection> = {
  id: 'buckshot', label: '恶魔轮盘', defaults: () => structuredClone(BUCKSHOT_DEFAULTS),
  // 挂载不碰游戏,游戏程序在 buckshot_start 时才校验:未配置也能激活,激活后在本 World 页的配置里填。
  preflight: () => {
    if (process.platform !== 'win32') throw new Error('恶魔轮盘 World 当前支持 Windows。');
  },
  create: (ctx) => new BuckshotWorld(ctx),
  describe: {
    tools: describeTools(BUCKSHOT_TOOL_DECLS, {
      buckshot_start: { zh: '启动恶魔轮盘并接上游戏事件。', en: 'Launches Buckshot Roulette and connects to its game events.' },
      buckshot_observe: {
        zh: '读取当前画面状态、可操作的目标和已揭示的弹药。',
        en: 'Reads the current game state, the targets that can be operated and the shells revealed so far.',
      },
      buckshot_act: {
        zh: '操作一个目标(拿枪、开枪、用道具、点菜单等),等动画结算后回执。',
        en: 'Operates one target, such as picking up the shotgun, firing, using an item or pressing a menu button, and reports back once the animation settles.',
      },
      buckshot_input: { zh: '触发游戏里定义的一个输入动作。', en: 'Triggers one of the input actions the game defines.' },
      buckshot_key: { zh: '按键盘按键,可用于界面导航和改键。', en: 'Presses a keyboard key, for menu navigation or rebinding keys.' },
      buckshot_pointer: { zh: '在游戏画面里移动鼠标、点击或滚动。', en: 'Moves, clicks or scrolls the mouse inside the game view.' },
      buckshot_controller: { zh: '发送手柄按钮或摇杆输入。', en: 'Sends gamepad button or stick input.' },
      buckshot_type: {
        zh: '往输入框里填文字,或把文字放进剪贴板(如多人大厅编号)。',
        en: 'Types text into the focused field, or puts text on the clipboard, such as a multiplayer lobby id.',
      },
      buckshot_glance: { zh: '截取游戏当前画面。', en: 'Takes a screenshot of the game.' },
      buckshot_close: { zh: '关闭本 World 启动的游戏。', en: 'Closes the game this World launched.' },
    }),
    events: [
      {
        type: 'buckshot.ready',
        description: { zh: 'World 已挂载,游戏还没启动。', en: 'The World is mounted and the game has not been launched yet.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.connected',
        description: { zh: '游戏已启动并接上事件。', en: 'The game is running and its events are connected.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.disconnected',
        description: { zh: '与游戏的事件连接断开。', en: 'The event connection to the game dropped.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.closed',
        description: { zh: '游戏进程已退出。', en: 'The game process exited.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.error',
        description: { zh: '与游戏的连接出错。', en: 'The connection to the game failed.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.state',
        description: {
          zh: '可操作的目标、场景、轮次或回合变化,只列出与上次告知不同的内容。',
          en: 'The available targets, scene, round or turn changed; only what differs from the last report is listed.',
        },
        trigger: 'flush',
      },
      {
        type: 'buckshot.victory',
        description: { zh: '赢下对局,附奖金。', en: 'The game was won, with the prize money.' },
        trigger: 'flush',
      },
      {
        type: 'buckshot.frame',
        description: {
          zh: '开枪、揭示弹药等关键时刻后的游戏截图;可在配置里关掉。',
          en: 'A screenshot after key moments such as a shot or a revealed shell; can be turned off in the configuration.',
        },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.load',
        description: { zh: '霰弹枪重新装填,公开实弹与空包弹的数量。', en: 'The shotgun was reloaded, showing how many live and blank shells went in.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.reveal',
        description: { zh: '道具揭示了剩余弹药中某一发是实弹还是空包弹。', en: 'An item revealed whether one of the remaining shells is live or blank.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.ejection',
        description: { zh: '退出一发弹壳,并显示它是实弹还是空包弹。', en: 'A shell was ejected, showing whether it was live or blank.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.inversion',
        description: { zh: '有人用逆转器反转了膛内这一发。', en: 'Someone used the inverter to flip the chambered shell.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.shot',
        description: { zh: '有人开枪,打出的是实弹还是空包弹。', en: 'Someone fired, and whether the shell was live or blank.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.item',
        description: { zh: '玩家或庄家使用了一件道具。', en: 'The player or the dealer used an item.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.health',
        description: { zh: '生命计数器的读数变化。', en: 'The health counters changed.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.revival',
        description: { zh: '玩家被除颤器救回,对局继续。', en: 'The player was revived by the defibrillator and the game goes on.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.dialogue',
        description: { zh: '画面上的一段字幕显示完整。', en: 'A line of on-screen dialogue finished displaying.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.round',
        description: { zh: '新一轮开始。', en: 'A new round began.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.turn',
        description: { zh: '多人对局里轮到某个座位行动。', en: 'In multiplayer, a seat got the turn.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.turnorder',
        description: { zh: '多人对局的行动方向(顺时针或逆时针)。', en: 'The direction of play in multiplayer, clockwise or counterclockwise.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.result',
        description: { zh: '对局结算画面:单人胜利的奖金,或多人对局的结果。', en: 'The results screen: the prize money for a single-player win, or the multiplayer result.' },
        trigger: 'debounce',
      },
      {
        type: 'buckshot.clipboard',
        description: { zh: '游戏把多人大厅编号复制到了剪贴板。', en: 'The game copied the multiplayer lobby id to the clipboard.' },
        trigger: 'debounce',
      },
    ],
  },
};
