import type { WebUiClientBundle, WebUiPanel } from 'cortico/web/shared/client-panel.ts';
import type { BuckshotGameState } from './types.ts';

const game: WebUiPanel = {
  mount(ctx) {
    const { ui } = ctx;
    const card = ui.sheet({ title: '游戏' });
    const status = ui.h('div');
    const message = ui.msgline();
    const actions = ui.actions();
    const start = ui.button('启动游戏', { variant: 'primary' });
    const stop = ui.button('关闭游戏', { variant: 'danger' });
    const capture = ui.button('查看画面');
    const preview = ui.h('img');
    preview.alt = '游戏当前画面';
    preview.style.cssText = 'display:none;width:100%;height:auto;margin-top:12px;';
    actions.append(start, stop, capture);
    card.body.append(status, message, actions, preview);
    ctx.root.append(card.el);
    let busy = false;
    let url: string | null = null;
    ctx.own({ dispose() { if (url) URL.revokeObjectURL(url); } });
    function render(state: BuckshotGameState) {
      status.replaceChildren(ui.kv([
        { k: '状态', v: ui.pill({ offline: '未启动', loading: '启动中', online: '已连接', error: '启动失败' }[state.state], state.state === 'online' ? 'on' : 'off') },
        { k: '场景', v: state.scene ?? '—' },
        { k: '模式', v: state.mode ?? '—' },
        { k: '轮次', v: state.round === undefined ? '—' : String(state.round) },
      ]));
      message.textContent = state.error;
      start.disabled = busy || state.state === 'online' || state.state === 'loading';
      stop.disabled = busy || !state.stoppable;
      capture.disabled = busy || state.state !== 'online';
    }
    async function refresh() { if (!ctx.signal.aborted) render(await ctx.invoke<BuckshotGameState>('state')); }
    async function act(method: 'start' | 'stop') {
      busy = true; start.disabled = stop.disabled = capture.disabled = true;
      try { render(await ctx.invoke<BuckshotGameState>(method)); await ctx.refresh(); }
      catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
      finally { busy = false; await refresh().catch(() => undefined); }
    }
    start.addEventListener('click', () => { void act('start'); }, { signal: ctx.signal });
    stop.addEventListener('click', () => { void act('stop'); }, { signal: ctx.signal });
    capture.addEventListener('click', () => {
      void ctx.invokeBinary('capture').then((blob) => {
        if (ctx.signal.aborted) return;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob); preview.src = url; preview.style.display = 'block';
      }).catch((error) => { message.textContent = error instanceof Error ? error.message : String(error); });
    }, { signal: ctx.signal });
    void refresh().catch((error) => { message.textContent = String(error); });
    ctx.interval(() => { if (!busy) void refresh().catch(() => undefined); }, 1000);
  },
};

export default { panels: { game } } satisfies WebUiClientBundle;
