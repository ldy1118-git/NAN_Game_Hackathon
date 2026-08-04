# NAN GAME

리듬천국(Rhythm Heaven)식 콜 앤 리스폰스 리듬 미니게임. TypeScript + Canvas 2D, 엔진·에셋 없음.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 타입체크 + dist/ 생성 (base './' 라 파일 열기로도 실행됨)
```

같이 개발한다면 [CONTRIBUTING.md](./CONTRIBUTING.md)의 브랜치·충돌 규칙을 먼저 읽자.

## 지금 들어있는 것

| 미니게임 | 내용 |
| --- | --- |
| 따라 치기 | 로봇이 4박 손뼉 패턴을 들려주면 다음 4박에 그대로 따라 친다 |
| 튕겨내기 | 날아오는 공을 라켓에 닿는 순간 받아친다. 공은 2박(파랑)과 1박(분홍) 두 속도 |
| 줄넘기 | 돌아가는 줄이 발밑에 오는 순간 넘는다. 2박에서 시작해 1박 연속 구간까지 |
| 충전하기 | 누르고 있다가 게이지가 목표선에 닿는 순간 뗀다. 로봇 키가 곧 충전 시간(1·2·3박) |
| 6인 합창 | 위 합창단이 낸 소리를 아래 합창단으로 그대로 되돌려준다. Q W E · I O P |
| 타이밍 맞추기 | 입력 지연 측정 및 보정 |

조작은 기본적으로 스페이스(또는 화면 클릭) 하나. 플레이 중 Esc로 일시정지,
멈춘 상태에서 스페이스로 이어서 하거나 Esc로 나간다.
6인 합창처럼 여러 키를 쓰는 게임도 만들 수 있다 — 아래 "미니게임 추가하기" 참고.

## "딱딱 맞는" 느낌을 만드는 세 가지

리듬게임에서 소리와 그림이 어긋나 보이는 원인은 거의 항상 아래 셋 중 하나다.

**1. 시간의 출처를 하나로 묶는다 — `src/core/Conductor.ts`**

`requestAnimationFrame`의 델타를 누적하면 프레임이 한 번 밀릴 때마다 오차가 영구히
쌓인다. 이 프로젝트에서 시간의 유일한 출처는 `AudioContext.currentTime`이고,
화면에 그려지는 모든 값은 매 프레임 거기서 새로 계산된다.

시간 축이 셋이라 헷갈리기 쉬운데:

- `ctx.currentTime` — 오디오를 예약할 때 쓰는 시각. 여기 예약한 소리는 실제로는
  `outputLatency`만큼 뒤에 스피커에서 난다.
- `audibleTime` = `ctx.currentTime - outputLatency` — 지금 귀에 들리고 있는 소리의 시각.
  **화면과 판정은 반드시 이 축을 쓴다.**
- `inputOffset` — 키보드·OS·모니터가 먹는 지연. 환경마다 20~80ms씩 다르고 이건
  판정 등급이 통째로 갈리는 크기라, 캘리브레이션으로 재서 판정에서 빼준다.

**2. 소리는 반드시 미리 예약한다 — `src/core/AudioEngine.ts`, `src/core/Runner.ts`**

"지금 재생"하는 API는 일부러 만들지 않았다. `Runner`가 180ms 앞까지의 이벤트를
`ctx` 시각으로 미리 예약해두므로, 프레임이 튀어도 소리는 샘플 단위로 정확히 난다.
소리는 mp3가 아니라 오실레이터·노이즈로 직접 합성한다 — 파일마다 다른 무음 구간이나
디코딩 지연 없이 예약한 시각에 정확히 울린다.

**3. 그림은 상태가 아니라 박의 함수로 그린다 — `src/minigames/*`**

각 미니게임의 `draw()`는 오직 `beat`만 보고 그림을 결정한다. 위치나 속도를 내부
상태로 들고 프레임마다 적분하면 한 번만 밀려도 영구히 어긋나지만, 함수로 그리면
언제나 다시 맞는다. 그래서 튕겨내기의 공은 프레임이 얼마나 튀든 정확히 정박에
라켓에 닿는다.

여기에 화면 전체가 정박에 1% 부풀고(`PlayScene`), 마디 첫 박에 배경이 한 번
밝아지고(`stage.ts`), 캐릭터가 타점 직전에 예비동작을 하는(`handOpen`) 연출이
얹힌다. 개별로는 사소하지만 이게 "딱딱 맞아 보인다"의 실체다.

## 루프가 멈췄다 돌아올 때

탭을 옮기면 `requestAnimationFrame` 은 멈추지만 `AudioContext.currentTime` 은 계속
흐른다. 아무 대비가 없으면 돌아온 순간 두 가지가 한꺼번에 터진다 — 스케줄러가
밀린 구간을 한 프레임에 따라잡으며 **과거 시각으로 수십 개의 소리를 예약**하고
(Web Audio 는 과거를 "즉시"로 처리한다), 그동안의 노트가 **전부 놓침으로 확정**된다.
8초만 자리를 비워도 소리 78개 중 76개가 과거 시각이었고 노트 7개가 날아갔다.

세 겹으로 막는다.

| 층 | 하는 일 |
| --- | --- |
| `AudioEngine.stale()` | 과거 시각 예약을 버린다. 모든 소리가 여기를 지나므로 새 미니게임이 생겨도 다시 뚫리지 않는다 |
| `App` 의 멈춤 감지 | 간격이 250ms를 넘으면 씬에 알린다. `visibilitychange` 는 탭 전환만 잡고 창 가림·절전·긴 GC는 못 잡아서, 간격 자체를 신호로 쓴다 |
| `Conductor.pause(rewindSec)` | 멈춘 걸 알아챈 시점에서 되감아 멈춘다. 플레이어가 실제로 있던 자리로 돌려놔야 재개 직후 몰살당하지 않는다 |

멈춤 감지의 간격은 `rAF` 가 주는 시각이 아니라 **오디오 클럭으로 잰다.** rAF 의
시각은 그 프레임의 vsync 시각이라 복귀 직후 한 번은 멈추기 전 값이 그대로 올 수
있고, 실제로 그 한 프레임이 새서 노트 7개가 놓침으로 확정되는 걸 확인했다.
시간의 출처를 오디오 클럭 하나로 묶는다는 원칙이 여기에도 그대로 적용된다.

게임 쪽에서 따로 할 일은 없다. `draw()` 가 `beat` 의 순수 함수이기만 하면
멈춰 있는 동안 `beat` 가 고정되므로 화면도 알아서 얼어붙는다.

## 구조

```
src/
  core/
    Conductor.ts    시간 기준점. 박 ↔ 오디오 시각 변환
    AudioEngine.ts  Web Audio 합성음 (킥/스네어/하이햇/손뼉/블립/베이스)
    Input.ts        키 눌린 "오디오 시각"을 정확히 잡아냄
    Runner.ts       채보 진행 · 오디오 예약 · 판정
    App.ts          캔버스·씬 관리·루프
    draw.ts         논리 해상도(960x540), 색, beatPulse 같은 이징
    types.ts        판정 창, 등급 산정
  minigames/
    MiniGame.ts     미니게임이 지켜야 할 계약
    ClapBot.ts      따라 치기
    RallyBall.ts    튕겨내기
    JumpRope.ts     줄넘기
    ChargeBot.ts    충전하기 (hold 노트 예제)
    beat.ts         공통 박자 유틸 (감쇠·예비동작·이벤트 조회)
    character.ts    캐릭터·손·충격파 그리기
    stage.ts        바닥·박자 점·배경 플래시
    index.ts        등록소 (폴더를 훑어 자동 등록)
  scenes/           Boot → Title → (Calibration | Play → Result)
```

## 미니게임 추가하기

`minigames/` 에 `MiniGame` 을 구현한 클래스를 export 하는 파일을 만들면 **끝이다.**
`index.ts` 가 폴더를 훑어 자동으로 등록하므로 목록에 손으로 적을 필요가 없다.
시간·판정·점수·오디오 예약은 전부 `Runner` 가 처리하므로, 게임 쪽은 채보와
그림·소리만 정하면 된다.

```ts
export class MyGame implements MiniGame {
  readonly id = 'mygame';
  readonly title = '내 게임';
  readonly hint = '한 줄 설명';
  readonly order = 50;   // 메뉴 순서. 작을수록 위. 안 적으면 맨 뒤로
  readonly bpm = 120;
  readonly endBeat = 64;

  build(): BeatEvent[] {
    return [
      { beat: 4, kind: 'cue' },                    // 게임이 들려주는 신호
      { beat: 8, kind: 'hit' },                    // 한 번 친다
      { beat: 12, kind: 'hold', endBeat: 14 },     // 12박에 눌러 14박에 뗀다
    ];
  }

  groove(step, t, a) { basicGroove(step, t, a); }   // step = 8분음표 인덱스
  scheduleCue(ev, t, a) { a.clap(t); }
  playerSound(t, v, a) { v === 'miss' ? a.bad(t) : a.good(t); }
  draw(g, r) { /* r.beat 만 보고 그린다 */ }
}
```

필수는 위의 여섯 필드와 메서드 다섯 개뿐이고, 나머지는 필요할 때만 선언하는 **선택 필드**다.
전부 기본값이 있으므로 안 적으면 기존 동작 그대로다.

| 선택 필드 | 기본값 | 언제 쓰나 |
| --- | --- | --- |
| `order` | 100 | 메뉴 순서. 10, 20, 30 처럼 띄엄띄엄 |
| `acceptedKeys` | `Space` `ArrowUp` | 여러 키를 쓰는 게임. `hit` 의 `data.key` 로 노트별 키를 지정하면 `Runner` 가 키마다 따로 매칭한다 |
| `hitWindowMs` | `WINDOW_MS` | 판정 창을 넓히거나 좁힐 때 |
| `verdictY` | 176 | 판정 문구 높이. 화면 **위쪽**을 쓰는 게임은 기본 자리가 그림과 겹친다 |

화면 아래쪽에 자기 UI를 두는 게임은 박자 점(기본 y=490)과도 겹치니
`drawStage(g, beat, GROUND_Y, <다른 y>)` 로 점을 옮긴다.

`draw()`를 쓸 때 자주 필요한 것들은 `minigames/beat.ts`에 있다. 매번 다시 만들지 말자.

- `decay(beat, at, duration, power)` — 타점 직후 1에서 0으로 떨어지는 곡선. 스쿼시·스윙에 쓴다
- `windUp(beat, next, window)` — 다음 타점이 다가올수록 커지는 예비동작 양.
  동작이 "박자에 맞아 보이는" 건 대부분 이것 덕분이다
- `prevBeat` / `nextBeat` / `prevAndNext` — 이벤트 목록에서 직전·다음 타점 찾기

판정 창은 `core/types.ts`의 `WINDOW_MS`에 있다 (완벽 ±52ms, 좋음 ±112ms, 150ms 초과 시 놓침).
BPM이 바뀌어도 체감 난이도가 같도록 박이 아니라 ms로 정의했다.

**`hold` 노트**는 누른 시각과 뗀 시각을 모두 판정하고, **둘 중 나쁜 쪽이 최종 판정**이다.
대충 누르고 정확히 떼는 걸로는 완벽이 안 나온다. 누르는 동안 이어지는 소리가 필요하면
`holdStart` / `holdEnd` 를 구현한다 — 이 소리는 박자 신호가 아니라 입력 피드백이므로
예약이 아니라 즉시 재생해도 된다 (`AudioEngine.charge()` 참고).

## 개발 중 디버깅

dev 빌드에서만 `window.__nan`으로 `App`이 노출된다. 콘솔에서
`__nan.conductor.beat`, `__nan.scene.runner.stats` 같은 걸 바로 볼 수 있다.

## 다음에 손댈 만한 것

- 미니게임 추가 (콜 앤 리스폰스 구조를 그대로 쓰면 빨리 붙는다)
- 리듬천국의 리믹스 — 여러 미니게임을 한 곡에서 번갈아 전환
- 채보를 코드 배열이 아니라 JSON으로 분리 + 간단한 에디터
- 실제 배경음악(mp3) 지원. 이때 곡 시작 시각을 `Conductor.originTime`에 정확히
  물리는 것과, 파일 앞머리 무음만큼 오프셋을 빼주는 게 핵심이다
