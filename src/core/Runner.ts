import type { AudioEngine } from './AudioEngine';
import type { Conductor } from './Conductor';
import type { Input } from './Input';
import { WINDOW_MS, emptyStats, type BeatEvent, type JudgeStats, type Verdict } from './types';
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

  constructor(game: MiniGame, cond: Conductor, audio: AudioEngine, input: Input) {
    this.game = game;
    this.cond = cond;
    this.audio = audio;
    this.input = input;
    this.events = game.build();
    this.stats = emptyStats(this.events.filter((e) => e.kind === 'hit').length);
  }

  get finished(): boolean {
    return this.cond.beat > this.game.endBeat;
  }

  update(): void {
    this.scheduleAhead();
    this.readInput();
    this.expireMissed();
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
      if (press.code !== 'Space' && press.code !== 'ArrowUp') continue;

      const pressBeat = this.cond.pressToBeat(press.ctxTime);
      const sound = Math.max(this.audio.ctx.currentTime, press.ctxTime);

      // 아직 판정되지 않은 hit 중 가장 가까운 것을 찾는다.
      let best: BeatEvent | null = null;
      let bestDist = Infinity;
      for (const ev of this.events) {
        if (ev.kind !== 'hit' || ev.verdict) continue;
        const d = Math.abs(ev.beat - pressBeat);
        if (d < bestDist) {
          bestDist = d;
          best = ev;
        }
      }

      const distMs = bestDist * this.cond.secPerBeat * 1000;

      if (!best || distMs > WINDOW_MS.expire) {
        // 근처에 노트가 없는데 누른 것 — 노트를 소모하지 않고 감점만.
        this.stats.whiff++;
        this.combo = 0;
        this.audio.bad(sound);
        continue;
      }

      const verdict: Verdict =
        distMs <= WINDOW_MS.perfect ? 'perfect' : distMs <= WINDOW_MS.good ? 'good' : 'miss';

      this.commit(best, verdict, pressBeat);
      this.game.playerSound(sound, verdict, this.audio);
    }
  }

  /** 판정 창을 완전히 지나쳤는데 안 눌린 노트를 놓침으로 확정. */
  private expireMissed(): void {
    const now = this.cond.beat;
    const expireBeats = (WINDOW_MS.expire / 1000) / this.cond.secPerBeat;
    for (const ev of this.events) {
      if (ev.kind !== 'hit' || ev.verdict) continue;
      if (now > ev.beat + expireBeats) {
        this.commit(ev, 'miss', ev.beat + expireBeats);
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
