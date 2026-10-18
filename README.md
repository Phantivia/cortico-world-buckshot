# `src/definition.ts`: cortico-world-buckshot

> 此乃直播测试验证之后的world，和其他 Persona / 非直播场景的兼容性有待测试。

Buckshot Roulette 的 Cortico World 扩展，契约版本 world 5，支持 Windows Steam v2.2.0.6。

## 接入

在本目录执行 `pnpm install`，从 Cortico 扩展页安装本目录，重启 Cortico。启用 World，在恶魔轮盘页的配置里将 `worlds.buckshot.executableFile` 设为原版 `Buckshot Roulette.exe`。激活不检查游戏程序；`buckshot_start` 启动游戏时校验。

启动校验整个程序的 SHA-256；其他版本拒绝植入。构造和扩展检查不需要游戏文件。

## 资源植入与存档

`src/implant.ts` 读取程序尾部的 Godot PCK v2，生成本机启动资源包。桥脚本先加载原程序资源，脚本观察点记录已经呈现的装填、射击、道具、弹药揭示、生命显示、复苏、字幕和结算。交互调用原版按钮及交互入口，游戏执行权限、动画、随机数和存档逻辑。

资源包位于 `runtimeDir`，留空使用 `<deployment>/runtimes/buckshot`。程序文件不被写入，缓存按源码和游戏版本区分并校验哈希。游戏资产与还原出的脚本不随扩展分发。

每个 runtimeDir 对应 `%APPDATA%/Cortico/Buckshot/<profile>` 下的独立游戏存档。剧情通关与 Double or Nothing 解锁由游戏写入该存档。

## 工具与直播事件

- `buckshot_start` 启动；`buckshot_close` 关闭本 World 启动的进程。
- `buckshot_observe` 返回环境、镜头目标、画面文字、生命显示、道具、公开弹药信息和操作目标。
- `buckshot_act` 使用目标 id 与同次观察的 revision 操作。版本或权限变化时拒绝输入。操作类工具（act、input、key、pointer、controller）不结束本轮，等游戏回到可操作状态或对局结果变化后返回（`src/settle.ts`），这期间的观察写进回执、不另发事件，回执附结算后的画面；超过 `settleTimeoutMs`（默认 30 秒）先返回，之后的变化作为事件送达。
- `buckshot_input` 触发游戏输入动作；`buckshot_key`、`buckshot_pointer` 和 `buckshot_controller` 发送键盘、鼠标和手柄输入。
- `buckshot_type` 填写有焦点的文字框，或写入剪贴板供游戏粘贴大厅编号。
- `buckshot_glance` 返回游戏渲染器的 PNG，供 bot 主动查看。

`buckshot.state` 描述场景与流程变化。`load`、`shot`、`item`、`reveal`、`ejection`、`inversion`、`health`、`revival`、`dialogue`、`round`、`turn`、`turnorder` 和 `result` 事件使用中文事实描述。环境与关键动作附带枪桌、金属器具、声音和道具意象；角色心情与未发生的结果不写入事件。字幕在完整显示后投递。

`buckshot.frame` 附带当前渲染帧及采集时的观察。场景与操作阶段变化、开枪、弹药揭示、复苏、字幕和结算会请求截图；重叠请求合并，默认最短间隔 1500 ms。`screenshotEvents.enabled` 控制自动图像事件，`screenshotEvents.minIntervalMs` 配置间隔。主动截图独立于自动事件开关。无画面模式不支持截图。

`display.screenIndex` 从 0 开始选择显示器，留空由游戏选择；`display.muteAudio` 使用静音音频驱动。这两项在下次启动生效。

## 本地加入

游戏已连接、bot 在多人模式里建好房间并停在大厅界面时，WebUI 恶魔轮盘页的「本地加入」在本机再启动一个游戏窗口，以 `localPeer.name` 的名字进入这个房间，由操作员用鼠标和 bot 对打。房主照常开局；「退出本地」关闭这个窗口，房间里的座位按玩家离开处理。

房主的 Steam 房间保持不变，本地客户端不初始化 Steam，用一个不属于任何账号的成员编号坐在房间里（`src/peer.ts`）。多人脚本里的收发包、房间成员、房主、加入与离开、玩家名字和 Steam 人数上限改由桥脚本提供：本地客户端的这些都经 World 中转给房主，其余成员仍交给 Steam。没有本地客户端时，这些调用与原版相同。

联网玩家可以同时在房间里。座位由房主分配、所有数据包经房主转发，联网玩家的原版游戏按房主的开局名单给本地玩家安排座位，尽管 Steam 不向他们列出这个成员。由此带来的差别：

- 本地玩家占一个座位，Steam 人数上限随之减一（4 人房最多再进 2 名联网玩家）。
- 联网玩家的大厅名单里没有本地玩家，对局里本地玩家的名字可能显示为空。
- 对局中本地玩家离开（「退出本地」或关掉窗口）时，联网玩家的游戏无从得知，房主让所有人回到大厅；联网玩家中途离开时，其余玩家照常继续。

本地客户端使用另一份存档（`<profile>` 另算），默认静音，避免直播里同一声音放两遍；`localPeer.screenIndex` 选择它的显示器。日志写在 `data/buckshot/game-peer.log`。

未揭示的弹序、庄家决策和其他玩家的私人揭示不进入协议。损坏或遮蔽的生命显示返回未知。反转未知弹药不公布其原种类。断连与回执超时不重放输入。

## 验证

`pnpm test` 验证本地端口、认证、消息分段、断连、回执超时、二进制资源包、直播描述和扩展声明。`pnpm run typecheck` 检查 TypeScript；`pnpm build:web` 构建 WebUI 面板。

`pnpm check:game <exe>` 校验安装，附加 `--launch` 可验证启动与连接；`--mute --screen=1` 选择静音和第二个显示器。`pnpm check:native <exe>` 使用无窗口游戏引擎运行自有场景，验证显示文字、权限、旧版本输入拒绝、公开弹药记录、结算和场景重置。测试套件不启动游戏或 bot。

真实游戏验证使用独立存档，覆盖剧情三轮、奖金结算、解锁及进入 Double or Nothing、全部九种单人道具、加倍和收款、设置开关、语言与按键重绑。多人验证覆盖本地玩家道具、四座射击、干扰器灯色、换向、自由观察、鼠标与手柄轴、死亡及三轮结算；其余玩家由禁用网络的本地模拟客户端驱动。自定义页面覆盖轮次数值、生命、右键和滚轮操作。真实 Steam 联机和邀请窗口需要在线客户端，尚未进行跨账号验收。

`pnpm tsx scripts/check-local-peer.ts <exe>` 用真实游戏验证本地加入：房主建房、本地客户端加入、开局，两边自动拿道具和开枪，打印双方看到的事件与状态。已验证两边的开枪、生命、装填、回合与道具栏一致。附加 `--with-remote` 再开一个模拟的 Steam 玩家：房主把它算作 Steam 成员，它看到的成员名单与 Steam 给它的一样（没有本地玩家）；脚本检查三人同桌、本地玩家中途离开后全员回大厅、Steam 玩家中途离开后其余两人继续。真实 Steam 账号联机未验证。
