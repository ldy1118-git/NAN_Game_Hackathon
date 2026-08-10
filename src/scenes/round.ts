import type { Difficulty } from '../core/difficulty';
import { makeRng, shuffled } from '../core/rng';
import type { Rank } from '../core/types';
import type { MiniGameEntry } from '../minigames';

/** 한 판의 결과. 종합게임이 판마다 모아 둔다. */
export interface RoundResult {
  entry: MiniGameEntry;
  rank: Rank;
  /** 결과 화면에 쓸 한 줄. */
  headline: string;
  /** 리듬이면 최고 콤보, 자유형이면 점수. */
  value: number;
}

/**
 * 한 판을 누가 감싸고 있는가.
 *
 * `PlayScene` / `FreePlayScene` 은 원래 판이 끝나면 곧바로 결과 화면으로 갔다.
 * 종합게임은 열 판을 이어 붙여야 하므로 그 자리를 가로챌 사람이 필요하다.
 *
 * host 가 없으면 예전 그대로 — 혼자 한 판 하고 결과 화면으로 간다.
 * 씬을 두 벌 만들지 않으려고 갈림길을 이 인터페이스 하나로 좁혔다.
 */
export interface RoundHost {
  /** 화면 왼쪽 위 제목 옆에 붙는 표시. 예: '종합 3 / 7' */
  readonly label: string;
  /** 이 판이 끝났다. */
  done(r: RoundResult): void;
  /** 플레이어가 그만두려 한다(멈춤 화면에서 Esc). */
  quit(): void;
}

/**
 * 종합게임에서 난이도별로 몇 판을 이어 할지.
 *
 * 어려움은 있는 게임 전부다 — "종합"이라는 이름값을 하려면 하나도 빠지면 안 된다.
 * 쉬움·보통은 한 번에 앉아서 끝낼 만한 길이로 줄인다.
 */
export const MEDLEY_COUNT: Record<Difficulty, number> = {
  easy: 5,
  normal: 7,
  hard: Infinity,
};

/**
 * 이번 판에 할 게임들.
 *
 * 순서를 섞는 이유는 두 가지다 — 매번 같은 차례면 외워지고, 마지막에 어려운 게
 * 고정되면 그것만 연습하게 된다. 목록을 인자로 받는 건 순전히 시험을 위해서다.
 * `MINIGAMES` 를 직접 읽으면 브라우저 밖에서 부를 수 없다.
 */
export function medleyRoster<T>(
  all: readonly T[],
  difficulty: Difficulty,
  seed: number,
): T[] {
  const n = Math.min(MEDLEY_COUNT[difficulty], all.length);
  return shuffled(makeRng(seed), all).slice(0, n);
}
