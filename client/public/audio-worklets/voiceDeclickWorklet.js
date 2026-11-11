// Click remover. Clicks left over speech (mouth clicks, key taps, denoiser artefacts) are short
// broadband bursts whose energy towers over the surrounding ms. The signal is split into
// low + mid + high (each band is the difference of two lowpasses, so with no correction the sum is
// exactly the input) and only the mid and high bands are ducked, bin by bin, back to `keepDb` over
// the median of the surrounding `contextMs`.
//  - high band (> `splitHz`): a 1 ms bin `thresholdDb` over the median is a click when no bin
//    3-6 ms away is `isolationDb` over it, or when it belongs to a short click (below).
//  - mid band (`midSplitHz`..`splitHz`) carries the voice, so only short clicks count: a run of
//    bins `isolationDb` over the median, at most 6 ms long, whose peak clears `midThresholdDb`,
//    that shows in the high band too (a click is broadband, a glottal pulse is not) and has no
//    similar burst 6-14 ms before or after its peak (that is a voice's pulse train, one pulse per
//    pitch period).
// Latency: contextMs + 22 ms.
class VoiceDeclickProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.bin = Math.round(sampleRate / 1000);
    this.ctx = Math.round(o.contextMs ?? 15);
    this.guard = 2;
    this.maxRun = 6;
    this.period = [6, 14];
    this.reach = this.maxRun + this.period[1]; // bins needed on each side of the decided one
    this.threshold = o.thresholdDb ?? 14;
    this.midThreshold = o.midThresholdDb ?? 10;
    this.midHighMin = o.midHighMinDb ?? 6; // high-band excess that marks a mid burst as broadband
    this.isoDb = o.isolationDb ?? 10;
    this.minDb = o.minDb ?? -60;
    this.keepDb = o.keepDb ?? 2;

    // 2nd-order Butterworth low/highpass (bilinear), each cascaded twice for a steeper split.
    const design = (hz) => {
      const t = Math.tan((Math.PI * hz) / sampleRate);
      const k = t * t, q = Math.SQRT2 * t, d = 1 + q + k;
      const a = [(2 * (k - 1)) / d, (1 - q + k) / d];
      return { lp: [k / d, (2 * k) / d, k / d, ...a], hp: [1 / d, -2 / d, 1 / d, ...a] };
    };
    const hi = design(o.splitHz ?? 3500), mid = design(o.midSplitHz ?? 400);
    this.belowMid = [mid.lp, mid.lp];
    this.belowHigh = [hi.lp, hi.lp];
    this.detHigh = [hi.hp, hi.hp];
    this.detMid = [mid.hp, mid.hp, hi.lp, hi.lp];
    this.z = new Float64Array(20);
    this.attackCoef = Math.exp(-1 / ((o.attackMs ?? 0.5) / 1000 * sampleRate));
    this.releaseCoef = Math.exp(-1 / ((o.releaseMs ?? 2) / 1000 * sampleRate));

    this.nBins = 2 * this.ctx + 2 * this.reach + 3;
    const band = () => ({
      levels: new Float32Array(this.nBins).fill(-140),
      excess: new Float32Array(this.nBins),
      targets: new Float32Array(this.nBins).fill(1),
      acc: 0,
      gain: 1,
    });
    this.high = band();
    this.mid = band();
    this.newest = 0;
    this.fill = 0;
    this.sorted = new Float32Array(this.nBins);
    this.run = [0, 0];

    // Audio leaves while it belongs to bins d-1..d (d = -ctx - reach), whose targets and their
    // older neighbour's are decided.
    this.delaySize = (this.ctx + this.reach + 2) * this.bin;
    this.delays = [0, 1, 2].map(() => new Float32Array(this.delaySize));
    this.pos = 0;
  }

  idx(offset) {
    const i = (this.newest + offset) % this.nBins;
    return i < 0 ? i + this.nBins : i;
  }

  cascade(x, sections, s) {
    for (const [b0, b1, b2, a1, a2] of sections) {
      const y = b0 * x + this.z[s];
      this.z[s] = b1 * x - a1 * y + this.z[s + 1];
      this.z[s + 1] = b2 * x - a2 * y;
      x = y;
      s += 2;
    }
    return x;
  }

  // Excess of the bin `ctx` behind the newest over the median of its context.
  measure(b) {
    const c = -this.ctx;
    let n = 0;
    for (let k = -this.ctx; k <= this.ctx; k++) {
      if (Math.abs(k) <= this.guard) continue;
      this.sorted[n++] = b.levels[this.idx(c + k)];
    }
    const median = this.sorted.subarray(0, n).sort()[n >> 1];
    const lv = b.levels[this.idx(c)];
    b.excess[this.idx(c)] = lv > this.minDb ? lv - median : 0;
  }

  // Whether bin d stands alone in band b: nothing `isolationDb` over the median 3-6 ms away.
  isolated(b, d) {
    for (let k = 3; k <= 6; k++) {
      if (b.excess[this.idx(d - k)] >= this.isoDb || b.excess[this.idx(d + k)] >= this.isoDb) return false;
    }
    return true;
  }

  // Whether bin d is part of a short click in band b; its run of bins is left in this.run.
  inShortClick(b, d, threshold) {
    const ex = (k) => b.excess[this.idx(k)];
    if (ex(d) < this.isoDb) return false;
    let l = d, r = d;
    while (d - l < this.maxRun && ex(l - 1) >= this.isoDb) l--;
    while (r - d < this.maxRun && ex(r + 1) >= this.isoDb) r++;
    if (r - l + 1 > this.maxRun) return false;
    let p = l;
    for (let k = l; k <= r; k++) if (ex(k) > ex(p)) p = k;
    const peak = ex(p);
    if (peak < threshold) return false;
    const similar = Math.max(this.isoDb, peak - 4); // a pitch-period neighbour this close in level is a voice pulse
    for (let k = this.period[0]; k <= this.period[1]; k++) {
      if (ex(p - k) >= similar || ex(p + k) >= similar) return false;
    }
    this.run[0] = l;
    this.run[1] = r;
    return true;
  }

  // Targets for the bin `reach` older than the last measured one: the bins it needs on both sides
  // now have an excess.
  decide() {
    this.measure(this.high);
    this.measure(this.mid);
    const d = -this.ctx - this.reach;
    const duck = (b) => Math.min(1, Math.pow(10, -(b.excess[this.idx(d)] - this.keepDb) / 20));
    const high = this.high, mid = this.mid;
    const highClick = (high.excess[this.idx(d)] >= this.threshold && this.isolated(high, d)) || this.inShortClick(high, d, this.threshold);
    high.targets[this.idx(d)] = highClick ? duck(high) : 1;
    let midClick = this.inShortClick(mid, d, this.midThreshold);
    if (midClick) {
      let highMax = -Infinity;
      for (let k = this.run[0] - 1; k <= this.run[1] + 1; k++) highMax = Math.max(highMax, high.excess[this.idx(k)]);
      midClick = highMax >= this.midHighMin;
    }
    mid.targets[this.idx(d)] = midClick ? duck(mid) : 1;
  }

  gainOf(b) {
    const d = -this.ctx - this.reach;
    const t = b.targets;
    const target = Math.min(t[this.idx(d - 2)], t[this.idx(d - 1)], t[this.idx(d)]);
    b.gain = target + (b.gain - target) * (target < b.gain ? this.attackCoef : this.releaseCoef);
    return b.gain;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;
    const [lowD, midD, highD] = this.delays;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const belowMid = this.cascade(x, this.belowMid, 0);
      const belowHigh = this.cascade(x, this.belowHigh, 4);
      const dh = this.cascade(x, this.detHigh, 8);
      const dm = this.cascade(x, this.detMid, 12);
      this.high.acc += dh * dh;
      this.mid.acc += dm * dm;
      if (++this.fill === this.bin) {
        this.newest = this.idx(1);
        for (const b of [this.high, this.mid]) {
          b.levels[this.newest] = 10 * Math.log10(b.acc / this.bin + 1e-14);
          b.excess[this.newest] = 0;
          b.targets[this.newest] = 1;
          b.acc = 0;
        }
        this.fill = 0;
        this.decide();
      }

      const out = lowD[this.pos] + midD[this.pos] * this.gainOf(this.mid) + highD[this.pos] * this.gainOf(this.high);
      lowD[this.pos] = belowMid;
      midD[this.pos] = belowHigh - belowMid;
      highD[this.pos] = x - belowHigh;
      this.pos = this.pos + 1 === this.delaySize ? 0 : this.pos + 1;
      output[i] = out;
    }
    return true;
  }
}

registerProcessor('voice-declick', VoiceDeclickProcessor);
