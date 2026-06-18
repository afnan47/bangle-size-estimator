// HAND DETECTION & COORDINATE TRANSLATION
    // ------------------------------------------------------------------------
    console.log("Initializing MediaPipe Hands Detector...");
    const handsDetector = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    console.log("MediaPipe Hands Detector created.");

    handsDetector.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.8,
      minTrackingConfidence: 0.8
    });
    console.log("MediaPipe Hands options configured.");

    handsDetector.onResults((results) => {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Clear overlay canvas for active tracking draw
        if (overlayCtx && overlayCanvas) {
          overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        lastRenderedState = "tracking";

        if (!handFirstDetected) {
          handFirstDetected = true;
          console.log("SUCCESS: MediaPipe Hands detected a hand!");
        }
        if (frameCount % 60 === 0) {
          console.log("Periodic: Hand actively tracked. Landmarks count: " + results.multiHandLandmarks[0].length);
        }
        processHandLandmarks(results.multiHandLandmarks[0]);
      } else {
        if (frameCount % 60 === 0) {
          console.log("Periodic: No hands detected by MediaPipe in this frame.");
        }
        // Reset calibration progress if hand is lost
        stableMeasurementCount = Math.max(0, stableMeasurementCount - 2); 
        const progress = Math.round((stableMeasurementCount / REQUIRED_STABLE_FRAMES) * 100);
        const instructionText = isWebcamDemo 
          ? 'Hold phone 12" (30cm) directly above your hand. Squeeze knuckles tight.'
          : "Point camera at hand. Squeeze your knuckles tight.";
        updateHUD("Searching...", "-.- cm", progress, instructionText);
        
        // Selective render: Only clear and redraw stencil when entering searching state
        if (lastRenderedState !== "searching") {
          if (overlayCtx && overlayCanvas) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            drawHandStencil(overlayCtx, overlayCanvas.width, overlayCanvas.height);
          }
          lastRenderedState = "searching";
        }
      }
    });

    async function detectHandLandmarks(imageSource, xrView = null) {
      if (xrView) {
        activeProjectionMatrix = xrView.projectionMatrix;
      }
      const startTime = performance.now();
      await handsDetector.send({ image: imageSource });
      lastDetectionTimeMs = performance.now() - startTime;

      // Adaptive Throttling: balance latency vs CPU heat / battery
      if (lastDetectionTimeMs > 60) {
        // Slow device: throttle hard to prevent render frame drops
        trackingThrottleRate = 6;
      } else if (lastDetectionTimeMs > 40) {
        trackingThrottleRate = 4;
      } else {
        // Fast device: adjust based on tracking stability to save power
        if (stableMeasurementCount > 12) {
          trackingThrottleRate = 6; // Steady tracking, sample slower
        } else if (stableMeasurementCount > 5) {
          trackingThrottleRate = 4;
        } else {
          trackingThrottleRate = 3; // Searching or unstable, sample fast
        }
      }
    }

    // Exact 3D view-space coordinates calculation without needing gl-matrix library
    function unproject(lm, depth, projectionMatrix, out) {
      // 1. Convert normalized MediaPipe coordinates to Normalized Device Coordinates (NDC)
      // MediaPipe x: [0, 1] (left to right), y: [0, 1] (top to bottom)
      // NDC x: [-1, 1] (left to right), y: [-1, 1] (bottom to top)
      const ndcX = 2 * lm.x - 1;
      const ndcY = 1 - 2 * lm.y;

      // 2. Extract specific elements from the 4x4 column-major projection matrix
      const m0 = projectionMatrix[0];  // M00 (Perspective X-scaling)
      const m5 = projectionMatrix[5];  // M11 (Perspective Y-scaling)
      const m8 = projectionMatrix[8];  // M20 (Frustum asymmetric X offset)
      const m9 = projectionMatrix[9];  // M21 (Frustum asymmetric Y offset)

      // 3. Unproject back to 3D camera coordinates in meters
      // X = ((ndcX + M20) / M00) * depth
      // Y = ((ndcY + M21) / M11) * depth
      // Z = -depth (WebGl camera points towards negative Z axis)
      const target = out || [0, 0, 0];
      target[0] = ((ndcX + m8) / m0) * depth;
      target[1] = ((ndcY + m9) / m5) * depth;
      target[2] = -depth;

      return target;
    }

    function getFilteredDepth(depthInfo, u, v) {
      const windowSize = 2; // 5x5 window
      const delta = 0.006;
      let depthValues = [];

      for (let dy = -windowSize; dy <= windowSize; dy++) {
        for (let dx = -windowSize; dx <= windowSize; dx++) {
          const nu = Math.max(0.001, Math.min(0.999, u + dx * delta));
          const nv = Math.max(0.001, Math.min(0.999, v + dy * delta));
          try {
            const val = depthInfo.getDepthInMeters(nu, nv);
            if (val > 0.05 && val < 2.0) {
              depthValues.push(val);
            }
          } catch (e) {
            // Out of bounds
          }
        }
      }

      if (depthValues.length === 0) return 0;
      depthValues.sort((a, b) => a - b);
      return depthValues[Math.floor(depthValues.length / 2)];
    }

    function calculateDistance(p1, p2) {
      return Math.sqrt(
        Math.pow(p1[0] - p2[0], 2) +
        Math.pow(p1[1] - p2[1], 2) +
        Math.pow(p1[2] - p2[2], 2)
      );
    }

    // ------------------------------------------------------------------------
    