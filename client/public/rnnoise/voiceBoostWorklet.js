// Listener-side voice boost: `voice-leveler` evens out quiet speakers, `voice-limiter` keeps the
// amplified signal below full scale without the pumping/robotic sound of a fast compressor.

// Slowly raises quiet voices toward a target level. It never attenuates (gain >= 1), only
// measures the level while someone is actually speaking, and holds its gain during silence so
// room noise is not pumped up between phrases. `amount` (0..1) scales how much of the computed
// gain is applied, so the effect fades in smoothly as the user raises the volume above 100%.
class VoiceLevelerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }

  constructor(options) {
    super();
    const o = options.processorOptions || {};
    const dbToLin = (db) => Math.pow(10, db / 20);
    const coef = (ms) => Math.exp(-1 / ((ms / 1000) * sampleRate));

    this.targetRms = dbToLin(o.targetDb ?? -20);
    this.maxGain = dbToLin(o.maxGainDb ?? 9.5);
    this.floorPower = Math.pow(dbToLin(o.floorDb ?? -45), 2); // below this a block is not speech
    this.levelTau = (o.levelMs ?? 250) / 1000;
    this.downCoef = coef(o.downMs ?? 80); // gain falling (voice got louder)
    this.upCoef = coef(o.upMs ?? 500); // gain rising (voice got quieter)

    this.levelPower = 0;
    this.desired = 1;
    this.gain = 1;
  }

  process(inputs, outputs, parameters) {
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

    if (blockPower > this.floorPower) {
      const alpha = this.levelPower === 0 ? 1 : 1 - Math.exp(-frames / (this.levelTau * sampleRate));
      this.levelPower += (blockPower - this.levelPower) * alpha;
      const needed = this.targetRms / Math.sqrt(this.levelPower);
      this.desired = Math.min(this.maxGain, Math.max(1, needed));
    }

    const amount = parameters.amount[0];
    const target = 1 + (this.desired - 1) * amount;
    const smooth = target < this.gain ? this.downCoef : this.upCoef;
    let gain = this.gain;
    for (let i = 0; i < frames; i++) {
      gain = target + (gain - target) * smooth;
      for (let c = 0; c < channels; c++) output[c][i] = input[c][i] * gain;
    }
    this.gain = gain;
    return true;
  }
}

// Lookahead brickwall limiter. Each sample's required gain reduction is computed ahead of time,
// the sliding minimum over the lookahead window is averaged (so the gain ramps down smoothly and
// is already low when the peak reaches the output), then released slowly. Channels are linked.
class VoiceLimiterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.ceiling = Math.pow(10, (o.ceilingDb ?? -1) / 20);
    this.size = Math.max(2, Math.round(((o.lookaheadMs ?? 5) / 1000) * sampleRate));
    this.releaseCoef = Math.exp(-1 / (((o.releaseMs ?? 120) / 1000) * sampleRate));

    const n = this.size;
    this.delayLines = [];
    this.delayIndex = 0;
    this.targets = new Float32Array(n); // per-sample required gain, ring buffer
    this.dequeIdx = new Float64Array(n); // monotonic deque of ring positions (sliding minimum)
    this.dequeHead = 0;
    this.dequeLen = 0;
    this.sampleCount = 0;
    this.mins = new Float32Array(n).fill(1); // sliding minimum history for the boxcar average
    this.minsSum = n;
    this.minsIndex = 0;
    this.smoothed = 1;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const frames = input[0].length;
    const channels = Math.min(input.length, output.length);
    const n = this.size;
    while (this.delayLines.length < channels) this.delayLines.push(new Float32Array(n));

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const a = Math.abs(input[c][i]);
        if (a > peak) peak = a;
      }
      const required = peak > this.ceiling ? this.ceiling / peak : 1;

      // Sliding minimum of the last n required gains (monotonic deque).
      const pos = this.sampleCount % n;
      this.targets[pos] = required;
      const oldest = this.sampleCount - n + 1;
      while (this.dequeLen > 0) {
        const headSample = this.dequeIdx[this.dequeHead];
        if (headSample >= oldest) break;
        this.dequeHead = (this.dequeHead + 1) % n;
        this.dequeLen--;
      }
      while (this.dequeLen > 0) {
        const tail = (this.dequeHead + this.dequeLen - 1) % n;
        if (this.targets[this.dequeIdx[tail] % n] < required) break;
        this.dequeLen--;
      }
      this.dequeIdx[(this.dequeHead + this.dequeLen) % n] = this.sampleCount;
      this.dequeLen++;
      const windowMin = this.targets[this.dequeIdx[this.dequeHead] % n];
      this.sampleCount++;

      // Boxcar average over the same window: gain is <= required for the sample leaving now.
      this.minsSum += windowMin - this.mins[this.minsIndex];
      this.mins[this.minsIndex] = windowMin;
      this.minsIndex = this.minsIndex + 1 === n ? 0 : this.minsIndex + 1;
      const averaged = this.minsSum / n;

      // Instant when reducing (already smooth thanks to the boxcar), slow when recovering.
      this.smoothed =
        averaged < this.smoothed ? averaged : averaged + (this.smoothed - averaged) * this.releaseCoef;
      const gain = Math.min(this.smoothed, averaged);

      for (let c = 0; c < channels; c++) {
        const line = this.delayLines[c];
        // Reading one slot ahead of the write gives a delay of n-1 samples, which is what the
        // n-sample sliding minimum + boxcar average needs to be fully reduced at the peak.
        const delayed = line[this.delayIndex + 1 === n ? 0 : this.delayIndex + 1];
        line[this.delayIndex] = input[c][i];
        output[c][i] = delayed * gain;
      }
      this.delayIndex = this.delayIndex + 1 === n ? 0 : this.delayIndex + 1;
    }
    return true;
  }
}

registerProcessor('voice-leveler', VoiceLevelerProcessor);
registerProcessor('voice-limiter', VoiceLimiterProcessor);
