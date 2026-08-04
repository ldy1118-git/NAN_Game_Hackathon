import type { AudioEngine } from '../core/AudioEngine';
import type { Rank } from '../core/types';

/**
 * 박자에 매이지 않는 미니게임의 계약.
 *
 * MiniGame(리듬)은 채보를 짜고 판정 창으로 등급을 매긴다. 반응속도·피하기·연타
 * 같은 건 그 틀에 억지로 끼우면 채보도 판정 창도 의미가 없어지므로 갈래를 나눴다.
 * 타이틀 메뉴·기록 저장·일시정지·음량·캐릭터는 양쪽이 그대로 공유한다.
 *
 * **여기서는 상태를 프레임마다 갱신해도 된다.** 리듬 쪽에서 그걸 금지하는 이유는
 * 소리를 미리 예약해 두기 때문인데, 자유형 게임은 예약할 채보가 없다.
 * 소리는 그때그때 `audio` 로 내면 된다.
 */
export interface FreeInput {
  /** 이번 프레임에 새로 눌린 키. 한 번 누름을 세는 데 쓴다. */
  pressed(code: string): boolean;
  /** 지금 눌려 있는 키. 계속 누르는 조작에 쓴다. */
  down(code: string): boolean;
}

/** 결과 화면에 보여줄 한 판의 요약. */
export interface FreeResult {
  /** 기록으로 남길 점수. 클수록 좋아야 한다. */
  score: number;
  rank: Rank;
  /** 등급 아래 크게 뜨는 한 줄. 예: "12마리" */
  headline: string;
  /** 아래 카드로 뜰 항목들. 3~4개가 보기 좋다. */
  rows: { label: string; value: string | number; color: string }[];
}

export interface FreeGame {
  readonly id: string;
  readonly title: string;
  /** 시작 화면에 띄울 한 줄 설명. */
  readonly hint: string;
  /** 메뉴 순서. 작을수록 위. 안 적으면 100. 리듬 게임과 같은 사다리를 쓴다. */
  readonly order?: number;
  /**
   * 이 게임이 쓰는 키 코드. 브라우저 기본 동작(스페이스 스크롤 등)을 막는 데 쓴다.
   * 생략하면 스페이스와 방향키.
   */
  readonly keys?: readonly string[];
  /** 제한 시간(초). 지나면 자동으로 끝난다. 0 이면 done 이 직접 끝을 알린다. */
  readonly duration: number;

  /** 시작 직전 한 번. 상태 초기화와 시작음. */
  start(audio: AudioEngine): void;

  /**
   * @param dt 이전 프레임과의 간격(초). 0.1 초로 잘려 들어오므로 큰 튐은 없다.
   * @param t  시작 후 지난 시간(초). 멈춰 있는 동안은 늘지 않는다.
   */
  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void;

  draw(g: CanvasRenderingContext2D, t: number): void;

  /** 제한 시간과 별개로 끝났는지. 없으면 시간만으로 끝난다. */
  readonly done?: boolean;

  result(): FreeResult;
}

/** 점수 구간으로 등급을 매기는 흔한 경우를 위한 헬퍼. */
export function rankByScore(score: number, ok: number, superb: number): Rank {
  if (score >= superb) return 'superb';
  if (score >= ok) return 'ok';
  return 'again';
}
