# 같이 개발하기

3명이 동시에 작업하기 위한 규칙. 코드 구조와 미니게임 만드는 법은 [README.md](./README.md)에 있다.

## 시작

```bash
git clone https://github.com/ldy1118-git/NAN_Game_Hackathon.git
cd NAN_Game_Hackathon
npm install
npm run dev        # http://localhost:5173
```

> 원격 서버에서 개발한다면 `vite.config.ts`에 `host: true`가 들어 있으므로
> `http://<서버IP>:5173` 으로 접속하거나, VS Code Remote-SSH의 PORTS 탭에서
> 5173을 포워딩하면 된다.

**헤드폰을 쓸 것.** 리듬게임이라 스피커로는 박자 어긋남을 못 잡아낸다.
처음 실행하면 타이틀에서 **타이밍 맞추기**를 한 번 돌려서 입력 지연을 보정하자.
사람·기기마다 20~80ms씩 다르고, 이건 판정 등급이 통째로 갈리는 크기다.

## 브랜치

| 항목 | 규칙 |
| --- | --- |
| `main` | 항상 `npm run dev`가 돌아가는 상태를 유지한다. **직접 push 금지** |
| 작업 브랜치 | `feat/<이름>-<내용>` — 예: `feat/dongyun-piano` |
| 머지 | PR로만, **Squash and merge**. 승인 대기는 안 해도 되지만 **머지 전 본인이 실행 확인** 필수 |
| 주기 | 하루 최소 한 번 머지. 브랜치가 이틀 넘게 살아있으면 충돌이 감당 안 된다 |

작업 시작 전과 PR 올리기 전에는 항상:

```bash
git pull --rebase origin main
```

## 머지

**PR은 반드시 Squash and merge로 합친다.**

하카톤에서는 `wip`, `되나 테스트`, `오타` 같은 커밋이 잔뜩 생긴다. 그게 그대로
`main`에 쌓이면 나중에 "이 기능 언제 들어왔지"를 추적할 수 없다. Squash로 합치면
`main` 히스토리가 "피아노 미니게임 추가" 한 줄로 남고, 문제가 생겼을 때
커밋 하나만 revert하면 통째로 되돌아간다.

> 저장소 Settings → General → Pull Requests에서 "Allow squash merging"만 남기고
> 나머지 둘은 꺼두었다. PR 화면에 버튼이 하나만 뜨므로 헷갈릴 일은 없다.

**충돌은 PR 올린 사람이 해결한다.** 자기 브랜치로 main을 당겨와서 고친 뒤 다시 push하면 된다.

```bash
git pull --rebase origin main
# 충돌 고치고
git add .
git rebase --continue
git push --force-with-lease
```

`--force-with-lease`를 쓴다. 그냥 `--force`는 그 사이 남이 올린 커밋을 지울 수 있다.

**`main`이 깨졌으면 고치려 들지 말고 일단 되돌린다.** 하카톤에서 main이 30분 멈추면
셋 다 멈춘다. 문제가 된 PR을 revert해서 main을 먼저 살리고, 원인은 브랜치에서 천천히 잡자.

머지된 브랜치는 자동으로 삭제되게 해뒀다. 안 그러면 브랜치가 20개씩 쌓인다.

## 이미 있는 건 다시 만들지 말자

공용 코드가 1600줄 넘게 이미 있다. **새 미니게임을 만들 때 아래는 손댈 필요가 없다.**

| 이미 있는 것 | 하는 일 |
| --- | --- |
| `core/Conductor` | 박자 계산, 오디오 클럭, 입력·출력 지연 보정 |
| `core/Runner` | 판정 · 콤보 · 점수 · 오디오 예약 전부 |
| `core/AudioEngine` | 킥 / 스네어 / 하이햇 / 손뼉 / 블립 / 베이스 / 성공음 / 실패음 |
| `core/draw` | `beatPulse` `easeOut` `easeBack` `lerp` `roundRect` `text` + 색상표 `C` |
| `minigames/beat` | `decay`(타격 후 감쇠) `windUp`(예비동작) `prevBeat` `nextBeat` `prevAndNext` |
| `minigames/character` | `drawBody` `drawHands` `shockRing` — 색만 바꾸면 새 캐릭터 |
| `minigames/stage` | 바닥, 박자 점, 마디 첫 박 배경 플래시 |
| `scenes/*` | 타이틀 → 플레이 → 결과 흐름, 진행바 · 콤보 · 판정 문구 HUD |

**새 미니게임이 실제로 작성할 건 메서드 5개뿐이다** — `build`(채보), `groove`(반주),
`scheduleCue`(신호음), `playerSound`(입력음), `draw`(그림).

