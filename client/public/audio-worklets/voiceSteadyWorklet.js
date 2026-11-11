// Evens out the denoiser's level inside speech. This node compares the denoised signal (input 0)
// with the raw one (input 1, delayed here by the denoiser's latency) over a `windowMs` window
// centred on the sample being output, so a change is seen as it arrives. Two denoiser faults are
// heard as pops:
//  - steps: it switches between processing states every few tens of ms and the voice jumps by up
//    to ~10 dB from one 10 ms block to the next (with a wobble in volume). Each sudden change in the
//    denoised/raw level ratio becomes a ramp of `smoothMs`, keeping the denoiser's spectral shaping.
//  - holes: it mistakes a bit of voice for noise and returns near silence for a few tens of ms.
//    After at least `minSpeechMs` of speech, while the raw signal stays at speech level (within
//    `holeDb` of it) for up to `holdMs` after the denoiser last let speech through, the ratio
//    fades by the same ramps instead, and the raw signal (voice there) fills the level the
//    denoiser output cannot give.
// It also wipes out whole stretches of real voice (a held vowel, a hum, softer syllables). A raw
// signal that stays `keepAboveDb` over the background and voiced (periodic at a voice pitch,
// 70-400 Hz: keys, knocks and fans are not) for `keepMinMs` is voice; there the output is kept at least `keepDb` below the raw signal, ramping in and out over
// `keepRampMs`. The background is the raw level's running minimum, rising at most `floorRiseDb`/s.
// Outside speech (raw signal quiet or dropping away, denoiser cutting deeper than `speechDb`) it
// leaves the denoiser alone, so noise removal in pauses is untouched. Latency: windowMs / 2.
class VoiceSteadyProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    const ms = (v) => Math.round((v / 1000) * sampleRate);
    this.win = Math.max(2, ms(o.windowMs ?? 16));
    this.smoothCoef = Math.exp(-1 / ms(o.smoothMs ?? 60));
    this.minDry = Math.pow(10, (o.minDryDb ?? -55) / 10);
    this.speech = Math.pow(10, (o.speechDb ?? -20) / 10);
    this.hole = Math.pow(10, -(o.holeDb ?? 8) / 10);
    this.holdSamples = ms(o.holdMs ?? 120);
    this.minSpeech = ms(o.minSpeechMs ?? 40);
    this.speechRun = 0; // length of the current (or last) stretch of speech
    this.maxCut = Math.pow(10, -(o.maxCutDb ?? 12) / 10);
    this.maxLift = Math.pow(10, (o.maxLiftDb ?? 10) / 10);
    this.keepAbove = Math.pow(10, (o.keepAboveDb ?? 15) / 10);
    this.keepMin = ms(o.keepMinMs ?? 80);
    this.keep = Math.pow(10, -(o.keepDb ?? 6) / 10);
    this.keepCoef = Math.exp(-1 / ms(o.keepRampMs ?? 30));
    this.floorRise = Math.pow(10, (o.floorRiseDb ?? 3) / 10 / sampleRate);
    this.floor = 1;
    // voicing: normalised autocorrelation of the raw signal, low-passed and decimated to 8 kHz
    this.voicedMin = o.voicedCorr ?? 0.6;
    this.dec = Math.max(1, Math.round(sampleRate / 8000));
    const t = Math.tan((Math.PI * 1000) / sampleRate), kk = t * t, q = Math.SQRT2 * t, dd = 1 + q + kk;
    this.lp = [kk / dd, (2 * kk) / dd, kk / dd, (2 * (kk - 1)) / dd, (1 - q + kk) / dd];
    this.lz = [0, 0, 0, 0];
    const fs8 = sampleRate / this.dec;
    this.lagMin = Math.floor(fs8 / 400);
    this.lagMax = Math.ceil(fs8 / 70);
    this.acWin = Math.round(fs8 * 0.032);
    this.ring = new Float32Array(this.acWin + this.lagMax);
    this.ringPos = 0;
    this.decCount = 0;
    this.hop = Math.round(fs8 * 0.01);
    this.hopCount = 0;
    this.voiced = false;
    this.loudRun = 0;
    this.keepLevel = 0; // energy, relative to the raw signal, the output is kept at or above
    this.dryDelay = new Float32Array(Math.max(1, o.dryDelaySamples ?? 3205));
    this.dryPos = 0;
    this.wetSq = new Float64Array(this.win);
    this.drySq = new Float64Array(this.win);
    this.wetHist = new Float32Array(this.win);
    this.dryHist = new Float32Array(this.win);
    this.pos = 0;
    this.wetSum = 0;
    this.drySum = 0;
    this.slow = 1; // smoothed denoised/raw energy ratio
    this.speechDry = 0; // raw energy while the denoiser lets speech through
    this.sinceSpeech = Infinity;
    this.filling = false; // a hole is being bridged (or its fill is fading out)
  }

  lowpass(x, s) {
    const [b0, b1, b2, a1, a2] = this.lp;
    const y = b0 * x + this.lz[s];
    this.lz[s] = b1 * x - a1 * y + this.lz[s + 1];
    this.lz[s + 1] = b2 * x - a2 * y;
    return y;
  }

  // Whether the last 32 ms of the decimated raw signal repeat at a voice pitch period.
  measureVoicing() {
    const r = this.ring, n = r.length, w = this.acWin, end = this.ringPos;
    const at = (k) => r[(end - 1 - k + 2 * n) % n];
    let e0 = 0;
    for (let k = 0; k < w; k++) e0 += at(k) * at(k);
    let best = 0;
    for (let lag = this.lagMin; lag <= this.lagMax; lag++) {
      let c = 0, e1 = 0;
      for (let k = 0; k < w; k++) { const b = at(k + lag); c += at(k) * b; e1 += b * b; }
      const v = c / Math.sqrt(e0 * e1 + 1e-20);
      if (v > best) best = v;
    }
    this.voiced = best >= this.voicedMin;
  }

  process(inputs, outputs) {
    const wet = inputs[0]?.[0];
    const dry = inputs[1]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!wet) { output.fill(0); return true; }
    const half = this.win >> 1, k0 = this.smoothCoef;
    for (let i = 0; i < wet.length; i++) {
      const d = this.dryDelay[this.dryPos];
      this.dryDelay[this.dryPos] = dry ? dry[i] : 0;
      this.dryPos = this.dryPos + 1 === this.dryDelay.length ? 0 : this.dryPos + 1;
      const lp = this.lowpass(this.lowpass(d, 0), 2);
      if (++this.decCount === this.dec) {
        this.decCount = 0;
        this.ring[this.ringPos] = lp;
        this.ringPos = this.ringPos + 1 === this.ring.length ? 0 : this.ringPos + 1;
        if (++this.hopCount === this.hop) { this.hopCount = 0; this.measureVoicing(); }
      }

      const w = wet[i], p = this.pos;
      this.wetSum += w * w - this.wetSq[p];
      this.drySum += d * d - this.drySq[p];
      this.wetSq[p] = w * w;
      this.drySq[p] = d * d;
      this.wetHist[p] = w;
      this.dryHist[p] = d;
      this.pos = p + 1 === this.win ? 0 : p + 1;

      const dryE = Math.max(0, this.drySum) / this.win + 1e-14;
      const ratio = (Math.max(0, this.wetSum) / this.win + 1e-14) / dryE;
      const loud = dryE > this.minDry;
      this.floor = dryE < this.floor ? dryE : this.floor * this.floorRise;
      this.loudRun = loud && this.voiced && dryE > this.floor * this.keepAbove ? this.loudRun + 1 : 0;
      const keepTarget = this.loudRun >= this.keepMin ? this.keep : 0;
      this.keepLevel = keepTarget + (this.keepLevel - keepTarget) * this.keepCoef;
      let active;
      if (loud && ratio > this.speech) {
        if (this.sinceSpeech > 0) this.speechRun = 0;
        this.speechRun++;
        this.sinceSpeech = 0;
        this.speechDry = dryE + (this.speechDry - dryE) * k0;
        this.filling = false;
        active = true;
      } else {
        this.sinceSpeech++;
        const inHole = loud && this.speechRun >= this.minSpeech && this.sinceSpeech < this.holdSamples && dryE > this.speechDry * this.hole;
        // a fill that loses its hole fades out instead of stopping
        this.filling = inHole || (this.filling && this.slow > 2 * ratio && this.slow > 1e-3);
        active = this.filling;
      }

      let gain = 1, missing = 0;
      if (active) {
        this.slow = ratio + (this.slow - ratio) * k0;
        const corr = Math.min(this.maxLift, Math.max(this.maxCut, this.slow / ratio));
        gain = Math.sqrt(corr);
        // level (relative to the raw signal) the lifted denoiser output still lacks
        missing = this.slow - ratio * corr;
      } else {
        this.slow = ratio;
      }
      missing = Math.max(missing, this.keepLevel - ratio * gain * gain);
      const dryGain = missing > 0 ? Math.sqrt(missing) : 0;
      const c = p - half; // the sample at the window's centre
      const k = c < 0 ? c + this.win : c;
      output[i] = this.wetHist[k] * gain + this.dryHist[k] * dryGain;
    }
    return true;
  }
}

registerProcessor('voice-steady', VoiceSteadyProcessor);
