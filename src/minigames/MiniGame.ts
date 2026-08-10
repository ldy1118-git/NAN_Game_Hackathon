import type { AudioEngine } from '../core/AudioEngine';
import type { BeatEvent, JudgeStats, Verdict } from '../core/types';
import type { LastJudge } from '../core/Runner';
import type { Control } from './howto';

/** 미니게임이 화면을 그릴 때 받는 정보. 전부 읽기 전용으로 다룬다. */
export interface RenderInfo {
  /** 현재 박(소수 포함). 모든 애니메이션의 유일한 입력. */
  beat: number;
  events: BeatEvent[];
  stats: JudgeStats;
  lastJudge: LastJudge | null;
  combo: number;
}

/**
 * 미니게임 하나가 지켜야 할 계약.
 *
 * 핵심 규칙 하나: draw() 는 반드시 `beat` 만 보고 그림을 결정해야 한다.
 * 내부에 위치나 속도를 상태로 들고 프레임마다 적분하면, 프레임이 한 번만 밀려도
 * 그림과 소리가 영구히 어긋난다. 상태 대신 함수로 그리면 언제나 다시 맞는다.
 *
 * 생성자는 `(difficulty, seed)` 를 받는다. difficulty 로 조임새를 정하고,
 * seed 로 채보를 뽑는다. **채보는 반드시 seed 에서 만들어야 한다** — 고정 배열을
 * 그대로 쓰면 몇 판 만에 외워지고, 그때부터는 리듬게임이 아니라 암기 시험이 된다.
 */
export interface MiniGame {
  readonly id: string;
  readonly title: string;
  /** 시작 화면에 띄울 한 줄 설명. */
  readonly hint: string;
  /** 설명 화면의 조작 안내. 위에서부터 중요한 순서로. */
  readonly controls: readonly Control[];
  /** 설명 화면의 "어떻게 점수가 되는가" 한 줄. */
  readonly scoring: string;
  readonly bpm: number;
  /** 이 박을 넘기면 결과 화면으로. */
  readonly endBeat: number;
  /**
   * 메뉴에 뜨는 순서. 작을수록 위. 안 적으면 100 이라 나중에 붙는다.
   *
   * 목록을 한 파일에 모아두지 않고 각자 자기 파일에 순서를 적는 이유는,
   * 그래야 새 게임을 추가할 때 아무도 공용 파일을 건드리지 않기 때문이다.
   * 쉬운 것부터 오도록 10, 20, 30 처럼 띄엄띄엄 매기면 사이에 끼워넣기 쉽다.
   */
  readonly order?: number;
  /**
   * 판정 입력으로 받아들일 키 코드. 생략하면 Space + ArrowUp (기존 동작).
   * 여러 키를 쓰는 게임은 여기 명시하고, hit 이벤트의 data.key 로 필요한 키를 지정한다.
   */
  readonly acceptedKeys?: readonly string[];
  /**
   * 판정 창(ms) 오버라이드. 생략하면 core/types.ts 의 WINDOW_MS 를 쓴다.
   * 두더지 잡기처럼 넓은 반응 창이 필요한 게임에서 사용.
   */
  readonly hitWindowMs?: { perfect: number; good: number; expire: number };
  /**
   * 판정 문구("완벽" 등)를 띄울 y. 생략하면 176 (화면 위쪽).
   *
   * 기본값은 캐릭터가 바닥 근처에 있는 게임을 전제한 자리다. 화면 위쪽을 쓰는
   * 게임은 문구가 그림 위에 겹치므로 비어 있는 높이로 옮긴다.
   */
  readonly verdictY?: number;

  /** 채보. Runner 가 시작할 때 한 번 호출한다. */
  build(): BeatEvent[];

  /** 반주. step 은 8분음표 인덱스, t 는 예약할 ctx 시각. */
  groove(step: number, t: number, a: AudioEngine): void;

  /** cue 이벤트(게임이 들려주는 신호)의 소리를 예약. */
  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void;

  /**
   * 플레이어가 눌렀을 때 나는 소리.
   * @param ev 판정된 hit 이벤트. 여러 키 중 어느 키가 눌렸는지 필요한 게임(피아노 등)에서 사용.
   */
  playerSound(t: number, v: Verdict, a: AudioEngine, ev?: BeatEvent): void;

  /**
   * hold 노트를 누르기 시작했을 때. 누르는 동안 이어지는 소리를 켜는 자리다.
   * 이 소리는 예약이 아니라 반응이므로 지금 시각에 바로 시작해도 된다 —
   * 박자를 알려주는 신호가 아니라 입력에 대한 피드백이기 때문이다.
   */
  holdStart?(ev: BeatEvent, t: number, v: Verdict, a: AudioEngine): void;

  /** hold 노트를 뗐을 때(또는 놓쳐서 강제 종료됐을 때). 이어지던 소리를 끈다. */
  holdEnd?(ev: BeatEvent, t: number, v: Verdict, a: AudioEngine): void;

  /**
   * 판정 없이 hold 가 끊겼을 때 — 일시정지·탭 전환.
   *
   * holdEnd 로 대신할 수 없다. 그쪽은 판정이 난 자리라 실패음을 내는 게 맞지만,
   * 여기서는 아직 아무 판정도 나지 않았다. 이걸 구현하지 않으면 누르고 있던
   * 소리가 멈춤 화면에서도, 타이틀로 나간 뒤에도 계속 울린다.
   */
  holdCancel?(ev: BeatEvent, t: number, a: AudioEngine): void;

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void;

  /**
   * 설명 화면에 뜨는 되풀이 그림. 좌표는 (0,0)~(PREVIEW_W, PREVIEW_H).
   * @param t 초. 계속 늘어나므로 주기로 나눠 쓴다.
   */
  preview(g: CanvasRenderingContext2D, t: number): void;
}

/** 4/4 기본 그루브 — 미니게임마다 조금씩 바꿔 쓴다. */
export function basicGroove(step: number, t: number, a: AudioEngine): void {
  const inBar = step % 8; // 8분음표 8개 = 한 마디

  if (inBar === 0 || inBar === 6) a.kick(t, inBar === 0 ? 1 : 0.75);
  if (inBar === 4) a.snare(t, 0.9);
  if (inBar % 2 === 1) a.hat(t, 0.7);
  else a.hat(t, 0.35);

  // 두 마디 순환 베이스 라인 (A - A - D - E 느낌)
  const BASS = [55, 0, 55, 0, 73.42, 0, 82.41, 0];
  const f = BASS[inBar];
  if (f) a.bass(t, f, 0.24, 0.9);

  // 그 위에 화음을 깐다. 베이스와 같은 진행(Am - Dm)을 두 마디에 걸쳐 도는데,
  // 마디 하나에 한 번만 울려서 타악기를 가리지 않는다.
  if (inBar === 0) {
    const bar = Math.floor(step / 8) % 2;
    a.pad(t, bar === 0 ? CHORD_AM : CHORD_DM, 1.7, 1);
  }
}

/** A minor — A3 C4 E4 */
const CHORD_AM = [220, 261.63, 329.63];
/** D minor — D4 F4 A4 */
const CHORD_DM = [293.66, 349.23, 440];
