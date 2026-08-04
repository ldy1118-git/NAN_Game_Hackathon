import { AudioEngine } from './AudioEngine';
import { Conductor } from './Conductor';
import { Input } from './Input';
import { C, H, W } from './draw';

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
const VOLUME_KEY = 'nan-game.volume';
const MUTED_KEY = 'nan-game.muted';

/** 음량 표시를 띄워두는 시간(초). 바뀐 직후에만 잠깐 보인다. */
const VOLUME_HUD_SEC = 1.6;
const VOLUME_STEP = 0.1;

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
  /** 음량 표시를 띄운 시각(performance.now). 연출용이라 벽시계로 충분하다. */
  private volumeShownAt = -1e9;

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

    this.audio.volume = loadNumber(VOLUME_KEY, 0.9, 0, 1);
    this.audio.isMuted = localStorage_.get(MUTED_KEY) === '1';

    window.addEventListener('resize', this.resize);
    // 탭 전환은 프레임 간격보다 먼저 알 수 있는 빠른 경로다.
    document.addEventListener('visibilitychange', this.onVisibility);
    // 음량 조절은 어느 씬에 있든 통해야 하므로 씬이 아니라 여기서 받는다.
    this.input.onUiKey((code) => this.onGlobalKey(code));
    this.resize();
  }

  private onGlobalKey(code: string): void {
    if (code === 'KeyM') {
      this.audio.isMuted = !this.audio.isMuted;
      localStorage_.set(MUTED_KEY, this.audio.isMuted ? '1' : '0');
    } else if (code === 'Minus' || code === 'Equal') {
      // 음량을 건드리면 음소거는 자동으로 풀린다. 안 그러면 왜 소리가 안 나는지 모른다.
      this.audio.isMuted = false;
      localStorage_.set(MUTED_KEY, '0');
      // 부동소수 오차가 쌓여 0.6000000000000001 같은 값이 저장되지 않도록 한 칸 단위로 맞춘다.
      const steps = Math.round(this.audio.volume / VOLUME_STEP) + (code === 'Equal' ? 1 : -1);
      this.audio.volume = steps * VOLUME_STEP;
      localStorage_.set(VOLUME_KEY, this.audio.volume.toFixed(2));
    } else {
      return;
    }
    this.volumeShownAt = performance.now();
  }

  private onVisibility = (): void => {
    // 아직 아무 시간도 흐르지 않았으므로 되감을 것이 없다.
    if (document.hidden) this.scene?.onStall?.(0);
  };

  /**
   * 캘리브레이션 값(초)을 적용한다.
   *
   * @param persist 저장까지 할지. 측정을 취소하고 원래 값으로 되돌리는 경우에는
   *   false 를 넘긴다. 되돌리는 것까지 저장해 버리면 한 번도 측정한 적 없는
   *   사람이 "측정 완료"로 기록되어, 첫 실행 안내가 다시는 안 뜬다.
   */
  saveInputOffset(sec: number, persist = true): void {
    this.conductor.inputOffset = sec;
    if (persist) localStorage_.set(CALIB_KEY, String(sec));
  }

  /** 캘리브레이션을 한 번이라도 마쳤는지. 첫 실행 안내를 띄울지 판단하는 데 쓴다. */
  get hasCalibrated(): boolean {
    return localStorage_.get(CALIB_KEY) !== null;
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

    this.g.save();
    this.drawVolume(this.g, now);
    this.g.restore();
  };

  /**
   * 음량 표시 — 바꾼 직후 잠깐 떴다가 사라진다.
   * 음소거 중일 때는 계속 띄운다. 소리가 안 나는 이유를 화면에서 알 수 있어야 한다.
   */
  private drawVolume(g: CanvasRenderingContext2D, now: number): void {
    const age = (now - this.volumeShownAt) / 1000;
    const muted = this.audio.isMuted;
    if (age > VOLUME_HUD_SEC && !muted) return;

    // 마지막 0.4초 동안 사라진다. 음소거 중이면 옅게 계속 남는다.
    const fade = age > VOLUME_HUD_SEC ? 0.55 : Math.min(1, (VOLUME_HUD_SEC - age) / 0.4);
    const x = 26;
    const y = H - 30;

    g.globalAlpha = fade;
    g.fillStyle = muted ? C.pink : C.inkSoft;

    // 스피커 — 몸통 + 원뿔
    g.beginPath();
    g.rect(x, y - 5, 6, 10);
    g.moveTo(x + 6, y);
    g.lineTo(x + 15, y - 9);
    g.lineTo(x + 15, y + 9);
    g.closePath();
    g.fill();

    if (muted) {
      g.strokeStyle = C.pink;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + 21, y - 6);
      g.lineTo(x + 31, y + 6);
      g.moveTo(x + 31, y - 6);
      g.lineTo(x + 21, y + 6);
      g.stroke();
    } else {
      // 10칸 계단 막대. 켜진 칸 수가 곧 음량이고, 바닥은 한 줄로 맞춘다.
      const steps = Math.round(this.audio.volume / VOLUME_STEP);
      const base = y + 9;
      for (let i = 0; i < 10; i++) {
        const h = 4 + i * 1.5;
        g.fillStyle = i < steps ? C.ink : 'rgba(43, 42, 51, 0.18)';
        g.fillRect(x + 24 + i * 8, base - h, 5, h);
      }
    }
  }

  get viewScale(): number {
    return this.scale;
  }
}

/**
 * localStorage 는 시크릿 모드나 저장소 차단 설정에서 접근만으로도 예외를 던진다.
 * 저장이 안 되는 건 이번 세션을 못 쓸 이유가 아니므로 조용히 넘긴다.
 */
const localStorage_ = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 무시 — 이번 세션에는 이미 적용돼 있다.
    }
  },
};

function loadNumber(key: string, fallback: number, lo: number, hi: number): number {
  const raw = localStorage_.get(key);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
}

function loadOffset(): number {
  // 200ms 를 넘는 값은 측정 실패로 보고 버린다.
  return loadNumber(CALIB_KEY, 0, -0.2, 0.2);
}
