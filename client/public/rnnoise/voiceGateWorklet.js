// Voice gate applied after RNNoise: silences the residual noise RNNoise lets through
// (keyboard clicks, taps, distant sounds) and only opens on sustained voice energy.
// A lookahead delay lets the gate open before the first syllable, so onsets are not chopped.
class VoiceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    const dbToLin = (db) => Math.pow(10, db / 20);
    const msToSamples = (ms) => Math.max(1, Math.round((ms / 1000) * sampleRate));
    const msToCoef = (ms) => Math.exp(-1 / msToSamples(ms));

    this.openLevel = dbToLin(o.openDb ?? -50);
    this.closeLevel = dbToLin(o.closeDb ?? -58);
    this.sustainSamples = msToSamples(o.sustainMs ?? 20); // voice must last this long to open (rejects clicks)
    this.holdSamples = msToSamples(o.holdMs ?? 250); // keeps open between words
    this.attackCoef = msToCoef(o.attackMs ?? 3);
    this.releaseCoef = msToCoef(o.releaseMs ?? 80);

    this.delaySize = msToSamples(o.lookaheadMs ?? 20);
    this.delayLines = [];
    this.writeIndex = 0;

    this.isOpen = false;
    this.aboveSamples = 0;
    this.belowSamples = 0;
    this.gain = 0;
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
    const rms = Math.sqrt(sumSquares / (frames * channels));

    if (this.isOpen) {
      this.belowSamples = rms < this.closeLevel ? this.belowSamples + frames : 0;
      if (this.belowSamples >= this.holdSamples) {
        this.isOpen = false;
        this.aboveSamples = 0;
      }
    } else {
      this.aboveSamples = rms > this.openLevel ? this.aboveSamples + frames : 0;
      if (this.aboveSamples >= this.sustainSamples) {
        this.isOpen = true;
        this.belowSamples = 0;
      }
    }

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
}

registerProcessor('voice-gate', VoiceGateProcessor);
