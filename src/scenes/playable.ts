import type { Scene } from '../core/App';
import type { Difficulty } from '../core/difficulty';
import type { MiniGameEntry } from '../minigames';
import { HowToScene } from './HowToScene';
import { MedleyScene } from './MedleyScene';

/**
 * 난이도 화면이 다룰 수 있는 것.
 *
 * 목록에는 미니게임 열 개와 종합게임 하나가 섞여 있는데, 난이도를 고르는 화면은
 * 둘을 구별할 필요가 없다 — "이름과 설명이 있고, 난이도를 고르면 어딘가로 간다"가
 * 전부다. 그 최소한만 여기에 적어 두면 화면을 한 벌로 돌릴 수 있다.
 */
export interface Playable {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  /** 기록 숫자 뒤에 붙일 단위. 리듬은 '콤보', 나머지는 '점'. */
  readonly unit: string;
  /** 난이도를 골랐을 때 갈 곳. */
  begin(difficulty: Difficulty, seed: number): Scene;
}

/** 미니게임 하나 — 난이도를 고르면 설명 화면으로 간다. */
export function fromEntry(entry: MiniGameEntry): Playable {
  return {
    id: entry.id,
    title: entry.title,
    hint: entry.hint,
    unit: entry.kind === 'rhythm' ? '콤보' : '점',
    begin: (difficulty, seed) => new HowToScene(entry, difficulty, seed),
  };
}

/** 모든 미니게임을 이어서 하는 도전 모드. 목록 맨 위에 고정으로 붙는다. */
export const MEDLEY_ID = 'medley';

export const MEDLEY: Playable = {
  id: MEDLEY_ID,
  title: '도전! CHALLENGE',
  hint: '모든 미니게임을 순서 없이 이어서 — 한 번에 끝까지',
  unit: '점',
  begin: (difficulty, seed) => new MedleyScene(difficulty, seed),
};
