import type { Difficulty } from '../core/difficulty';
import type { MiniGame } from './MiniGame';
import type { FreeGame } from './FreeGame';

/**
 * 메뉴에 뜨는 게임 하나.
 *
 * `kind` 로 두 갈래를 가른다 — 'rhythm' 은 채보와 판정 창을 쓰고,
 * 'free' 는 박자에 매이지 않는다. 씬이 갈리므로 어느 쪽인지 알아야 한다.
 *
 * `create` 가 (difficulty, seed) 를 받는다는 점이 중요하다. 목록은 게임 열 개지만
 * 실제로 만들 수 있는 판은 난이도 셋 × 씨앗 무한이다.
 */
export type MiniGameEntry =
  | {
      kind: 'rhythm';
      id: string;
      title: string;
      hint: string;
      create: (difficulty: Difficulty, seed: number) => MiniGame;
    }
  | {
      kind: 'free';
      id: string;
      title: string;
      hint: string;
      create: (difficulty: Difficulty, seed: number) => FreeGame;
    };

type MiniGameClass = new (difficulty: Difficulty, seed: number) => MiniGame;
type FreeGameClass = new (difficulty: Difficulty, seed: number) => FreeGame;

/**
 * 미니게임 등록소 — 폴더를 훑어 자동으로 모은다.
 *
 * 예전에는 여기에 게임 목록을 손으로 적었는데, 셋이 각자 게임을 추가하면
 * 이 배열 한 곳에서 매번 충돌했다. 이제 `minigames/` 에 파일만 만들면 끝이고
 * 공용 파일을 건드릴 일이 없다.
 *
 * 새 게임을 추가하려면: MiniGame 을 구현한 클래스를 export 하는 파일을
 * 이 폴더에 만들면 된다. 그게 전부다.
 */
const modules = import.meta.glob<Record<string, unknown>>(
  ['./*.ts', '!./index.ts', '!./MiniGame.ts', '!./FreeGame.ts', '!./howto.ts'],
  { eager: true },
);

/**
 * MiniGame 을 구현한 클래스인지 판별한다.
 *
 * 인터페이스는 런타임에 사라지므로 instanceof 로는 못 가른다. 대신 프로토타입에
 * 필수 메서드가 있는지 본다 — beat.ts / cast.ts 같은 헬퍼 모듈은
 * 함수만 export 하므로 여기서 걸러진다.
 */
function isMiniGameClass(value: unknown): value is MiniGameClass {
  if (typeof value !== 'function') return false;
  const proto = (value as MiniGameClass).prototype as Partial<MiniGame> | undefined;
  return (
    !!proto &&
    typeof proto.build === 'function' &&
    typeof proto.draw === 'function' &&
    typeof proto.groove === 'function'
  );
}

/** FreeGame 쪽. 판별 기준은 start/update/result — 리듬 쪽에는 없는 조합이다. */
function isFreeGameClass(value: unknown): value is FreeGameClass {
  if (typeof value !== 'function') return false;
  const proto = (value as FreeGameClass).prototype as Partial<FreeGame> | undefined;
  return (
    !!proto &&
    typeof proto.start === 'function' &&
    typeof proto.update === 'function' &&
    typeof proto.result === 'function' &&
    typeof proto.draw === 'function'
  );
}

/** 목록을 읽기 위한 한 번짜리 인스턴스. 난이도·씨앗은 아무 값이어도 된다. */
const PROBE_DIFFICULTY: Difficulty = 'easy';
const PROBE_SEED = 1;

function collect(): MiniGameEntry[] {
  const found: { entry: MiniGameEntry; order: number }[] = [];

  for (const mod of Object.values(modules)) {
    for (const exported of Object.values(mod)) {
      // id·title·hint 를 읽으려면 한 번 만들어봐야 한다. 생성자는 가볍다.
      if (isMiniGameClass(exported)) {
        const probe = new exported(PROBE_DIFFICULTY, PROBE_SEED);
        found.push({
          order: probe.order ?? 100,
          entry: {
            kind: 'rhythm',
            id: probe.id,
            title: probe.title,
            hint: probe.hint,
            create: (difficulty, seed) => new exported(difficulty, seed),
          },
        });
      } else if (isFreeGameClass(exported)) {
        const probe = new exported(PROBE_DIFFICULTY, PROBE_SEED);
        found.push({
          order: probe.order ?? 100,
          entry: {
            kind: 'free',
            id: probe.id,
            title: probe.title,
            hint: probe.hint,
            create: (difficulty, seed) => new exported(difficulty, seed),
          },
        });
      }
    }
  }

  // order 가 같으면 id 순 — 파일 시스템 순서에 따라 메뉴가 흔들리지 않게.
  found.sort((a, b) => a.order - b.order || a.entry.id.localeCompare(b.entry.id));

  if (import.meta.env.DEV) {
    const seen = new Set<string>();
    for (const { entry } of found) {
      if (seen.has(entry.id)) {
        console.warn(`[minigames] id 가 겹칩니다: "${entry.id}" — 한쪽을 바꿔주세요`);
      }
      seen.add(entry.id);
    }
    if (found.length === 0) {
      console.warn('[minigames] 등록된 미니게임이 없습니다');
    }
  }

  return found.map((f) => f.entry);
}

export const MINIGAMES: MiniGameEntry[] = collect();
