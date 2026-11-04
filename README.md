# 恶魔轮盘 · Buckshot Roulette

[中文](#中文) · [English](#english)

让 Coo 玩 Steam 版《恶魔轮盘》(Buckshot Roulette),游戏里的事推给 Coo,Coo 自己拿枪、开枪、用道具。
Lets Coo play Buckshot Roulette on Steam: game events reach Coo, and Coo picks up the shotgun, fires and uses items itself.

## 中文

装填、开枪、道具、生命计数和字幕实时推给 Coo,关键时刻附一张游戏截图。Coo 用工具操作桌上的目标和菜单,单人剧情、Double or Nothing 和多人房间都能玩;操作员也可以在本机再开一个游戏窗口,和 Coo 同桌对打。适合直播里让 Coo 自己玩、自己解说。

此乃直播测试验证之后的 World,是 CortiV 直播里用过的参考实现,和其他 Persona、非直播场景的兼容性有待测试。

### 功能

- 启动和关闭游戏(`buckshot_start`、`buckshot_close`)。启动时校验游戏版本,生成植入资源包,原游戏文件不改。
- 读当前状态:场景、可操作的目标、生命、道具、本次装填公开的实弹与空包数、已退出和已揭示的弹药(`buckshot_observe`)。
- 操作桌上的目标和菜单:拿枪、选择朝谁开枪、拿道具、用道具、签名、开箱领奖、加倍或收款、改设置(`buckshot_act`)。操作后等动画结算完才回执,回执里带这期间的枪声、道具和字幕,以及结算后的画面。
- 发键盘、鼠标、手柄输入和游戏里定义的输入动作,填文字框或把大厅编号放进剪贴板。
- 随时截一张游戏画面(`buckshot_glance`)。
- 事件:装填、开枪、退弹、弹药揭示、逆转、道具使用、生命变化、除颤器复苏、字幕、新一轮、多人回合与方向、结算、胜利奖金,以及开枪、揭示、复苏、字幕和结算后的截图。
- 只给 Coo 画面上公开的信息。未揭示的弹序、庄家的决策、其他玩家私下看到的弹药都不提供。
- 本地加入:游戏在多人大厅建好房间后,在本机再开一个游戏窗口进这个房间,操作员用鼠标和 Coo 对打。

### 安装前准备

1. **游戏**:在 Windows 上用 Steam 购买并安装《Buckshot Roulette》。只支持 Steam Windows 版 **v2.2.0.6**:World 启动游戏时核对 `Buckshot Roulette.exe` 的大小与 SHA-256(`df2f8a31…1b1663`),对不上就拒绝启动。游戏程序在 Steam 库里右键游戏,「管理」→「浏览本地文件」打开的目录里。
2. **植入件**:不用编译,也不用手动放文件。植入件源码是仓里的 `src/native/bridge.gd`(桥脚本)和 `src/implant.ts`(往游戏脚本里加观察点的位置)。World 第一次启动游戏时读出 exe 里的游戏资源,加上桥脚本,在本机生成启动资源包,默认放在部署目录的 `runtimes/buckshot/`,再用 `--main-pack` 让游戏加载它。游戏文件不被写入,游戏资源也不随扩展分发。
3. **存档**:World 启动的游戏用单独的存档,在 `%APPDATA%/Cortico/Buckshot/<profile>` 下,和你平时玩的存档分开。剧情通关、解锁 Double or Nothing 都记在这份存档里。
4. **多人**:多人房间走 Steam 大厅,需要 Steam 客户端登录在线。

确认装好:启用 World 后在 World 页签点「启动游戏」,状态变成「已连接」就可以了。没连上时看部署目录 `data/buckshot/game.log`。

### 安装

在 Cortico 或 Coopanion 的扩展页搜 `cortico-world-buckshot` 安装,重启后在 World 总览里启用。命令行:

```bash
cd extensions
corepack pnpm add cortico-world-buckshot
```

启用后在恶魔轮盘页的配置里把「游戏程序」选成 `Buckshot Roulette.exe`。没配也能启用,启动游戏时才检查。

### 使用

- **启动**:World 页签的「游戏」卡片点「启动游戏」,或者让 Coo 调用 `buckshot_start`。卡片上显示状态、场景、模式、轮次和本地玩家状态。
- **Coo 怎么玩**:游戏连上后,Coo 收到可操作目标的变化,自己选目标操作。装填、开枪、字幕这些事件和截图到了,Coo 会接着行动或说话,说什么由 Coo 决定。
- **看画面**:「查看画面」在卡片里显示当前游戏画面。
- **本地加入**:先让 Coo 在多人模式里建好房间、停在大厅,再点「本地加入」。本机多开一个游戏窗口,以「本地玩家名字」进房间,你用鼠标操作。房主照常开局。点「退出本地」关掉这个窗口。
- **关闭**:「关闭游戏」只关本 World 启动的游戏。默认 World 停止时也会关掉游戏。

### 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `worlds.buckshot.executableFile` | 空 | 游戏程序 `Buckshot Roulette.exe` 的路径 |
| `worlds.buckshot.runtimeDir` | 空 | 植入资源包目录;留空用部署目录的 `runtimes/buckshot` |
| `worlds.buckshot.closeOnStop` | `true` | World 停止时关闭游戏 |
| `worlds.buckshot.settleTimeoutMs` | `30000` | 操作后等游戏回到可操作状态的最长时间;超过后先回执,之后的变化作为事件送达 |
| `worlds.buckshot.screenshotEvents.enabled` | `true` | 关键时刻自动推截图 |
| `worlds.buckshot.screenshotEvents.minIntervalMs` | `1500` | 自动截图最短间隔 |
| `worlds.buckshot.display.screenIndex` | 空 | 游戏开在第几个显示器,从 0 开始;留空由游戏选 |
| `worlds.buckshot.display.muteAudio` | `false` | 静音启动 |
| `worlds.buckshot.localPeer.name` | `Player 2` | 本地加入时的玩家名字 |
| `worlds.buckshot.localPeer.muteAudio` | `true` | 本地客户端静音,免得直播里声音放两遍 |

显示器和静音在下次启动游戏时生效。其余见 `src/config.ts`。

### 限制与常见问题

- 只支持 Steam Windows 版 v2.2.0.6。Steam 更新游戏后 exe 的哈希会变,World 会拒绝启动,要等扩展适配新版本。
- 本地玩家占一个座位,能进房间的联网玩家少一个(4 人房最多再进 2 名)。联网玩家的大厅名单里看不到本地玩家,对局里本地玩家的名字可能显示为空。本地玩家对局中途离开时,房主让所有人回到大厅。
- 真实 Steam 跨账号联机还没验收过。Steam 邀请窗口不在游戏画面里,Coo 操作不到。
- 事件和截图会频繁触发 Coo 的回合,token 用得快。可以关掉自动截图或调大间隔。

实现、协议和验证记录见 [docs/internals.md](https://github.com/Phantivia/cortico-world-buckshot/blob/main/docs/internals.md)。

## English

Shell loads, shots, items, health counters and dialogue reach Coo as they happen, with a screenshot at key moments. Coo works the table targets and menus through tools and can play the story, Double or Nothing and multiplayer lobbies. The operator can also open a second game window on the same PC and sit at the table against Coo. It is meant for streams where Coo plays and commentates on its own.

This World was verified on live streams. It is the reference implementation used on CortiV streams; compatibility with other Personas and non-streaming setups has not been tested.

### Features

- Starts and closes the game (`buckshot_start`, `buckshot_close`). Starting checks the game version and builds an implant pack; the game files are never modified.
- Reads the current state: scene, operable targets, health, items, the live and blank counts of the current load, and the shells ejected or revealed so far (`buckshot_observe`).
- Operates table targets and menus: pick up the shotgun, choose who to shoot, take and use items, sign the waiver, open the briefcase, double or cash out, change settings (`buckshot_act`). The reply waits until the animation settles and includes the shots, items and dialogue from that time plus a screenshot.
- Sends keyboard, mouse and gamepad input and the game's own input actions, types into text fields or puts a lobby id on the clipboard.
- Takes a screenshot on demand (`buckshot_glance`).
- Events: loads, shots, ejections, reveals, inversions, item use, health changes, defibrillator revivals, dialogue, new rounds, multiplayer turns and direction, results and prize money, plus screenshots after shots, reveals, revivals, dialogue and results.
- Coo only gets what the screen shows. The unrevealed shell order, the dealer's decisions and other players' private reveals are left out.
- Local join: once the game hosts a multiplayer lobby, a second game window on this PC joins it so the operator can play Coo with the mouse.

### Before you install

1. **The game**: buy and install Buckshot Roulette through Steam on Windows. Only the Steam Windows build **v2.2.0.6** is supported. When starting the game the World checks the size and SHA-256 (`df2f8a31…1b1663`) of `Buckshot Roulette.exe` and refuses any other build. To find the exe, right-click the game in your Steam library and choose Manage → Browse local files.
2. **The implant**: nothing to compile or copy by hand. Its sources are `src/native/bridge.gd` (the bridge script) and `src/implant.ts` (where it hooks into the game's scripts). The first time the World starts the game it reads the game's resources out of the exe, adds the bridge script and writes a startup pack on this machine, by default in `runtimes/buckshot/` under the deployment, then launches the game with `--main-pack` pointing at it. The game files are not written to, and no game assets ship with the extension.
3. **Save data**: the game started by the World keeps its own save under `%APPDATA%/Cortico/Buckshot/<profile>`, apart from your normal save. Story completion and the Double or Nothing unlock are stored there.
4. **Multiplayer**: lobbies go through Steam, so the Steam client must be signed in and online.

To check: enable the World, click 启动游戏 (Start game) in the World tab, and wait for the status to read 已连接 (connected). If it does not connect, look at `data/buckshot/game.log` in the deployment.

### Install

Search for `cortico-world-buckshot` on the Extensions page in Cortico or Coopanion, install it, restart, and enable it in the World overview. From the command line:

```bash
cd extensions
corepack pnpm add cortico-world-buckshot
```

Then set 游戏程序 (game executable) in the Buckshot Roulette page's settings to `Buckshot Roulette.exe`. The World can be enabled without it; the path is checked when the game starts.

### Usage

- **Start**: click 启动游戏 on the 游戏 card in the World tab, or let Coo call `buckshot_start`. The card shows the status, scene, mode, round and the local player's state.
- **How Coo plays**: once the game is connected, Coo is told when the operable targets change and picks targets on its own. When loads, shots, dialogue or screenshots arrive, Coo acts or talks next; what it says is up to Coo.
- **View**: 查看画面 shows the current game view on the card.
- **Local join**: have Coo host a multiplayer lobby and stay on the lobby screen, then click 本地加入. A second game window opens on this PC and joins under the local player name; you play it with the mouse. The host starts the match as usual. 退出本地 closes that window.
- **Close**: 关闭游戏 closes only the game this World started. By default the game also closes when the World stops.

### Configuration

| Key | Default | Description |
|---|---|---|
| `worlds.buckshot.executableFile` | empty | Path to `Buckshot Roulette.exe` |
| `worlds.buckshot.runtimeDir` | empty | Where the implant pack goes; empty uses `runtimes/buckshot` in the deployment |
| `worlds.buckshot.closeOnStop` | `true` | Close the game when the World stops |
| `worlds.buckshot.settleTimeoutMs` | `30000` | How long an action waits for the game to be operable again; after that the reply returns and later changes arrive as events |
| `worlds.buckshot.screenshotEvents.enabled` | `true` | Send screenshots at key moments |
| `worlds.buckshot.screenshotEvents.minIntervalMs` | `1500` | Minimum gap between automatic screenshots |
| `worlds.buckshot.display.screenIndex` | empty | Monitor for the game, from 0; empty lets the game choose |
| `worlds.buckshot.display.muteAudio` | `false` | Start the game muted |
| `worlds.buckshot.localPeer.name` | `Player 2` | Local player name for local join |
| `worlds.buckshot.localPeer.muteAudio` | `true` | Mute the local client so the stream does not hear the audio twice |

Monitor and mute settings apply the next time the game starts. The rest are in `src/config.ts`.

### Limitations and FAQ

- Only the Steam Windows build v2.2.0.6 works. A Steam update changes the exe hash, and the World will refuse to start until the extension supports the new build.
- The local player takes a seat, so one fewer online player fits (a 4-player lobby takes 2 more). Online players do not see the local player in the lobby list, and its name may show as blank in the match. If the local player leaves mid-match, the host sends everyone back to the lobby.
- Real cross-account Steam multiplayer has not been verified. The Steam invite window is outside the game view, so Coo cannot use it.
- Events and screenshots start Coo's turns often, so token use adds up. Turn off automatic screenshots or raise the interval to cut it.

Implementation, protocol and test notes: [docs/internals.md](https://github.com/Phantivia/cortico-world-buckshot/blob/main/docs/internals.md).

## 开发 · Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:web   # dist/webui.js; also runs on prepack
```

`corepack pnpm check:game <exe>` checks a game install (`--launch` also starts it); `corepack pnpm check:native <exe>` runs the bridge in the game's headless engine. Details in [docs/internals.md](https://github.com/Phantivia/cortico-world-buckshot/blob/main/docs/internals.md).

## 许可 · License

MIT
