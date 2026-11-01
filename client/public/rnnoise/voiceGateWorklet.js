// Voice gate applied after the neural denoiser: silences the residual noise it lets through
// (keyboard clicks, taps, distant voices) and only opens on sustained voice energy.
// The open threshold is the highest of: an absolute minimum, the tracked noise floor + margin, and
// (once calibrated) the user's own voice level - margin. The last one is what rejects background
// voices, which reach the mic quieter than the user's. A lookahead delay lets the gate open before
// the first syllable, so onsets are not chopped.
class VoiceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    const msToSamples = (ms) => Math.max(1, Math.round((ms / 1000) * sampleRate));
    const msToCoef = (ms) => Math.exp(-1 / msToSamples(ms));

    this.minOpenDb = o.minOpenDb ?? -50;
    this.floorMarginDb = o.floorMarginDb ?? 10;
    this.maxFloorDb = o.maxFloorDb ?? -55; // long speech must not drag the floor (and threshold) up
    this.hysteresisDb = o.hysteresisDb ?? 6;
    this.voiceLevelDb = o.voiceLevelDb ?? null;
    this.voiceMarginDb = o.voiceMarginDb ?? 20;

    this.sustainSamples = msToSamples(o.sustainMs ?? 30); // voice must last this long to open (rejects clicks)
    this.holdSamples = msToSamples(o.holdMs ?? 250); // keeps open between words
    this.attackCoef = msToCoef(o.attackMs ?? 3);
    this.releaseCoef = msToCoef(o.releaseMs ?? 80);
    this.envTau = (o.envelopeMs ?? 10) / 1000;
    this.floorRiseDbPerSec = o.floorRiseDbPerSec ?? 1;

    this.delaySize = msToSamples(o.lookaheadMs ?? 30);
    this.delayLines = [];
    this.writeIndex = 0;

    this.envPower = 0;
    this.floorDb = -70;
    this.isOpen = false;
    this.aboveSamples = 0;
    this.belowSamples = 0;
    this.gain = 0;

    this.calibration = null; // { remaining, levels[] } while measuring the user's voice

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'config') {
        if ('voiceLevelDb' in msg) this.voiceLevelDb = msg.voiceLevelDb;
        if ('voiceMarginDb' in msg) this.voiceMarginDb = msg.voiceMarginDb;
      } else if (msg.type === 'calibrate') {
        this.calibration = { remaining: msToSamples(msg.durationMs ?? 3000), levels: [] };
      }
    };
  }

  openThresholdDb() {
    let db = Math.max(this.minOpenDb, this.floorDb + this.floorMarginDb);
    if (this.voiceLevelDb !== null) db = Math.max(db, this.voiceLevelDb - this.voiceMarginDb);
    return db;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const frames = input[0].length;
    const channels = Math.min(input.length, output.length);

    let sumSquares = 0;
    for (let c = 0; c < channels; c++) {
      const data = input[c];
      for (let i = 0; i < frames; i++) sumSquares += data[i] * data[i];
    }
    const blockPower = sumSquares / (frames * channels);
    const alpha = 1 - Math.exp(-frames / (this.envTau * sampleRate));
    this.envPower += (blockPower - this.envPower) * alpha;
    const levelDb = 10 * Math.log10(this.envPower + 1e-12);

    // Noise floor: follows drops immediately, rises slowly (so speech barely moves it).
    if (levelDb < this.floorDb) this.floorDb = levelDb;
    else this.floorDb = Math.min(this.maxFloorDb, this.floorDb + (this.floorRiseDbPerSec * frames) / sampleRate);

    const openDb = this.openThresholdDb();
    const closeDb = openDb - this.hysteresisDb;

    if (this.isOpen) {
      this.belowSamples = levelDb < closeDb ? this.belowSamples + frames : 0;
      if (this.belowSamples >= this.holdSamples) {
        this.isOpen = false;
        this.aboveSamples = 0;
      }
    } else {
      this.aboveSamples = levelDb > openDb ? this.aboveSamples + frames : 0;
      if (this.aboveSamples >= this.sustainSamples) {
        this.isOpen = true;
        this.belowSamples = 0;
      }
    }

    if (this.calibration) this.collectCalibration(levelDb, frames);

    while (this.delayLines.length < channels) {
      this.delayLines.push(new Float32Array(this.delaySize));
    }

    const target = this.isOpen ? 1 : 0;
    const coef = this.isOpen ? this.attackCoef : this.releaseCoef;
    let gain = this.gain;
    let writeIndex = this.writeIndex;

    for (let i = 0; i < frames; i++) {
      gain = target + (gain - target) * coef;
      for (let c = 0; c < channels; c++) {
        const line = this.delayLines[c];
        const delayed = line[writeIndex];
        line[writeIndex] = input[c][i];
        output[c][i] = delayed * gain;
      }
      writeIndex = writeIndex + 1 === this.delaySize ? 0 : writeIndex + 1;
    }

    this.gain = gain;
    this.writeIndex = writeIndex;
    return true;
  }

  // Voice level = median envelope of the blocks clearly above the noise floor while the user speaks.
  collectCalibration(levelDb, frames) {
    const cal = this.calibration;
    if (levelDb > Math.max(this.minOpenDb, this.floorDb + this.floorMarginDb)) cal.levels.push(levelDb);
    cal.remaining -= frames;
    if (cal.remaining > 0) return;

    this.calibration = null;
    const voicedMs = (cal.levels.length * frames * 1000) / sampleRate;
    if (voicedMs < 500) {
      this.port.postMessage({ type: 'calibrated', levelDb: null, voicedMs });
      return;
    }
    cal.levels.sort((a, b) => a - b);
    this.port.postMessage({ type: 'calibrated', levelDb: cal.levels[cal.levels.length >> 1], voicedMs });
  }
}

registerProcessor('voice-gate', VoiceGateProcessor);
