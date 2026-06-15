// VECTOR MATH HELPERS
    // ------------------------------------------------------------------------
    function crossProduct(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
    }
    function subtractVectors(a, b) {
      return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }
    function magnitude(v) {
      return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    }
    function normalizeVector(v) {
      const len = magnitude(v);
      return len === 0 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
    }
    function dotProduct(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    // ------------------------------------------------------------------------
    