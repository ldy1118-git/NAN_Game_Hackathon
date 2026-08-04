import type { AudioEngine } from './AudioEngine';
import type { Conductor } from './Conductor';
import type { Input } from './Input';
import {
  WINDOW_MS,
  emptyStats,
  worseVerdict,
  type BeatEvent,
  type JudgeStats,
  type Verdict,
} from './types';
import type { MiniGame } from '../minigames/MiniGame';

/** 오디오를 몇 초 앞까지 미리 예약할지. 이보다 프레임이 늦게 돌면 소리가 밀린다. */
const LOOKAHEAD_SEC = 0.18;

export interface LastJudge {
  ev: BeatEvent;
  verdict: Verdict;
  /** 판정이 난 박 — 피드백 애니메이션의 기준. */
  atBeat: number;
}

/**
 * Runner — 채보 진행·오디오 예약·판정을 담당한다.
 * 미니게임은 "무엇을 언제 그릴지"만 신경 쓰고, 시간과 점수는 전부 여기서 처리한다.
 */
export class Runner {
  readonly game: MiniGame;
  readonly events: BeatEvent[];
  stats: JudgeStats;
  lastJudge: LastJudge | null = null;
  combo = 0;
  bestCombo = 0;

  private cond: Conductor;
  private audio: AudioEngine;
  private input: Input;
  /** 다음에 예약할 8분음표 스텝 인덱스. */
  private nextStep = 0;
  /** 지금 누르고 있는 hold 노트. 뗄 때 이걸로 마무리 판정한다. */
  private activeHold: BeatEvent | null = null;
  /** 그 hold 를 누를 때의 판정 — 뗄 때의 판정과 합쳐 최종 결과를 낸다. */
  private holdStartVerdict: Verdict = 'perfect';
  private acceptedKeys: Set<string>;
  private window: { perfect: number; good: number; expire: number };

  constructor(game: MiniGame, cond: Conductor, audio: AudioEngine, input: Input) {
    this.game = game;
    this.cond = cond;
    this.audio = audio;
    this.input = input;
    this.events = game.build();
    this.stats = emptyStats(
      this.events.filter((e) => e.kind === 'hit' || e.kind === 'hold').length,
    );
    this.acceptedKeys = new Set(game.acceptedKeys ?? ['Space', 'ArrowUp']);
    this.window = game.hitWindowMs ?? WINDOW_MS;
  }

  get finished(): boolean {
    return this.cond.beat > this.game.endBeat;
  }

  update(): void {
    this.scheduleAhead();
    this.readInput();
    this.expireMissed();
  }

  /**
   * 흐름이 끊겼을 때(일시정지·탭 전환) 스케줄러를 정리한다.
   *
   * 두 가지를 되돌린다.
   *   1. 누르고 있던 hold — 그냥 두면 onPress 가 계속 early return 해서
   *      재개 후 아무 노트도 칠 수 없게 된다.
   *   2. 멈춘 지점 이후로 이미 걸어둔 예약 — 그 소리들은 멈춰 있는 동안
   *      울려버리므로, 표시를 지워 재개할 때 다시 걸리게 한다.
   */
  interrupt(): void {
    this.activeHold = null;
    this.holdStartVerdict = 'perfect';

    const beat = this.cond.beat;
    // 지금 박에 걸린 스텝은 이미 예약돼 울렸다고 보고 다음 것부터 다시 건다.
    this.nextStep = Math.max(0, Math.floor(beat / 0.5) + 1);
    for (const ev of this.events) {
      if (ev.scheduled && ev.beat > beat) ev.scheduled = false;
    }
  }

  /** 아직 예약하지 않은 미래의 소리를 LOOKAHEAD 만큼 앞서 걸어둔다. */
  private scheduleAhead(): void {
    const horizon = this.cond.scheduleBeat + LOOKAHEAD_SEC / this.cond.secPerBeat;

    for (const ev of this.events) {
      if (ev.scheduled || ev.beat > horizon) continue;
      ev.scheduled = true;
      if (ev.kind === 'cue') {
        this.game.scheduleCue(ev, this.cond.beatToCtxTime(ev.beat), this.audio);
      }
    }

    // 반주 그루브 — 8분음표 단위로 훑는다.
    while (this.nextStep * 0.5 <= horizon) {
      const beat = this.nextStep * 0.5;
      if (beat <= this.game.endBeat + 1) {
        this.game.groove(this.nextStep, this.cond.beatToCtxTime(beat), this.audio);
      }
      this.nextStep++;
    }
  }

