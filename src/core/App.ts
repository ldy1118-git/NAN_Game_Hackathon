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
}

const CALIB_KEY = 'nan-game.inputOffset';

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly actx: AudioContext;
  readonly audio: AudioEngine;
  readonly input: Input;
  readonly conductor: Conductor;

  private scene: Scene | null = null;
  private lastTime = 0;
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
    this.resize();
  }

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
  }

  start(): void {
    this.lastTime = performance.now();
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
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (!this.scene) return;
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
