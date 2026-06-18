// SIGNAL STABILIZATION: 1D KALMAN FILTER
    // ------------------------------------------------------------------------
    class KnuckleKalmanFilter {
      constructor(processNoise = 0.02, measurementNoise = 0.4, estimationError = 2.0, initialValue = 60.0) {
        this.q = processNoise;       // Process noise covariance (higher = filters less, adapts faster)
        this.r = measurementNoise;   // Measurement noise covariance (higher = filters more)
        this.p = estimationError;    // Estimation error covariance
        this.x = initialValue;       // Current state estimate
        this.k = 0;                  // Kalman gain
      }

      update(measurement) {
        // Prediction Update
        this.p = this.p + this.q;

        // Measurement Update
        this.k = this.p / (this.p + this.r);
        this.x = this.x + this.k * (measurement - this.x);
        this.p = (1 - this.k) * this.p;

        return this.x;
      }

      reset(val = 60.0) {
        this.x = val;
        this.p = 2.0;
        this.k = 0;
      }
    }

    // ------------------------------------------------------------------------
    // SIGNAL STABILIZATION: ONE-EURO FILTER
    // ------------------------------------------------------------------------
    class LowPassFilter {
      constructor(alpha, initValue = 0) {
        this.y = initValue;
        this.s = initValue;
        this.alpha = alpha;
      }
      filter(value, alpha) {
        if (alpha !== undefined) this.alpha = alpha;
        this.y = value;
        this.s = this.alpha * value + (1 - this.alpha) * this.s;
        return this.s;
      }
      reset(initValue = 0) {
        this.y = initValue;
        this.s = initValue;
      }
    }

    class OneEuroFilter {
      constructor(freq, mincutoff = 1.0, beta = 0.0, dcutoff = 1.0) {
        this.freq = freq;
        this.mincutoff = mincutoff;
        this.beta = beta;
        this.dcutoff = dcutoff;
        
        this.x = new LowPassFilter(this.alpha(mincutoff));
        this.dx = new LowPassFilter(this.alpha(dcutoff));
        this.lastTime = null;
      }
      
      alpha(cutoff) {
        const tau = 1.0 / (2.0 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau * this.freq);
      }
      
      filter(value, timestamp) {
        if (this.lastTime !== null && timestamp !== undefined) {
          const dt = (timestamp - this.lastTime) / 1000.0;
          if (dt > 0) this.freq = 1.0 / dt;
        }
        this.lastTime = timestamp || Date.now();
        
        const dval = (value - this.x.s) * this.freq;
        const edval = this.dx.filter(dval, this.alpha(this.dcutoff));
        const cutoff = this.mincutoff + this.beta * Math.abs(edval);
        
        return this.x.filter(value, this.alpha(cutoff));
      }

      reset() {
        this.x.reset(0);
        this.dx.reset(0);
        this.lastTime = null;
      }
    }

    class OneEuroFilter3D {
      constructor(freq, mincutoff = 1.0, beta = 0.0, dcutoff = 1.0) {
        this.filtX = new OneEuroFilter(freq, mincutoff, beta, dcutoff);
        this.filtY = new OneEuroFilter(freq, mincutoff, beta, dcutoff);
        this.filtZ = new OneEuroFilter(freq, mincutoff, beta, dcutoff);
      }

      filter(val, timestamp, out) {
        const target = out || [0, 0, 0];
        target[0] = this.filtX.filter(val[0], timestamp);
        target[1] = this.filtY.filter(val[1], timestamp);
        target[2] = this.filtZ.filter(val[2], timestamp);
        return target;
      }

      reset() {
        this.filtX.reset();
        this.filtY.reset();
        this.filtZ.reset();
      }
    }

    // ------------------------------------------------------------------------
    // SLIDING WINDOW FILTERS (FOR SHIVER / TREMOR RESISTANCE)
    // ------------------------------------------------------------------------
    function getTrimmedMean(arr, trimPercentage = 0.2) {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const trimCount = Math.floor(sorted.length * trimPercentage);
      // Ensure we don't trim everything away for small arrays
      const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
      if (trimmed.length === 0) {
        return sorted[Math.floor(sorted.length / 2)];
      }
      const sum = trimmed.reduce((acc, val) => acc + val, 0);
      return sum / trimmed.length;
    }

    function getStandardDeviation(arr) {
      if (arr.length <= 1) return 0;
      const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
      const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (arr.length - 1);
      return Math.sqrt(variance);
    }

    