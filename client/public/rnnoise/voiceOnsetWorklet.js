// Softens phrase onsets on the gated denoiser output. With the background noise removed, a phrase
// starts from digital silence, and its first pulses (vocal fry, mouth clicks, a hard glottal
// attack) are heard as a "pop". Right after a real pause (`pauseMs` below `silenceDb`), peaks are
// limited to `ratioDb` above an envelope that rises slowly from silence (`riseMs`); the limit is
// lifted `activeMs` into the phrase, so mid-phrase speech is never touched. Gain moves in ramps of
// a few ms (lookahead covers the attack) to avoid creating clicks of its own.
class VoiceOnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    const toSamples = (ms) => Math.max(1, Math.round((ms / 1000) * sampleRate));
    const coef = (ms) => Math.exp(-1 / toSamples(ms));
    this.ratio = Math.pow(10, (o.ratioDb ?? 6) / 20);
    this.floor = Math.pow(10, (o.floorDb ?? -55) / 20);
    this.silence = Math.pow(10, (o.silenceDb ?? -60) / 20);
    this.pauseSamples = toSamples(o.pauseMs ?? 120);
    this.activeSamples = toSamples(o.activeMs ?? 80);
    this.riseCoef = coef(o.riseMs ?? 30);
    this.attackCoef = coef(o.attackMs ?? 1.5);
    this.releaseCoef = coef(o.releaseMs ?? 15);
    this.size = toSamples(o.lookaheadMs ?? 3);
    this.delay = new Float32Array(this.size);
    this.abs = new Float32Array(this.size);
    this.pos = 0;
    this.env = 0;
    this.gain = 1;
    this.quietRun = this.pauseSamples; // start as if after a pause
    this.sinceOnset = Infinity;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;
    const size = this.size;
    for (let n = 0; n < input.length; n++) {
      const v = input[n];
      const a = Math.abs(v);

      if (a < this.silence) {
        this.quietRun++;
      } else {
        if (this.quietRun >= this.pauseSamples) {
          this.sinceOnset = 0;
          this.env = 0;
        }
        this.quietRun = 0;
      }
      this.sinceOnset++;
      if (a > this.env) this.env = a + (this.env - a) * this.riseCoef;

      const out = this.delay[this.pos];
      this.delay[this.pos] = v;
      this.abs[this.pos] = a;
      this.pos = this.pos + 1 === size ? 0 : this.pos + 1;

      let target = 1;
      if (this.sinceOnset < this.activeSamples + size) {
        let peak = 0;
        for (let k = 0; k < size; k++) if (this.abs[k] > peak) peak = this.abs[k];
        const allowed = Math.max(this.env, this.floor) * this.ratio;
        if (peak > allowed) target = allowed / peak;
      }
      this.gain = target + (this.gain - target) * (target < this.gain ? this.attackCoef : this.releaseCoef);
      output[n] = out * this.gain;
    }
    return true;
  }
}

registerProcessor('voice-onset', VoiceOnsetProcessor);
