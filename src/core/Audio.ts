/** Fully synthesised audio: electric drivetrain, wind, air blasts, impacts. */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorGain!: GainNode;
  private motorA!: OscillatorNode;
  private motorB!: OscillatorNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private jetGain!: GainNode;
  private jetFilter!: BiquadFilterNode;
  private liftGain!: GainNode;
  private droneGain!: GainNode;
  private blastGain!: GainNode;
  private blastFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  muted = false;
  volume = 0.8;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 2.5; }
    const loopNoise = () => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; };

    // motor
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 600;
    this.motorFilter.Q.value = 3;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    // electric drivetrain: pure inverter/motor whine, no combustion harmonics
    this.motorA = ctx.createOscillator();
    this.motorA.type = 'sine';
    this.motorB = ctx.createOscillator();
    this.motorB.type = 'triangle';
    this.motorA.connect(this.motorFilter);
    const bg = ctx.createGain(); bg.gain.value = 0.35;
    this.motorB.connect(bg).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.motorA.start(); this.motorB.start(); this.whine.start();

    // wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // jets
    this.jetFilter = ctx.createBiquadFilter();
    this.jetFilter.type = 'highpass';
    this.jetFilter.frequency.value = 1800;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    loopNoise().connect(this.jetFilter).connect(this.jetGain).connect(this.master);
    const lf = ctx.createBiquadFilter();
    lf.type = 'lowpass';
    lf.frequency.value = 500;
    this.liftGain = ctx.createGain();
    this.liftGain.gain.value = 0;
    loopNoise().connect(lf).connect(this.liftGain).connect(this.master);

    // rear exhaust launch blast: a deep roar of compressed air with a hiss on top
    this.blastFilter = ctx.createBiquadFilter();
    this.blastFilter.type = 'bandpass';
    this.blastFilter.frequency.value = 420;
    this.blastFilter.Q.value = 0.55;
    this.blastGain = ctx.createGain();
    this.blastGain.gain.value = 0;
    loopNoise().connect(this.blastFilter).connect(this.blastGain).connect(this.master);
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 3200;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.25;
    loopNoise().connect(hiss).connect(hissGain).connect(this.blastGain);

    // ambient drone
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0; // no background hum
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 300;
    for (const f of [55, 82.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lg = ctx.createGain();
      lg.gain.value = 0.25;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(dl);
      o.start(); lfo.start();
    }
    dl.connect(this.droneGain).connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  update(p: { speed: number; throttle: number; onGround: boolean; jets: number; lift: number; inAir: boolean; active: boolean; exhaust?: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const sp = p.speed;
    const k = 0.06;
    // motor whine climbs with wheel speed; a second, higher inverter tone sits on top
    const base = 90 + sp * 13;
    this.motorA.frequency.setTargetAtTime(base, t, k);
    this.motorB.frequency.setTargetAtTime(base * 2.003, t, k);
    this.motorFilter.frequency.setTargetAtTime(1800 + sp * 30, t, k);
    // an electric drivetrain is silent at a standstill: every tone fades in with wheel speed
    const roll = Math.min(1, sp / 6);
    const mg = p.active ? (p.onGround ? (0.012 + p.throttle * 0.05) * roll : 0.008 * roll) : 0;
    this.motorGain.gain.setTargetAtTime(mg, t, 0.08);
    this.whine.frequency.setTargetAtTime(1400 + sp * 48, t, k);
    this.whineGain.gain.setTargetAtTime(p.active ? (p.onGround ? 0.004 + p.throttle * 0.012 : 0.002) * roll : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + sp * 12, t, 0.1);
    this.windGain.gain.setTargetAtTime(p.active ? Math.min(0.32, sp * sp * 0.00004) + (p.onGround ? Math.min(0.06, sp * 0.0012) : 0) : 0, t, 0.1);
    this.jetGain.gain.setTargetAtTime(Math.min(0.35, p.jets * 0.08), t, 0.03);
    this.liftGain.gain.setTargetAtTime(p.lift * 0.6, t, 0.04);
    const ex = p.active ? p.exhaust ?? 0 : 0;
    this.blastGain.gain.setTargetAtTime(ex * 0.55, t, 0.05);
    this.blastFilter.frequency.setTargetAtTime(380 + sp * 9, t, 0.1);
  }

  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', q = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  beep(high = false) { this.tone(high ? 1320 : 660, high ? 0.5 : 0.18, 0.18, 'square'); }
  click() { this.tone(1800, 0.04, 0.05, 'square'); }
  thud(intensity: number) {
    const i = Math.min(1, intensity);
    this.tone(70, 0.5, 0.5 * i + 0.1, 'sine', 0.4);
    this.burst(0.35, 900, 0.4 * i + 0.05);
    this.burst(1.6, 2500, 0.12 * i, 'bandpass', 0.5);
  }
  crash() {
    this.tone(55, 0.9, 0.7, 'sawtooth', 0.3);
    this.burst(1.2, 1600, 0.9);
    this.burst(0.6, 4000, 0.5, 'highpass');
    setTimeout(() => this.burst(0.5, 1200, 0.5), 140);
    setTimeout(() => this.burst(0.8, 800, 0.4), 320);
  }
  whoosh() { this.burst(0.9, 600, 0.25, 'bandpass', 0.8); }
  success() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 0.09, 'triangle'), i * 90));
  }
}
