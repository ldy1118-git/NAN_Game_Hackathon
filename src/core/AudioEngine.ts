/**
 * AudioEngine — 오디오 파일 없이 Web Audio 로 직접 소리를 만든다.
 *
 * mp3 를 쓰면 디코딩·로딩·파일마다 다른 무음 구간 때문에 박자가 미묘하게 흔들리는데,
 * 합성음은 예약한 ctx 시각에 샘플 단위로 정확히 울린다. 프로토타입 단계에서
 * "딱딱 맞는" 감각을 검증하기엔 이쪽이 훨씬 정직하다.
 *
 * 모든 메서드는 "언제 울릴지(ctx 시각)"를 인자로 받는다. 지금 당장 재생하는
 * API 는 일부러 만들지 않았다 — 리듬게임에서 소리는 항상 미리 예약해야 한다.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // 화이트 노이즈 1초짜리를 만들어두고 타악기마다 잘라 쓴다.
    const len = Math.floor(ctx.sampleRate);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      // 재현 가능한 의사난수 — 매 실행마다 같은 노이즈 톤이 나오도록.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff) - 1;
    }
  }

  set volume(v: number) {
    this.master.gain.value = v;
  }

  /** 커스텀 사운드를 붙일 수 있는 마스터 노드. 여기 연결하면 volume 컨트롤을 그대로 탄다. */
  get output(): AudioNode {
    return this.master;
  }

  private env(t: number, attack: number, decay: number, peak: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private noiseSource(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    // 1초 버퍼 안에서 시작점을 옮겨 매번 조금씩 다른 질감을 낸다.
    s.start(t, (t * 7.13) % 0.8, dur);
    s.stop(t + dur);
    return s;
  }

  kick(t: number, gain = 1): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = this.env(t, 0.004, 0.2, 0.9 * gain);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  snare(t: number, gain = 1): void {
    const s = this.noiseSource(t, 0.2);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = this.env(t, 0.002, 0.14, 0.34 * gain);
    s.connect(bp).connect(g).connect(this.master);

    // 몸통을 만드는 짧은 삼각파 — 노이즈만 쓰면 얇게 들린다.
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g2 = this.env(t, 0.002, 0.07, 0.22 * gain);
    o.connect(g2).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  hat(t: number, gain = 1): void {
    const s = this.noiseSource(t, 0.06);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8200;
    const g = this.env(t, 0.001, 0.04, 0.1 * gain);
    s.connect(hp).connect(g).connect(this.master);
  }

  /** 손뼉 — 아주 짧은 간격의 노이즈 3연타로 "짝" 하는 질감을 만든다. */
  clap(t: number, gain = 1): void {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.011;
      const s = this.noiseSource(at, 0.09);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1350;
      bp.Q.value = 1.4;
      const g = this.env(at, 0.001, i === 2 ? 0.13 : 0.03, (i === 2 ? 0.4 : 0.26) * gain);
      s.connect(bp).connect(g).connect(this.master);
    }
  }

  /** 음정이 있는 짧은 신호음. 콜(안내)과 리스폰스(내 입력)를 음색으로 구분한다. */
  blip(t: number, freq: number, gain = 1, type: OscillatorType = 'triangle'): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.env(t, 0.004, 0.16, 0.3 * gain);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  /** 베이스 — 8분음표 그루브의 바닥을 깐다. */
  bass(t: number, freq: number, dur = 0.22, gain = 1): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + dur);
    const g = this.env(t, 0.006, dur, 0.2 * gain);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /**
   * 충전음 — 누르고 있는 동안 이어지고, 뗄 때 stop() 한다.
   *
   * 이 엔진의 다른 소리와 달리 "지금 시작해서 언제 끝날지 모르는" 소리다.
   * 대신 목표 지속시간(dur)만큼 음정을 끌어올려서, 다 찼을 때의 높이를
   * 귀로 알 수 있게 한다 — 게이지를 안 봐도 뗄 타이밍이 들린다.
   */
  charge(t: number, dur: number): { stop: (at: number) => void } {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(196, t);
    osc.frequency.linearRampToValueAtTime(587.33, t + dur);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.linearRampToValueAtTime(3200, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);

    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);

    let stopped = false;
    return {
      stop: (at: number) => {
        if (stopped) return;
        stopped = true;
        const end = Math.max(at, this.ctx.currentTime);
        g.gain.cancelScheduledValues(end);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), end);
        g.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
        osc.stop(end + 0.12);
      },
    };
  }

  /** 성공 — 위로 붙는 두 음. */
  good(t: number): void {
    this.blip(t, 880, 0.7, 'square');
    this.blip(t + 0.055, 1318, 0.55, 'square');
  }

  /** 실패 — 아래로 처지는 짧은 버즈. */
  bad(t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.16);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = this.env(t, 0.004, 0.16, 0.24);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }
}
