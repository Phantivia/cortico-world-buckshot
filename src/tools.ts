import type { ToolDef } from 'cortico/core/types.ts';

const empty = { type: 'object', properties: {}, additionalProperties: false };
export const BUCKSHOT_TOOL_DECLS: readonly Omit<ToolDef, 'handler'>[] = [
  { name: 'buckshot_start', description: '启动恶魔轮盘并接入事件桥。', tags: ['write'], parameters: empty, barrierAfter: true },
  { name: 'buckshot_observe', description: '读取当前可见状态、可操作目标和已经揭示的弹药信息。', tags: ['read'], parameters: empty },
  { name: 'buckshot_act', description: '操作 buckshot_observe 列出的 target。游戏会按原规则处理；动画完成和下一次可操作状态通过事件送达。', tags: ['write'], barrierAfter: true, endsTurn: true,
    parameters: { type: 'object', properties: { target: { type: 'string' }, revision: { type: 'integer', description: '观察回执中的状态版本；变化时拒绝输入。' }, value: { type: 'number', description: '滑块的新值。' } }, required: ['target', 'revision'], additionalProperties: false } },
  { name: 'buckshot_input', description: '触发游戏定义的输入动作。名称来自观察的 inputActions。', tags: ['write'], barrierAfter: true, endsTurn: true,
    parameters: { type: 'object', properties: { name: { type: 'string' }, durationMs: { type: 'integer', minimum: 1, maximum: 5000 } }, required: ['name'], additionalProperties: false } },
  { name: 'buckshot_key', description: '发送键盘按键，可用于重绑键位和界面导航。key 使用 Enter、Escape、Space、A、F1 等键名。', tags: ['write'], barrierAfter: true, endsTurn: true,
    parameters: { type: 'object', properties: { key: { type: 'string' }, durationMs: { type: 'integer', minimum: 1, maximum: 5000 } }, required: ['key'], additionalProperties: false } },
  { name: 'buckshot_pointer', description: '在游戏视口内移动鼠标、点击或滚动。坐标按观察的 viewport 尺寸；自由观察使用 relativeX、relativeY。', tags: ['write'], barrierAfter: true, endsTurn: true,
    parameters: { type: 'object', properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 }, button: { type: 'string', enum: ['move', 'left', 'right', 'middle', 'wheel up', 'wheel down'] }, relativeX: { type: 'number' }, relativeY: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false } },
  { name: 'buckshot_controller', description: '发送游戏手柄输入。按钮编号 0–20，pressed 控制按下或松开；轴编号 0–5，value 为 -1–1。', tags: ['write'], barrierAfter: true, endsTurn: true,
    parameters: { type: 'object', properties: { button: { type: 'integer', minimum: 0, maximum: 20 }, pressed: { type: 'boolean' }, axis: { type: 'integer', minimum: 0, maximum: 5 }, value: { type: 'number', minimum: -1, maximum: 1 } }, additionalProperties: false } },
  { name: 'buckshot_type', description: '填写当前获得焦点的游戏文字输入框。签名机使用其列出的字母按钮。', tags: ['write'], barrierAfter: true,
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
  { name: 'buckshot_glance', description: '截取游戏当前画面。', tags: ['read'], parameters: empty },
  { name: 'buckshot_close', description: '关闭本 World 启动的游戏进程。', tags: ['write'], parameters: empty, barrierAfter: true },
];