  private readInput(): void {
    for (const press of this.input.drain()) {
      if (!this.acceptedKeys.has(press.code)) continue;
      if (press.kind === 'down') this.onPress(press.ctxTime, press.code);
      else this.onRelease(press.ctxTime);
    }
  }

  private onPress(ctxTime: number, code: string): void {
    // 이미 누르고 있는 중이면 무시. (자동반복은 Input 에서 걸러진다)
    if (this.activeHold) return;

    const pressBeat = this.cond.pressToBeat(ctxTime);
    const sound = Math.max(this.audio.ctx.currentTime, ctxTime);

    // 아직 판정되지 않은 노트 중 가장 가까운 것을 찾는다.
    // ev.data.key 가 있으면 그 키를 누른 입력만 매칭된다 (다중키 게임 지원).
    let best: BeatEvent | null = null;
    let bestDist = Infinity;
    for (const ev of this.events) {
      if ((ev.kind !== 'hit' && ev.kind !== 'hold') || ev.verdict) continue;
      const requiredKey = ev.data?.key as string | undefined;
      if (requiredKey && requiredKey !== code) continue;
      const d = Math.abs(ev.beat - pressBeat);
      if (d < bestDist) {
        bestDist = d;
        best = ev;
      }
    }

    const distMs = bestDist * this.cond.secPerBeat * 1000;

    if (!best || distMs > this.window.expire) {
      // 근처에 노트가 없는데 누른 것 — 노트를 소모하지 않고 감점만.
      this.stats.whiff++;
      this.combo = 0;
      this.audio.bad(sound);
      return;
    }

    const verdict = this.verdictFor(distMs);

    if (best.kind === 'hold') {
      // 누른 시점만으로는 확정하지 않는다. 뗄 때까지 들고 있다가 합쳐서 판정.
      best.pressedBeat = pressBeat;
      best.holding = true;
      this.activeHold = best;
      this.holdStartVerdict = verdict;
      this.game.holdStart?.(best, sound, verdict, this.audio);
      return;
    }

    this.commit(best, verdict, pressBeat);
    this.game.playerSound(sound, verdict, this.audio, best);
  }

  private verdictFor(distMs: number): Verdict {
    return distMs <= this.window.perfect
      ? 'perfect'
      : distMs <= this.window.good
      ? 'good'
      : 'miss';
  }

  private onRelease(ctxTime: number): void {
    const ev = this.activeHold;
    if (!ev || ev.endBeat === undefined) return;

    this.activeHold = null;
    ev.holding = false;

    const releaseBeat = this.cond.pressToBeat(ctxTime);
    ev.releasedBeat = releaseBeat;

    const distMs = Math.abs(ev.endBeat - releaseBeat) * this.cond.secPerBeat * 1000;
    const final = worseVerdict(this.holdStartVerdict, this.verdictFor(distMs));

    this.commit(ev, final, ev.pressedBeat ?? releaseBeat);
    this.game.holdEnd?.(ev, Math.max(this.audio.ctx.currentTime, ctxTime), final, this.audio);
  }

  /** 판정 창을 완전히 지나쳤는데 처리되지 않은 노트를 놓침으로 확정. */
  private expireMissed(): void {
    const now = this.cond.beat;
    const expireBeats = this.window.expire / 1000 / this.cond.secPerBeat;

    for (const ev of this.events) {
      if (ev.verdict) continue;

      if (ev.kind === 'hit') {
        if (now > ev.beat + expireBeats) this.commit(ev, 'miss', ev.beat + expireBeats);
        continue;
      }

      if (ev.kind !== 'hold' || ev.endBeat === undefined) continue;

      if (!ev.holding) {
        // 아예 누르지 않고 지나쳤다
        if (now > ev.beat + expireBeats) this.commit(ev, 'miss', ev.beat + expireBeats);
      } else if (now > ev.endBeat + expireBeats) {
        // 누르긴 했는데 뗄 시점을 한참 넘겼다
        ev.holding = false;
        this.activeHold = null;
        this.commit(ev, 'miss', ev.endBeat + expireBeats);
        this.audio.bad(this.audio.ctx.currentTime);
        this.game.holdEnd?.(ev, this.audio.ctx.currentTime, 'miss', this.audio);
      }
    }
  }

  private commit(ev: BeatEvent, verdict: Verdict, pressedBeat: number): void {
    ev.verdict = verdict;
    ev.pressedBeat = pressedBeat;
    this.stats[verdict]++;

    if (verdict === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    }

    this.lastJudge = { ev, verdict, atBeat: this.cond.beat };
  }
}
