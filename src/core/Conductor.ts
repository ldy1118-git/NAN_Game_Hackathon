/**
 * Conductor — 이 게임의 시간 기준점.
 *
 * 리듬게임에서 "딱딱 맞는" 느낌의 90%는 여기서 결정된다.
 * requestAnimationFrame 의 델타를 누적해서 시간을 세면 프레임 드랍마다 오차가
 * 영구히 쌓이므로, 절대 그렇게 하지 않는다. AudioContext.currentTime 이 유일한
 * 마스터 클럭이고, 화면에 그려지는 모든 값은 매 프레임 이 클럭에서 새로 계산한다.
 *
 * 시간 축이 세 개라서 헷갈리기 쉬운데, 정리하면:
 *
 *   ctx.currentTime  스케줄러가 쓰는 시간. 여기에 예약한 소리는
 *                    실제로는 outputLatency 만큼 뒤에 스피커에서 난다.
 *   audibleTime      = ctx.currentTime - outputLatency
 *                    "지금 귀에 들리고 있는" 소리의 시간. 화면과 판정은
 *                    반드시 이 축을 써야 눈/귀/손이 한 지점에서 만난다.
 *   inputOffset      키보드·OS·모니터가 먹는 지연. 사람마다 달라서
 *                    캘리브레이션으로 측정한 뒤 판정에서 빼준다.
 */
export class Conductor {
  readonly ctx: AudioContext;

  bpm = 120;
  /** 캘리브레이션으로 측정한 입력 지연(초). 판정 시 눌린 시각에서 빼준다. */
  inputOffset = 0;

  private originTime = 0; // beat 0 이 재생되는 ctx 시각
  private running = false;
  private paused = false;
  /** 일시정지한 순간의 박. 멈춰 있는 동안 beat 는 이 값에 고정된다. */
  private pausedBeat = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** 출력 지연(초). 브라우저가 알려주지 않으면 buffer 기반 추정치로 대체. */
  get outputLatency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return c.outputLatency || c.baseLatency || 0;
  }

  /** 지금 이 순간 귀에 도달하고 있는 소리의 ctx 시각. */
  get audibleTime(): number {
    return this.ctx.currentTime - this.outputLatency;
  }

  get secPerBeat(): number {
    return 60 / this.bpm;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * @param leadIn beat 0 까지 비워둘 여유(초). 첫 노트가 시작하자마자
   *               튀어나오지 않도록, 그리고 스케줄러가 미리 예약할 시간을 벌도록.
   */
  start(bpm: number, leadIn = 1.2): void {
    this.bpm = bpm;
    this.originTime = this.ctx.currentTime + leadIn;
    this.running = true;
    this.paused = false;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
  }

  /**
   * 시간을 멈춘다. 멈춘 동안 beat 는 그 자리에 고정된다.
   *
   * originTime 을 그대로 두면 ctx.currentTime 은 계속 흐르므로 곡이 혼자
   * 진행해 버린다. 탭을 8초 비웠다가 돌아오면 그 사이 노트가 전부 놓침으로
   * 확정되는 게 그래서였다.
   *
   * @param rewindSec 멈춘 걸 뒤늦게 알아챈 경우, 알아챈 시점에서 이만큼 되감아
   *   멈춘다. 루프가 멎어 있는 동안에도 오디오 클럭은 흘렀으므로, 그냥 지금 박에
   *   멈추면 그 사이 구간을 건너뛴 게 되어 재개 직후 전부 놓침으로 확정된다.
   *   플레이어가 실제로 있던 자리로 되돌려 놓아야 한다.
   */
  pause(rewindSec = 0): void {
    if (!this.running || this.paused) return;
    this.pausedBeat = Math.max(0, this.beat - rewindSec / this.secPerBeat);
    this.paused = true;
  }

  /** 멈춘 지점의 박에서 그대로 이어간다. */
  resume(): void {
    if (!this.paused) return;
    // 지금 이 순간이 pausedBeat 이 되도록 기준점을 다시 잡는다.
    this.originTime = this.audibleTime - this.pausedBeat * this.secPerBeat;
    this.paused = false;
  }

  /** 현재 박(소수 포함). 화면 그리기는 전부 이 값에서 파생시킨다. */
  get beat(): number {
    if (this.paused) return this.pausedBeat;
    return (this.audibleTime - this.originTime) / this.secPerBeat;
  }

  /** 스케줄러 전용: 아직 예약하지 않은 미래를 보기 위한 raw 시각 기준 박. */
  get scheduleBeat(): number {
    if (this.paused) return this.pausedBeat;
    return (this.ctx.currentTime - this.originTime) / this.secPerBeat;
  }

  /** 박 → 오디오 예약에 넣을 ctx 시각. */
  beatToCtxTime(beat: number): number {
    return this.originTime + beat * this.secPerBeat;
  }

  /** 키가 눌린 ctx 시각 → 보정된 박. 판정은 이걸로 한다. */
  pressToBeat(pressCtxTime: number): number {
    const t = pressCtxTime - this.outputLatency - this.inputOffset;
    return (t - this.originTime) / this.secPerBeat;
  }
}
