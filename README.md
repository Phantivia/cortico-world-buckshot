# `src/definition.ts`: cortico-world-buckshot

Buckshot Roulette 的 Cortico World 扩展，契约版本 world 5，当前支持 Windows Steam v2.2.0.6。

## 接入

在本目录执行 `pnpm install`，从 Cortico 扩展页安装本目录，重启 Cortico。配置 `worlds.buckshot.executableFile` 为原版 `Buckshot Roulette.exe`，启用 World 后，bot 可用 `buckshot_start` 启动游戏。

World 挂载时不启动游戏。构造和扩展检查不需要游戏文件。启动前校验整个程序的 SHA-256；其他版本拒绝植入。

## 资源植入

`src/implant.ts` 读取程序尾部的 Godot PCK v2，生成本机启动资源包。桥脚本首先加载原程序内的资源，六个脚本观察点记录装填、放大镜、电话、弹出弹药、逆转器和计数器。交互调用原版按钮或 `MainInteractionEvent`，游戏原有权限、动画、随机数和存档逻辑继续执行。

原程序不被写入。资源包位于配置的 `runtimeDir`，留空使用 `<deployment>/runtimes/buckshot`；包哈希用于检测缓存损坏。游戏资产和还原出的脚本不随扩展分发。

每个 runtimeDir 对应一个独立游戏存档，位于 `%APPDATA%/Cortico/Buckshot/<profile>`。不读取或改写玩家原有存档。剧情通关后的 Double or Nothing 解锁由原游戏写入该存档。

## 工具与事件

- `buckshot_start` 启动，`buckshot_close` 关闭本 World 启动的进程。
- `buckshot_observe` 返回画面文字、最近显示的生命、桌上道具、公开弹药信息和可操作目标。
- `buckshot_act` 使用目标 id 与观察版本提交一次输入；版本或权限变化时拒绝操作。回执确认输入送达，后续状态事件显示动画后的结果。
- `buckshot_input` 触发游戏原有输入，`buckshot_type` 填写有焦点的文字框。
- `buckshot_glance` 从游戏渲染器获取 PNG；无画面模式不支持截图。

目标改变产生 `buckshot.state`。观察点产生 `buckshot.load`、`buckshot.reveal`、`buckshot.ejection`、`buckshot.inversion`、`buckshot.health`。连接和进程退出单独报告。

未揭示的弹序和庄家决策不进入协议。生命计数器损坏时返回未知。逆转未知弹药只记录反转发生，不读取其原种类。协议断开或回执超时时不重放输入。

## 开发

`pnpm test` 验证真实本地端口、认证、分段消息、断连、回执超时、二进制资源包和扩展声明。`pnpm run typecheck` 检查 TypeScript。真实游戏验证使用独立存档；不通过测试套件启动游戏或 Bot。

当前真实游戏验证覆盖启动、菜单、进门、签名、开枪、第一轮胜出及第二轮领取道具。完整剧情结算、Double or Nothing、全部道具和多人流程仍在验证。
