export type Verdict = 'perfect' | 'good' | 'miss';

/** 게임이 스스로 연주하는 신호(cue)냐, 플레이어가 쳐야 하는 것(hit)이냐. */
export type EventKind = 'cue' | 'hit';

export interface BeatEvent {
  /** 이 이벤트가 일어나는 박. 모든 위치·애니메이션이 여기서 파생된다. */
  beat: number;
  kind: EventKind;
  /** 미니게임이 자유롭게 쓰는 필드 (음정, 공 종류, 연결된 cue 박 등). */
  data?: Record<string, number | string | boolean>;

  // --- 런타임 상태. 미니게임이 아니라 Runner 가 채운다. ---
  /** 오디오 예약을 이미 걸었는지. */
  scheduled?: boolean;
  /** 판정 결과. null 이면 아직 미판정. */
  verdict?: Verdict;
  /** 실제로 눌린 박. 판정 오차를 그릴 때 쓴다. */
  pressedBeat?: number;
}

/** 판정 창(박 단위가 아니라 ms — BPM 이 바뀌어도 체감 난이도가 같도록). */
export const WINDOW_MS = {
  perfect: 52,
  good: 112,
  /** 이 시간이 지나도 안 누르면 놓친 것으로 확정. */
  expire: 150,
} as const;

export interface JudgeStats {
  perfect: number;
  good: number;
  miss: number;
  /** 노트가 없는데 눌러버린 횟수. */
  whiff: number;
  total: number;
}

export function emptyStats(total: number): JudgeStats {
  return { perfect: 0, good: 0, miss: 0, whiff: 0, total };
}

/** 리듬천국식 3단 등급. */
export type Rank = 'again' | 'ok' | 'superb';

export function rankOf(s: JudgeStats): Rank {
  if (s.total === 0) return 'ok';
  const score = (s.perfect + s.good * 0.5) / s.total;
  const sloppy = s.miss + s.whiff;
  if (score >= 0.92 && sloppy <= 1) return 'superb';
  if (score >= 0.6 && sloppy <= Math.max(2, s.total * 0.25)) return 'ok';
  return 'again';
}

export const RANK_LABEL: Record<Rank, string> = {
  again: '처음부터',
  ok: '그럭저럭',
  superb: '완벽!',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  perfect: '완벽',
  good: '좋음',
  miss: '놓침',
};
