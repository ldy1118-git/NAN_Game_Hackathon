/**
 * Input — 키가 눌린 "오디오 시각"을 정확히 잡아내는 게 전부인 모듈.
 *
 * keydown 핸들러가 실행되는 시점은 실제로 키가 눌린 시점보다 늦다(이벤트 큐 대기).
 * event.timeStamp 는 브라우저가 이벤트를 만든 시각이라 훨씬 정확하므로,
 * 그 둘의 차이만큼 ctx.currentTime 을 되감아서 기록한다. 프레임 경계로 반올림된
 * 시각을 쓰는 것보다 최대 한 프레임(16ms)만큼 이득이고, 60fps 리듬게임에서
 * 16ms 는 판정 등급 하나가 갈리는 크기다.
 */
export interface Press {
  code: string;
  /** 키가 눌리거나 떼진 순간의 AudioContext 시각(초). */
  ctxTime: number;
  /**
   * 눌림인지 뗌인지. 길게 누르는 노트(hold)는 두 시각이 모두 필요하다.
   * 순서가 중요하므로 down/up 을 한 큐에 담는다.
   */
  kind: 'down' | 'up';
}

const GAMEPLAY_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyQ', 'KeyW', 'KeyE', 'KeyI', 'KeyO', 'KeyP',
]);

export class Input {
  private ctx: AudioContext;
  private queue: Press[] = [];
  private held = new Set<string>();
  private uiHandlers: ((code: string) => void)[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    // 마우스/터치도 스페이스와 동일하게 취급 — 모바일에서도 그대로 돌아가도록.
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    // 창에서 포커스가 나가면 키를 뗀 것으로 본다. 안 그러면 hold 가 눌린 채로 남는다.
    window.addEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (GAMEPLAY_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return; // 꾹 누르고 있는 자동반복은 입력이 아니다
    this.held.add(e.code);

    this.queue.push({ code: e.code, ctxTime: this.stamp(e), kind: 'down' });

    for (const h of this.uiHandlers) h(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.held.delete(e.code)) return;
    this.queue.push({ code: e.code, ctxTime: this.stamp(e), kind: 'up' });
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.queue.push({ code: 'Space', ctxTime: this.stamp(e), kind: 'down' });
    for (const h of this.uiHandlers) h('Space');
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.queue.push({ code: 'Space', ctxTime: this.stamp(e), kind: 'up' });
  };

  private onBlur = (): void => {
    for (const code of this.held) {
      this.queue.push({ code, ctxTime: this.ctx.currentTime, kind: 'up' });
    }
    this.held.clear();
  };

  /** 이벤트가 만들어진 시각을 AudioContext 시간축으로 되감아 기록한다. */
  private stamp(e: KeyboardEvent | PointerEvent): number {
    const lag = Math.max(0, (performance.now() - e.timeStamp) / 1000);
    return this.ctx.currentTime - lag;
  }

  /** 이번 프레임에 들어온 입력을 가져가고 큐를 비운다. */
  drain(): Press[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /** 판정과 무관한 UI 조작(메뉴 이동 등)용. */
  onUiKey(handler: (code: string) => void): () => void {
    this.uiHandlers.push(handler);
    return () => {
      const i = this.uiHandlers.indexOf(handler);
      if (i >= 0) this.uiHandlers.splice(i, 1);
    };
  }

  clear(): void {
    this.queue.length = 0;
  }
}
