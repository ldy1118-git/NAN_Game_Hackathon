/**
 * 이미지 에셋 로더.
 *
 * 이 프로젝트는 원래 에셋이 하나도 없었다(소리도 합성음). 캐릭터 그림이 들어오면서
 * 처음 생긴 로딩 계층이라, 규칙은 하나만 지킨다 — **그리기 직전에 로드하지 않는다.**
 * 첫 프레임에 그림이 없으면 캐릭터가 한 박 늦게 튀어나오고, 그건 리듬게임에서
 * 제일 하면 안 되는 종류의 어긋남이다. 전부 BootScene 에서 미리 받아둔다.
 */
const cache = new Map<string, HTMLImageElement>();

/** base 가 './' 라 파일로 열어도 돌아가도록 BASE_URL 을 붙인다. */
function urlFor(name: string): string {
  return `${import.meta.env.BASE_URL}characters/${name}.png`;
}

function loadOne(name: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      cache.set(name, img);
      resolve();
    };
    img.onerror = () => {
      // 한 장 없다고 게임이 멈추진 않는다 — 그 캐릭터만 안 그려진다.
      console.warn(`[sprites] 불러오지 못했습니다: ${urlFor(name)}`);
      resolve();
    };
    img.src = urlFor(name);
  });
}

/** 전부 받을 때까지 기다린다. 실패한 것이 있어도 reject 하지 않는다. */
export function preload(names: readonly string[]): Promise<void> {
  return Promise.all(names.map(loadOne)).then(() => undefined);
}

/** 로드되지 않았으면 null. 호출부는 반드시 null 을 확인한다. */
export function sprite(name: string): HTMLImageElement | null {
  return cache.get(name) ?? null;
}
