import { AudioEngine } from './AudioEngine';
import { Conductor } from './Conductor';
import { Input } from './Input';
import { H, W } from './draw';

export interface Scene {
  enter?(app: App): void;
  exit?(): void;
  /** @param dt 이전 프레임과의 간격(초). 연출용으로만 쓰고, 박자 계산엔 절대 쓰지 않는다. */
  update(dt: number): void;
  draw(g: CanvasRenderingContext2D): void;
  /**
   * 루프가 한동안 멈췄다가 돌아왔을 때. 씬이 알아서 수습한다.
   * @param gapSec 루프가 멎어 있던 시간(초). 탭 전환처럼 멈추기 직전에
   *   미리 알 수 있는 경우는 0 이다.
   * @see STALL_SEC
   */
  onStall?(gapSec: number): void;
}

const CALIB_KEY = 'nan-game.inputOffset';

/**
 * 이보다 긴 프레임 간격은 "루프가 멈췄다 왔다"로 본다.
 *
 * requestAnimationFrame 은 백그라운드 탭에서 멈추지만 AudioContext.currentTime 은
 * 계속 흐른다. 그래서 돌아온 순간 곡만 혼자 진행해 있고, 스케줄러는 밀린 구간을
 * 한 프레임에 따라잡으려 든다.
 *
 * visibilitychange 로 탭 전환은 잡히지만 그게 전부가 아니다 — 창 가림, 절전,
 * 긴 GC, 디버거 중단점은 visibilitychange 를 발생시키지 않는다. 그래서 간격
 * 자체를 신호로 쓴다. 250ms 는 아무리 느린 기기의 정상 프레임(60ms 남짓)보다
 * 충분히 크고, 사람이 "끊겼다"고 느끼기 시작하는 지점이기도 하다.
 *
 * 간격은 requestAnimationFrame 이 주는 시각이 아니라 AudioContext.currentTime
 * 으로 잰다. rAF 의 시각은 그 프레임의 vsync 시각이라 멈췄다 돌아온 직후 한 번은
 * 멈추기 전 값이 그대로 올 수 있다. 실제로 그 한 프레임이 새서, 클럭이 16박
 * 건너뛴 채로 update 가 한 번 돌아 노트 7개가 놓침으로 확정됐다.
 * 이 프로젝트에서 시간의 유일한 출처는 오디오 클럭이라는 원칙이 여기에도 적용된다.
 */
const STALL_SEC = 0.25;

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly actx: AudioContext;
  readonly audio: AudioEngine;
  readonly input: Input;
  readonly conductor: Conductor;

  private scene: Scene | null = null;
  private lastTime = 0;
  /** 직전 프레임의 오디오 클럭 시각. 멈춤 판정의 기준. */
  private lastCtxTime = 0;
  private scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.g = g;

    // latencyHint: 'interactive' — 버퍼를 짧게 잡아 입력→소리 지연을 줄인다.
    this.actx = new AudioContext({ latencyHint: 'interactive' });
    this.audio = new AudioEngine(this.actx);
    this.input = new Input(this.actx);
    this.conductor = new Conductor(this.actx);
    this.conductor.inputOffset = loadOffset();

    window.addEventListener('resize', this.resize);
    // 탭 전환은 프레임 간격보다 먼저 알 수 있는 빠른 경로다.
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  private onVisibility = (): void => {
    // 아직 아무 시간도 흐르지 않았으므로 되감을 것이 없다.
    if (document.hidden) this.scene?.onStall?.(0);
  };

  /** 캘리브레이션 값(초)을 저장하고 즉시 적용. */
  saveInputOffset(sec: number): void {
    this.conductor.inputOffset = sec;
    try {
      localStorage.setItem(CALIB_KEY, String(sec));
    } catch {
      // 시크릿 모드 등에서 실패해도 이번 세션에는 적용되므로 무시.
    }
  }

  setScene(s: Scene): void {
    this.scene?.exit?.();
    this.input.clear();
    this.scene = s;
    s.enter?.(this);
    // 씬 전환에 걸린 시간이 새 씬의 멈춤으로 잡히지 않도록 기준을 다시 잡는다.
    this.lastCtxTime = this.actx.currentTime;
  }

  start(): void {
    this.lastTime = performance.now();
    this.lastCtxTime = this.actx.currentTime;
    requestAnimationFrame(this.loop);
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    this.scale = s;
    this.canvas.style.width = `${Math.round(W * s)}px`;
    this.canvas.style.height = `${Math.round(H * s)}px`;
    this.canvas.width = Math.round(W * s * dpr);
    this.canvas.height = Math.round(H * s * dpr);
    this.g.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  };

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    // 연출용 dt 는 클램프한다. 한 프레임 밀렸다고 애니메이션이 순간이동하면 안 된다.
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // 멈춤 판정은 오디오 클럭으로 한다. rAF 시각은 복귀 직후 한 번 못 믿는다.
    const ctxNow = this.actx.currentTime;
    const audioGap = ctxNow - this.lastCtxTime;
    this.lastCtxTime = ctxNow;

    if (!this.scene) return;
    if (audioGap > STALL_SEC) this.scene.onStall?.(audioGap);
    this.scene.update(dt);

    // setTransform 은 resize 때 잡아둔 스케일을 유지해야 하므로 save/restore 로 감싼다.
    this.g.save();
    this.scene.draw(this.g);
    this.g.restore();
  };

  get viewScale(): number {
    return this.scale;
  }
}

function loadOffset(): number {
  try {
    const v = Number(localStorage.getItem(CALIB_KEY));
    // 200ms 를 넘는 값은 측정 실패로 보고 버린다.
    return Number.isFinite(v) && Math.abs(v) < 0.2 ? v : 0;
  } catch {
    return 0;
  }
}
