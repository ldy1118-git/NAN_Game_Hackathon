import type { MiniGame } from './MiniGame';

export interface MiniGameEntry {
  id: string;
  title: string;
  hint: string;
  create: () => MiniGame;
}

type MiniGameClass = new () => MiniGame;

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
  ['./*.ts', '!./index.ts', '!./MiniGame.ts'],
  { eager: true },
);

/**
 * MiniGame 을 구현한 클래스인지 판별한다.
 *
 * 인터페이스는 런타임에 사라지므로 instanceof 로는 못 가른다. 대신 프로토타입에
 * 필수 메서드가 있는지 본다 — beat.ts / character.ts 같은 헬퍼 모듈은
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

function collect(): MiniGameEntry[] {
  const found: { entry: MiniGameEntry; order: number }[] = [];

  for (const mod of Object.values(modules)) {
    for (const exported of Object.values(mod)) {
      if (!isMiniGameClass(exported)) continue;
      // id·title·hint 를 읽으려면 한 번 만들어봐야 한다. 생성자는 채보를 짜는 정도라 가볍다.
      const probe = new exported();
      found.push({
        order: probe.order ?? 100,
        entry: {
          id: probe.id,
          title: probe.title,
          hint: probe.hint,
          create: () => new exported(),
        },
      });
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