백지에서 시작하지 말고 **`ClapBot.ts`를 복사해서 이름만 바꿔 시작하는 게 제일 빠르다.**
234줄짜리 동작하는 예제다. `RallyBall.ts`는 "날아오는 물체를 정박에 받아치는" 형태의 예제.

없는 게 필요하면 만들어 쓰되, **다른 미니게임에도 쓸 만한 거면 `beat.ts`나
`character.ts`에 넣고 단톡에 알리자.** 셋이 각자 같은 걸 만드는 게 제일 아깝다.

## 충돌 나는 곳은 세 군데뿐이다

미니게임 본체는 파일 하나로 완전히 독립적이다. 규칙은 **"한 파일의 주인은 한 명"**이다.
한 사람이 미니게임을 3개 만들어도 되고(파일 3개), 그 안에서는 뭘 하든 충돌이 안 난다.
다만 **같은 파일을 두 명이 동시에 고치면** 충돌하니, 그럴 땐 미리 말을 맞추자.

### 1. `src/minigames/index.ts` — 유일한 공통 접점

새 미니게임을 등록하는 배열이라, 셋이 각자 추가하면 여기서 충돌한다.
**해결은 간단하다. 양쪽 줄을 다 남기면 된다.**

```
<<<<<<< HEAD
  { id: 'piano', ... },
=======
  { id: 'drum', ... },
>>>>>>> feat/other-drum
```

→ 충돌 표시만 지우고 두 줄 다 남긴다:

```ts
  { id: 'piano', ... },
  { id: 'drum', ... },
```

### 2. `src/core/*` — 셋이 공유하는 인프라

`Conductor`, `Runner`, `AudioEngine`, `App`은 모든 미니게임이 의존한다.

- **추가는 자유** — `AudioEngine`에 새 소리 메서드를 넣는 건 아무도 안 깨진다.
- **변경은 합의 후** — 기존 메서드 시그니처나 판정 창(`core/types.ts`의 `WINDOW_MS`)을
  바꾸면 셋 다 영향을 받는다. 먼저 말하고, **미니게임 PR에 섞지 말고 별도 PR로** 올린다.

### 3. `package.json` / `package-lock.json`

지금 의존성은 vite, typescript 둘뿐이다. **되도록 라이브러리를 추가하지 말자.**
Canvas 2D와 Web Audio만으로 충분하고, 번들도 27KB로 가볍다.

꼭 필요하면 한 명이 대표로 추가해서 **먼저 머지**한 뒤 나머지가 rebase한다.
lock 파일 충돌은 손으로 못 고치고 `npm install`을 다시 돌려야 한다.

## 역할 나누기

미니게임이 파일 단위로 독립적이라, 이걸 작업 단위로 삼으면 서로 안 밟는다.

- **미니게임은 만들고 싶은 만큼** — 각자 자기 파일에서 작업한다. 개수 제한은 없다
- **`core/`와 씬 흐름은 한 명이 담당** — 여러 명이 손대면 계속 깨진다
- **`beat.ts` / `character.ts`에 추가**하는 건 누구든 자유. 다만 기존 함수를
  **바꾸는** 건 다른 게임이 쓰고 있을 수 있으니 먼저 말하자
- **리믹스**(여러 미니게임을 한 곡에서 번갈아 전환)는 개별 게임이 다 나온 뒤 마지막에

## PR 올리기 전 체크

```bash
npm run build     # 타입체크 + 빌드. 통과 안 하면 머지하지 않는다
```

그리고 **실제로 플레이해 보고** 아래를 확인한다.

- 박자에 맞춰 눌렀을 때 "완벽"이 뜨는가 (안 뜨면 타이밍 계산이 틀린 것)
- 프레임이 튀어도 그림이 소리와 안 어긋나는가
- Esc로 나가고 다시 들어와도 정상인가

## 커밋 메시지

한 줄 요약 + 필요하면 본문. 뭘 왜 바꿨는지 알아볼 수 있으면 형식은 자유다.

```
피아노 미니게임 추가

3화음 콜 앤 리스폰스. 8마디 24노트.
```

## 지켜야 할 것 하나

새 미니게임을 만들 때 **`draw()`는 오직 `beat`만 보고 그릴 것.**
위치나 속도를 클래스 필드에 들고 프레임마다 더하는 방식은 쓰면 안 된다.
프레임이 한 번만 밀려도 그림과 소리가 영구히 어긋나고, 이건 나중에 고치기 매우 어렵다.

```ts
// ✗ 이러면 안 된다 — 프레임 드랍이 영구 오차로 쌓인다
this.x += this.speed * dt;

// ✓ 이렇게 — 언제 그려도 다시 맞는다
const x = lerp(startX, endX, (beat - startBeat) / duration);
```

자세한 이유는 README의 "딱딱 맞는 느낌을 만드는 세 가지" 참고.
