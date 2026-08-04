import { rankOf, type JudgeStats, type Rank } from './types';

/**
 * 미니게임별 최고 기록. 브라우저에 남는다.
 *
 * 기록이 없으면 한 번 해보고 끝나기 쉽다. "지난번보다 잘했나"를 볼 수 있어야
 * 다시 할 이유가 생긴다. 서버가 없으므로 localStorage 에 JSON 한 덩어리로 둔다.
 *
 * 이름을 GameRecord 로 둔 이유는 TypeScript 내장 유틸리티 타입 Record<K, V> 와
 * 겹치지 않게 하기 위해서다. Record 로 두면 이 파일 안의 Record<Rank, number> 가
 * 조용히 이 인터페이스를 가리킨다.
 */
export interface GameRecord {
  rank: Rank;
  /** 최고 콤보. */
  combo: number;
  perfect: number;
  good: number;
  /** 그 판의 노트 수. 채보가 바뀌면 비교 기준이 달라지므로 같이 들고 있는다. */
  total: number;
  /** 모든 노트를 완벽으로 낸 판을 한 번이라도 냈는지. */
  allPerfect: boolean;
  /** 총 플레이 횟수. */
  plays: number;
}

type Store = { [id: string]: GameRecord };

const KEY = 'nan-game.records';

/** 등급 비교용 순위. 클수록 좋다. */
const RANK_ORDER: Record<Rank, number> = { again: 0, ok: 1, superb: 2 };

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // 남이 손댔거나 형식이 바뀐 값이 들어와도 게임이 죽으면 안 된다.
    return parsed !== null && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 시크릿 모드 등. 이번 판의 결과 표시에는 영향이 없다.
  }
}

export function getRecord(id: string): GameRecord | null {
  const r = read()[id] as Partial<GameRecord> | undefined;
  // 저장된 값을 그대로 믿지 않는다 — 손으로 고쳤거나 옛 형식일 수 있다.
  if (!r || typeof r.combo !== 'number' || typeof r.total !== 'number') return null;
  if (r.rank !== 'again' && r.rank !== 'ok' && r.rank !== 'superb') return null;
  return {
    rank: r.rank,
    combo: r.combo,
    perfect: typeof r.perfect === 'number' ? r.perfect : 0,
    good: typeof r.good === 'number' ? r.good : 0,
    total: r.total,
    allPerfect: r.allPerfect === true,
    plays: typeof r.plays === 'number' ? r.plays : 1,
  };
}

export interface RecordUpdate {
  /** 갱신 전 기록. 처음이면 null. */
  previous: GameRecord | null;
  /** 이번 판으로 새로 세운 항목. */
  improved: { rank: boolean; combo: boolean; perfect: boolean };
  /** 이번 판이 올 퍼펙트였는지. */
  allPerfect: boolean;
}

/**
 * 한 판의 결과를 기록에 반영한다.
 *
 * 항목별로 따로 최고를 남긴다. 등급은 낮았지만 콤보는 최고인 판도 있으므로,
 * 한 판을 통째로 갈아끼우면 더 좋은 값이 사라진다.
 */
export function submit(id: string, stats: JudgeStats, bestCombo: number): RecordUpdate {
  const store = read();
  const prev = getRecord(id);
  const rank = rankOf(stats);
  const allPerfect = stats.total > 0 && stats.perfect === stats.total;

  const improved = {
    rank: !prev || RANK_ORDER[rank] > RANK_ORDER[prev.rank],
    combo: !prev || bestCombo > prev.combo,
    perfect: !prev || stats.perfect > prev.perfect,
  };

  store[id] = {
    rank: improved.rank ? rank : prev!.rank,
    combo: Math.max(bestCombo, prev?.combo ?? 0),
    perfect: Math.max(stats.perfect, prev?.perfect ?? 0),
    // 완벽 수가 갱신됐을 때의 좋음 수를 같이 들고 있어야 "그때 그 판"이 재현된다.
    good: improved.perfect ? stats.good : (prev?.good ?? stats.good),
    total: stats.total,
    allPerfect: allPerfect || (prev?.allPerfect ?? false),
    plays: (prev?.plays ?? 0) + 1,
  };
  write(store);

  return { previous: prev, improved, allPerfect };
}

/** 개발 중 초기화용. 콘솔에서 `__nan.records.clear()` 로 부른다. */
export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 무시
  }
}
