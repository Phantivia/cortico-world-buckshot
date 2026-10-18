# Changelog

## 未发布

- WebUI 恶魔轮盘页加「本地加入」:游戏在多人大厅建好房间后，在本机再开一个游戏窗口进这个房间，操作员和 bot 两人对打。新配置 `localPeer`(名字、显示器、静音),新事件 `buckshot.peer`。联网玩家可以同时在房间里;本地玩家对局中途离开时所有人回大厅。
  The WebUI page adds Local join: once the game hosts a multiplayer lobby, a second game window on this machine joins it so the operator can play the bot. New `localPeer` settings (name, screen, mute) and a `buckshot.peer` event. Steam players can share the lobby; if the local player leaves mid-match, everyone returns to the lobby.

## 0.2.0

- 适配 Cortico 0.2.0(扩展契约 world 6):浏览器界面改名 WebUI,面板源码移到 `src/webui/`,产物为 `dist/webui.js`;需要 Cortico 0.2.0 或更新版本。
  Targets Cortico 0.2.0 (world contract 6): the browser UI is now WebUI, panel sources live in `src/webui/` and build to `dist/webui.js`; requires Cortico 0.2.0 or later.
- 定义加上自描述,包里附带 `describe.json`,列出全部工具与事件。
  The definition now describes itself; `describe.json` in the package lists every tool and event.
