// VECTOR MATH HELPERS
    // ------------------------------------------------------------------------
    function crossProduct(a, b, out) {
      const target = out || [0, 0, 0];
      const x = a[1] * b[2] - a[2] * b[1];
      const y = a[2] * b[0] - a[0] * b[2];
      const z = a[0] * b[1] - a[1] * b[0];
      target[0] = x;
      target[1] = y;
      target[2] = z;
      return target;
    }
    function subtractVectors(a, b, out) {
      const target = out || [0, 0, 0];
      target[0] = a[0] - b[0];
      target[1] = a[1] - b[1];
      target[2] = a[2] - b[2];
      return target;
    }
    function magnitude(v) {
      return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    }
    function normalizeVector(v, out) {
      const target = out || [0, 0, 0];
      const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      if (len === 0) {
        target[0] = 0;
        target[1] = 0;
        target[2] = 0;
      } else {
        target[0] = v[0] / len;
        target[1] = v[1] / len;
        target[2] = v[2] / len;
      }
      return target;
    }
    function dotProduct(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    // ------------------------------------------------------------------------
    