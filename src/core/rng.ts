/**
 * 씨앗 있는 난수.
 *
 * 미니게임은 `Math.random` 을 직접 쓰지 않는다. 두 가지를 동시에 원하기 때문이다.
 *
 *   1. 한 판 안에서는 재현 가능해야 한다. draw() 가 박(또는 t)의 순수 함수라는
 *      규칙을 지키려면, 같은 순간을 두 번 그려도 같은 그림이 나와야 한다.
 *   2. 판이 바뀌면 패턴이 달라져야 한다. 늘 같은 채보면 외워서 치게 되고,
 *      그건 실력이 아니라 암기다.
 *
 * 그래서 "씨앗은 판마다 새로, 씨앗이 같으면 결과도 같게"로 나눈다.
 * 씨앗은 씬이 만들어 게임 생성자에 넘긴다.
 */

export type Rng = () => number;

/** 0 이상 1 미만. 같은 씨앗이면 언제나 같은 수열. */
export function makeRng(seed: number): Rng {
  // 0 은 이 선형 합동 생성기에서 빠져나오지 못하는 값이라 피한다.
  let s = (Math.floor(Math.abs(seed)) ^ 0x5f3a7c) & 0x7fffffff;
  if (s === 0) s = 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** lo 이상 hi 미만의 실수. */
export function range(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** lo 이상 hi 이하의 정수. */
export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** 배열에서 하나. 빈 배열은 부르는 쪽 잘못이라 막지 않는다. */
export function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

/** 제자리 섞기(Fisher-Yates). 새 배열을 돌려준다. */
export function shuffled<T>(rng: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 새 판을 위한 씨앗.
 *
 * 이 값만 게임 밖(씬)에서 만든다. 게임 안에서 부르면 draw() 가 순수 함수가
 * 아니게 되고, 같은 프레임을 두 번 그릴 때 그림이 달라진다.
 */
export function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
}
