/**
 * 문서용 스크린샷 · og 이미지 캡처 하네스.
 *
 * 실제 `App` 과 실제 씬을 그대로 돌려서 찍는다. 그림을 따로 그려 흉내내면
 * 게임이 바뀔 때마다 문서가 조용히 낡으므로, 화면은 언제나 게임에서 뽑는다.
 *
 *   node tools/shot-server.mjs docs/shots 7788
 *   npm run dev
 *   google-chrome --headless ... http://localhost:5173/shots.html
 *
 * 개발 도구라 배포에는 들어가지 않는다 (index.html 에서 참조하지 않는다).
 */
import { App } from './core/App';
import { CastScene } from './scenes/CastScene';
import { TitleScene } from './scenes/TitleScene';
import { DifficultyScene } from './scenes/DifficultyScene';
import { HowToScene } from './scenes/HowToScene';
import { MedleyScene } from './scenes/MedleyScene';
import { PlayScene } from './scenes/PlayScene';
import { FreePlayScene } from './scenes/FreePlayScene';
import { fromEntry } from './scenes/playable';
import { MINIGAMES, type MiniGameEntry } from './minigames';
import { CAST, CAST_H, drawCharacter } from './minigames/cast';
import { drawLogo } from './core/logo';
import { C, circle, text } from './core/draw';
import type { Difficulty } from './core/difficulty';

const COLLECT = 'http://localhost:7788/shot';

/**
 * 촬영에 쓰는 난이도와 씨앗.
 *
 * 난이도가 생기면서 같은 게임도 화면이 달라진다. 문서에는 기본값인 '보통'을
 * 싣는다. 씨앗을 고정하는 건 다시 찍었을 때 같은 그림이 나오게 하려는 것 —
 * 채보가 씨앗에서 생성되므로 이걸 박아두지 않으면 문서가 매번 달라진다.
 */
const D: Difficulty = 'normal';
const SEED = 20260810;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const app = new App(canvas);

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function waitSec(sec: number): Promise<void> {
  const t0 = performance.now();
  while (performance.now() - t0 < sec * 1000) await raf();
}

async function send(name: string, dataUrl: string): Promise<void> {
  await fetch(COLLECT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, png: dataUrl }),
  });
  console.log('찍음:', name);
}

async function shoot(name: string): Promise<void> {
  await raf(); // 마지막 draw 가 캔버스에 올라온 뒤에 뜬다
  await send(name, canvas.toDataURL('image/png'));
}

function entryOf(id: string): MiniGameEntry {
  const e = MINIGAMES.find((m) => m.id === id);
  if (!e) throw new Error(`미니게임을 찾을 수 없습니다: ${id}`);
  return e;
}

/** 키를 실제 이벤트로 눌러준다. Input 이 window 에서 받으므로 이걸로 충분하다. */
function down(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}
function up(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}
function tap(code: string, ms = 60): void {
  down(code);
  setTimeout(() => up(code), ms);
}

/**
 * 리듬 게임을 자동으로 쳐 주면서 목표 박까지 진행한다.
 *
 * 아무도 치지 않으면 화면에 "놓침"만 남아 문서용으로 못 쓴다. 채보는 씨앗이
 * 같으면 결정론적이므로, 같은 (난이도, 씨앗) 으로 한 벌 미리 뽑아두고 박이 올
 * 때마다 키를 눌러 준다. rAF 간격(약 16ms)은 완벽 판정 창(±52ms) 안에 들어간다.
 */
async function playRhythm(id: string, ratio = 0.55): Promise<void> {
  const entry = entryOf(id);
  if (entry.kind !== 'rhythm') throw new Error(`${id} 는 리듬 게임이 아닙니다`);

  // 촬영용 사본 — 실제 판에 넘기는 인스턴스와 분리한다. 씨앗이 같으므로 채보는 같다.
  const probe = entry.create(D, SEED);
  const chart = probe.build().filter((e) => e.kind === 'hit' || e.kind === 'hold');
  const untilBeat = Math.max(10, probe.endBeat * ratio);

  app.setScene(new PlayScene(entry, D, SEED));

  let next = 0;
  const holding: { code: string; endBeat: number }[] = [];

  while (app.conductor.beat < untilBeat) {
    const beat = app.conductor.beat;

    while (next < chart.length && chart[next]!.beat <= beat) {
      const ev = chart[next++]!;
      const code = typeof ev.data?.key === 'string' ? ev.data.key : 'Space';
      down(code);
      if (ev.kind === 'hold' && ev.endBeat != null) holding.push({ code, endBeat: ev.endBeat });
      else setTimeout(() => up(code), 40);
    }

    for (let i = holding.length - 1; i >= 0; i--) {
      if (beat >= holding[i]!.endBeat) {
        up(holding[i]!.code);
        holding.splice(i, 1);
      }
    }

    await raf();
  }

  for (const h of holding) up(h.code);
}

/** 자유형 게임 하나를 띄운다. */
function startFree(id: string): void {
  app.setScene(new FreePlayScene(entryOf(id), D, SEED));
}

// ─────────────────────────────────────────────────────────── og 이미지

