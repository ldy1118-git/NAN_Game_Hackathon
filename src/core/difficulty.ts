import { getRecord } from './records';

/**
 * 난이도 — 게임 하나를 셋으로 나눈다.
 *
 * 게임을 열 개 늘리는 것보다 있는 게임의 난이도를 나누는 편이 낫다. 조작을 이미
 * 아는 상태에서 "조금만 더"를 시도하게 되고, 어디까지 갔는지가 기록으로 남는다.
 *
 * 셋 다 처음부터 고를 수 있다. 잠가 두면 이미 잘하는 사람이 쉬운 걸 억지로
 * 한 판 하고 와야 하고, 어려운 걸 먼저 구경해 보는 재미도 사라진다.
 *
 * 미니게임은 `difficulty` 를 생성자로 받아 스스로 조임새를 정한다. 무엇을 조일지는
 * 게임마다 다르므로(속도·개수·판정 창·패턴 밀도) 여기서 강제하지 않는다.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
};

/** 난이도 카드에 붙는 한 줄. 무엇이 달라지는지 미리 알려준다. */
export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  easy: '느긋하게 조작을 익히는 단계',
  normal: '기본 속도 — 여기서부터 진짜',
  hard: '쉴 틈 없이 몰아칩니다',
};

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: '#4ED6A9',
  normal: '#3DA9FC',
  hard: '#FF5D7E',
};

/**
 * 기록 저장 키.
 *
 * 난이도마다 따로 남긴다. 한 칸에 몰아넣으면 어려움을 한 번 해보고 망친 판이
 * 쉬움의 좋은 기록을 덮어쓴다.
 */
export function recordKey(id: string, d: Difficulty): string {
  return `${id}#${d}`;
}

/** 그 난이도를 깬 적이 있는가. '그럭저럭' 이상이면 깬 것으로 본다. */
export function isCleared(id: string, d: Difficulty): boolean {
  const r = getRecord(recordKey(id, d));
  return r !== null && r.rank !== 'again';
}

/** 이 게임에서 깬 난이도 수(0~3). 목록의 진행도 표시에 쓴다. */
export function clearedCount(id: string): number {
  return DIFFICULTIES.filter((d) => isCleared(id, d)).length;
}

/**
 * 처음 커서를 놓을 자리 — 아직 못 깬 가장 쉬운 난이도.
 *
 * 잠금이 없으므로 "열린 것 중 가장 높은 것"이 아니라 "다음에 해볼 만한 것"을
 * 고른다. 다 깼으면 어려움에 둔다.
 */
export function suggested(id: string): Difficulty {
  return DIFFICULTIES.find((d) => !isCleared(id, d)) ?? 'hard';
}
