import type { AudioEngine } from '../core/AudioEngine';
import type { BeatEvent, JudgeStats, Verdict } from '../core/types';
import type { LastJudge } from '../core/Runner';

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
 */
export interface MiniGame {
  readonly id: string;
  readonly title: string;
  /** 시작 화면에 띄울 한 줄 설명. */
  readonly hint: string;
  readonly bpm: number;
  /** 이 박을 넘기면 결과 화면으로. */
  readonly endBeat: number;

  /** 채보. Runner 가 시작할 때 한 번 호출한다. */
  build(): BeatEvent[];

  /** 반주. step 은 8분음표 인덱스, t 는 예약할 ctx 시각. */
  groove(step: number, t: number, a: AudioEngine): void;

  /** cue 이벤트(게임이 들려주는 신호)의 소리를 예약. */
  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void;

  /** 플레이어가 눌렀을 때 나는 소리. */
  playerSound(t: number, v: Verdict, a: AudioEngine): void;

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void;
}

/** 4/4 기본 그루브 — 미니게임마다 조금씩 바꿔 쓴다. */
export function basicGroove(step: number, t: number, a: AudioEngine): void {
  const inBar = step % 8; // 8분음표 8개 = 한 마디

  if (inBar === 0 || inBar === 6) a.kick(t, inBar === 0 ? 1 : 0.75);
  if (inBar === 4) a.snare(t, 0.9);
  if (inBar % 2 === 1) a.hat(t, 0.7);
  else a.hat(t, 0.35);

  // 두 마디 순환 베이스 라인 (A - A - F - G 느낌)
  const BASS = [55, 0, 55, 0, 73.42, 0, 82.41, 0];
  const f = BASS[inBar];
  if (f) a.bass(t, f, 0.24, 0.9);
}