/**
 * 카톡·디스코드 링크 카드에 뜨는 1200x630 이미지.
 *
 * 글자를 여기서 따로 조판하지 않고 `drawLogo` 를 부른다. 부팅·소개·타이틀이
 * 쓰는 것과 같은 로고라 이름이 또 바뀌어도 여기만 낡는 일이 없다.
 */
async function shootOg(): Promise<void> {
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);

  // 배경 원 두 개 — 기존 og 의 구도를 유지한다.
  g.fillStyle = '#E7EDEA';
  circle(g, 40, 60, 220);
  g.fill();
  g.fillStyle = '#FADFDF';
  circle(g, 1150, 620, 260);
  g.fill();

  drawLogo(g, W / 2, 170, 104);
  text(g, '박자와 순발력에 맞춰 누르는 종합게임', W / 2, 272, {
    size: 34,
    color: C.inkSoft,
    weight: 700,
  });

  // 여섯이 나란히. 자세를 조금씩 달리 줘서 한 줄이 심심하지 않게 한다.
  const POSE = [
    { hop: 0, armL: 0, armR: 0, blink: 0, sing: 0.15 },
    { hop: 16, armL: -1, armR: -1, blink: 0, sing: 0.7 },
    { hop: 0, armL: 1, armR: 1, blink: 0.9, sing: 0 },
    { hop: 8, armL: -1, armR: 0, blink: 0, sing: 0.4 },
    { hop: 0, armL: 1, armR: 1, blink: 0, sing: 0.2 },
    { hop: 20, armL: -1, armR: -1, blink: 0, sing: 0.8 },
  ];
  const h = CAST_H * 1.5;
  const gap = 168;
  const x0 = W / 2 - (gap * (CAST.length - 1)) / 2;

  CAST.forEach((id, i) => {
    drawCharacter(g, {
      id,
      x: x0 + gap * i,
      y: 588,
      h,
      look: i < 3 ? 0.2 : -0.2,
      ...POSE[i],
    });
  });

  await send('og', c.toDataURL('image/png'));
}

// ─────────────────────────────────────────────────────────── 촬영 목록

async function run(): Promise<void> {
  app.start();
  await waitSec(0.6); // 오디오 클럭이 돌기 시작할 시간

  // 캐릭터 소개 — 여섯이 하나씩 등장하므로 다 나올 때까지 기다린다
  app.setScene(new CastScene());
  await waitSec(4.6);
  await shoot('cast');

  // 타이틀 메뉴 — 맨 위가 도전! CHALLENGE
  app.setScene(new TitleScene());
  await waitSec(1.2);
  await shoot('title');

  // 난이도 고르기 · 시작 전 설명 — 이번에 새로 생긴 두 화면
  app.setScene(new DifficultyScene(fromEntry(entryOf('clapbot'))));
  await waitSec(1.2);
  await shoot('difficulty');

  app.setScene(new HowToScene(entryOf('molewhack'), D, SEED));
  await waitSec(1.6);
  await shoot('howto');

  // 도전 모드 — 판 사이 소개 카드가 떠 있는 동안
  app.setScene(new MedleyScene(D, SEED));
  await waitSec(1.4);
  await shoot('medley');

  // 리듬형 다섯 — 자동으로 쳐 주면서 중반에 찍는다
  for (const id of ['clapbot', 'rallyball', 'archery', 'jumprope', 'piano-repeat']) {
    await playRhythm(id);
    await shoot(id);
  }

  // 자유형 다섯 — 몇 개는 눌러줘야 그림이 산다.
  // 두더지는 어느 구멍이 열렸는지 밖에서 알 수 없으니 여섯 자리를 돌아가며 두드린다.
  startFree('molewhack');
  const HOLES = ['KeyQ', 'KeyW', 'KeyE', 'KeyI', 'KeyO', 'KeyP'];
  for (let i = 0; i < 40; i++) {
    tap(HOLES[i % HOLES.length]!, 40);
    await waitSec(0.14);
  }
  await shoot('molewhack');

  // 피하기 — 좌우로 움직이며 가끔 점프. 장애물이 떠 있는 그림이면 된다.
  startFree('dodgerain');
  for (let i = 0; i < 14; i++) {
    tap(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight', 90);
    if (i % 5 === 4) tap('Space', 60);
    await waitSec(0.34);
  }
  await shoot('dodgerain');

  startFree('tugrace');
  for (let i = 0; i < 22; i++) {
    tap('Space', 40);
    await waitSec(0.13);
  }
  await shoot('tugrace');

  // 풍선은 누르고 있어야 부푼다. 터지기 전에 떼고 찍는다.
  startFree('balloon');
  await waitSec(0.8);
  down('Space');
  await waitSec(1.5);
  up('Space');
  await waitSec(0.2);
  await shoot('balloon');

  startFree('quickrps');
  await waitSec(2.4);
  await shoot('quickrps');

  await shootOg();

  console.log('전부 완료');
  document.title = 'SHOTS-DONE';
}

run().catch((err) => {
  console.error('촬영 실패:', err);
  document.title = 'SHOTS-FAIL';
});
