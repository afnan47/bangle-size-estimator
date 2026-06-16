// TRACKING HANDLER & STABILITY ENGINE
    // ------------------------------------------------------------------------
    function processHandLandmarks(landmarks) {
      if (!xrDepthInfo && !isWebcamDemo && !isSimulationTestbedRunning) {
        updateHUD("Searching...", "-.- cm", 0, "Initializing depth engine... hold phone steady.");
        return;
      }

      // Landmarks 5 (Index knuckle MCP joint) and 17 (Pinky knuckle MCP joint)
      const lm5 = landmarks[5];
      const lm17 = landmarks[17];

      // Clamp normalized coordinates to [0.001, 0.999] to prevent out-of-bounds RangeError
      const clampVal = (val) => Math.max(0.001, Math.min(0.999, val));
      const u5 = clampVal(lm5.x);
      const v5 = clampVal(lm5.y);
      const u17 = clampVal(lm17.x);
      const v17 = clampVal(lm17.y);

      // Query depth values (simulated in demo mode, query sensor in WebXR)
      let depth5 = 0;
      let depth17 = 0;
      let depth0 = 0;

      const lm0 = landmarks[0];
      const u0 = clampVal(lm0.x);
      const v0 = clampVal(lm0.y);

      if (isSimulationTestbedRunning) {
        depth5 = lm5.z;
        depth17 = lm17.z;
        depth0 = lm0.z;
      } else if (isWebcamDemo) {
        // Calculate normalized pixel distance between joints 5 and 17
        const dx = lm5.x - lm17.x;
        const dy = lm5.y - lm17.y;
        const distPixels = Math.sqrt(dx * dx + dy * dy);
        
        // Simulates typical knuckle span of 6.2cm (size 2.6) at current distance
        const simulatedDepth = (0.0625 * 1.29) / (2.0 * Math.max(0.01, distPixels));
        depth5 = depth17 = depth0 = Math.max(0.20, Math.min(1.0, simulatedDepth));
      } else {
        try {
          depth5 = getFilteredDepth(xrDepthInfo, u5, v5);
          depth17 = getFilteredDepth(xrDepthInfo, u17, v17);
          depth0 = getFilteredDepth(xrDepthInfo, u0, v0);
          if (depth0 <= 0.05) depth0 = (depth5 + depth17) / 2;

          if (!depthFirstResolved && (depth5 > 0 || depth17 > 0)) {
            depthFirstResolved = true;
            console.log("SUCCESS: Resolved depth from WebXR (median filter). depth5: " + depth5.toFixed(3) + "m, depth17: " + depth17.toFixed(3) + "m");
          }
        } catch (e) {
          console.error("CRITICAL: Depth sensing lookup failed with error:", e);
        }
      }

      const getProgressPct = () => Math.round((stableMeasurementCount / REQUIRED_STABLE_FRAMES) * 100);

      // Safeguard 1: Check if hand is too close to camera (ideal range is >15cm/0.15m)
      if (depth5 <= 0.15 || depth17 <= 0.15) {
        stableMeasurementCount = Math.max(0, stableMeasurementCount - 1);
        drawHandWireframe(landmarks, false, stableMeasurementCount / REQUIRED_STABLE_FRAMES);
        updateHUD("Unstable", "-.- cm", getProgressPct(), "⚠️ Move hand further away (10-15 inches is ideal)", true);
        return;
      }

      // Safeguard 2: Check if hand is too far from camera (ideal range is <1.0m)
      if (depth5 > 1.0 || depth17 > 1.0) {
        stableMeasurementCount = Math.max(0, stableMeasurementCount - 1);
        drawHandWireframe(landmarks, false, stableMeasurementCount / REQUIRED_STABLE_FRAMES);
        updateHUD("Unstable", "-.- cm", getProgressPct(), "⚠️ Move hand closer to the camera (under 3 feet)", true);
        return;
      }

      // Calculate true 3D spatial points using clamped coordinates
      const p0_raw = unproject({ x: u0, y: v0 }, depth0, activeProjectionMatrix);
      const p5_raw = unproject({ x: u5, y: v5 }, depth5, activeProjectionMatrix);
      const p17_raw = unproject({ x: u17, y: v17 }, depth17, activeProjectionMatrix);

      // Calculate palm plane normal vector and pitch angle tilt relative to camera axis
      const v1 = subtractVectors(p5_raw, p0_raw);
      const v2 = subtractVectors(p17_raw, p0_raw);
      const palmNormal = crossProduct(v1, v2);
      const unitNormal = normalizeVector(palmNormal);
      const palmPitchRad = Math.acos(Math.min(1.0, Math.abs(unitNormal[2])));
      const palmPitchDeg = (palmPitchRad * 180) / Math.PI;

      // Safeguard 3: Check if hand is tilted
      const isTilted = isUpgradedSizerMode ? (palmPitchDeg > 15) : (Math.abs(depth5 - depth17) > 0.08);
      if (isTilted) {
        stableMeasurementCount = Math.max(0, stableMeasurementCount - 1);
        drawHandWireframe(landmarks, false, stableMeasurementCount / REQUIRED_STABLE_FRAMES);
        updateHUD(
          "Unstable", 
          "-.- cm", 
          getProgressPct(), 
          isUpgradedSizerMode 
            ? `⚠️ Keep hand flat. Hand tilted: ${palmPitchDeg.toFixed(0)}° (Max 15°)`
            : "⚠️ Keep hand flat. Do not tilt your hand.", 
          true
        );
        return;
      }

      // Apply One-Euro filter smoothing on 3D landmarks for jitter reduction
      const p5_3d = isUpgradedSizerMode ? filterP5.filter(p5_raw) : p5_raw;
      const p17_3d = isUpgradedSizerMode ? filterP17.filter(p17_raw) : p17_raw;
      const p0_3d = p0_raw;

      // Compute physical distance in mm
      const rawWidthMM = calculateDistance(p5_3d, p17_3d) * 1000;

      // Safeguard 4: Ignore out-of-bounds size measurements (human knuckles usually 50-80mm)
      if (rawWidthMM < 42 || rawWidthMM > 88) {
        stableMeasurementCount = Math.max(0, stableMeasurementCount - 1);
        drawHandWireframe(landmarks, false, stableMeasurementCount / REQUIRED_STABLE_FRAMES);
        updateHUD("Unstable", "-.- cm", getProgressPct(), "⚠️ Knuckles misaligned. Squeeze hand tightly.", true);
        return;
      }

      // Apply calibration scale factor from local storage
      const calibratedWidth = rawWidthMM * calibrationScale;

      // Apply Kalman filter smoothing
      smoothedKnuckleWidth = kalmanFilter.update(calibratedWidth);
      
      // Store uncalibrated smoothed width for calculation in size correction feedback
      lastUncalibratedSmoothedWidth = smoothedKnuckleWidth / calibrationScale;
      
      const variance = Math.abs(calibratedWidth - smoothedKnuckleWidth);

      // Safeguard 5: Check stability (variance < 1.5mm allows normal camera noise and hand micro-shakes)
      if (variance < 1.5) {
        stableMeasurementCount++;
        // Save knuckle tracking for bangle overlay projection
        lastValidHandPositions = { p5: p5_3d, p17: p17_3d, wrist: p0_3d };
        
        drawHandWireframe(landmarks, true, stableMeasurementCount / REQUIRED_STABLE_FRAMES);
        drawProjectedBangleOverlay(p5_3d, p17_3d, smoothedKnuckleWidth, p0_3d);
        
        updateHUD(
          "Calibrating", 
          `${(smoothedKnuckleWidth / 10).toFixed(2)} cm`, 
          getProgressPct(), 
          "Hold perfectly still. Calibrating..."
        );
        
        // Calibration Success Lock
        if (stableMeasurementCount >= REQUIRED_STABLE_FRAMES) {
          lockCalibration(smoothedKnuckleWidth);
        }
      } else {
        // Decay calibration progress gradually rather than clearing it instantly on single noisy frame
        stableMeasurementCount = Math.max(0, stableMeasurementCount - 3);
        lastValidHandPositions = null;
        
        drawHandWireframe(landmarks, false, stableMeasurementCount / REQUIRED_STABLE_FRAMES);
        updateHUD(
          "Unstable", 
          `${(calibratedWidth / 10).toFixed(2)} cm`, 
          getProgressPct(), 
          "⚠️ Movement detected. Hold hand completely still!", 
          true
        );
      }
    }

    function lockCalibration(finalKnuckleWidth) {
      calibrationLocked = true;
      updateHUD("Success", `${(finalKnuckleWidth / 10).toFixed(2)} cm`, 100, "Measurement Locked!");
      
      // Recommend Bangle size
      const recommendation = getRecommendedBangleSize(finalKnuckleWidth);
      
      // Show results card modal
      setTimeout(() => {
        selectBangleSize(recommendation.size);
        // Display actual measured knuckle width
        document.getElementById('result-width-mm').textContent = `${(finalKnuckleWidth / 10).toFixed(2)} cm`;
        
        resultModal.classList.remove('hidden');
      }, 500);
      if (typeof updateStoreFunnels === 'function') {
        // Pass the final calibrated size string (e.g., "2.6") to the button handler
        updateStoreFunnels(recommendation.size || "2.6"); 
      }
      
    }

    function getRecommendedBangleSize(measuredWidthMM) {
      // Add a 2mm tolerance factor for physical hand compression
      const searchDiameter = measuredWidthMM - 2.0;

      for (let option of BANGLE_SIZES) {
        if (searchDiameter <= option.diameterMM) {
          return option;
        }
      }
      return { size: "2.12+", diameterMM: 69.8, positionPct: 98 };
    }

    // ------------------------------------------------------------------------
    