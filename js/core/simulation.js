// PC UI/UX TEST SIMULATION ENGINES
    // ------------------------------------------------------------------------
    function startNoCameraSimulation() {
      isWebcamDemo = true;
      isNoCameraSim = true;
      console.log("Initializing PC Camera-less Simulation Mode...");
      
      const container = document.getElementById('ar-container');
      if (container) {
        container.classList.add('simulated-bg');
      }

      // Hide onboarding, show AR container
      screenOnboarding.classList.add('hidden');
      arContainer.style.display = 'block';
      resizeOverlayCanvas();
      recalibrate();
      
      // Mock projection matrix
      activeProjectionMatrix = [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0];

      // Show simulate scan button
      const simBtn = document.getElementById('btn-simulate-scan');
      if (simBtn) simBtn.style.display = 'block';

      // Start rendering loop for camera-less simulation view
      console.log("Launching Camera-less Frame Loop...");
      requestAnimationFrame(onNoCameraFrame);
    }

    function onNoCameraFrame() {
      if (!isNoCameraSim) return;
      frameCount++;

      if (calibrationLocked) {
        drawBangleStaticOverlay();
        lastRenderedState = "locked";
      } else {
        if (isSimulationTestbedRunning) {
          if (overlayCtx && overlayCanvas) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
          const gtWidth = parseFloat(document.getElementById('slide-gt-width').value);
          const gtPitch = parseFloat(document.getElementById('slide-gt-pitch').value);
          const gtDepth = parseFloat(document.getElementById('slide-gt-depth').value) / 100; // cm to m
          const jitter = parseFloat(document.getElementById('slide-noise-jitter').value);
          const drift = parseFloat(document.getElementById('slide-noise-drift').value);

          const frameData = generateSimulatedHand(gtWidth, gtPitch, gtDepth, jitter, drift, frameCount);
          processHandLandmarks(frameData.landmarks);
          lastRenderedState = "testbed";
        } else if (!isSimulatingScan) {
          // Draw dashed guide stencil only when transitioning to searching state
          if (lastRenderedState !== "searching") {
            if (overlayCtx && overlayCanvas) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
              drawHandStencil(overlayCtx, overlayCanvas.width, overlayCanvas.height);
            }
            lastRenderedState = "searching";
          }
        } else {
          if (overlayCtx && overlayCanvas) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
          drawSimulatedFrame();
          lastRenderedState = "simulating";
        }
      }

      requestAnimationFrame(onNoCameraFrame);
    }

    function startSimulatedScan() {
      if (isSimulatingScan) return;
      isSimulatingScan = true;
      simProgressFrame = 0;
      stableMeasurementCount = 0;
      kalmanFilter.reset(60.0);
      
      const simBtn = document.getElementById('btn-simulate-scan');
      if (simBtn) {
        simBtn.disabled = true;
        simBtn.textContent = "Scanning...";
        simBtn.style.opacity = '0.5';
      }

      console.log("PC Simulation Scan initiated.");

      // Sim tick interval (runs ~30 FPS, so 33ms per step)
      simIntervalId = setInterval(tickSimulatedScan, 33);
    }

    function tickSimulatedScan() {
      if (!isSimulatingScan) {
        clearInterval(simIntervalId);
        return;
      }

      simProgressFrame++;
      stableMeasurementCount = simProgressFrame;
      const progressPct = Math.round((simProgressFrame / SIM_TOTAL_FRAMES) * 100);

      // Generate a fluctuating simulated width around 60.3mm (which corresponds to size 2.6)
      const baseWidth = 60.3;
      const noise = (Math.random() - 0.5) * 0.4;
      const rawWidthMM = baseWidth + noise;
      const calibratedWidth = rawWidthMM * calibrationScale;
      smoothedKnuckleWidth = kalmanFilter.update(calibratedWidth);
      lastUncalibratedSmoothedWidth = smoothedKnuckleWidth / calibrationScale;

      // Update HUD
      updateHUD(
        "Calibrating", 
        `${(smoothedKnuckleWidth / 10).toFixed(2)} cm`, 
        progressPct, 
        "Hold perfectly still. Calibrating..."
      );

      // Generate simulated hand positions centered on screen
      const w = overlayCanvas.width;
      const h = overlayCanvas.height;
      const centerX = w / 2;
      const centerY = h / 2 + h * 0.03;
      const scale = Math.min(w, h) * 0.36;

      // Knuckles 5 and 17 coordinates in normalized view space
      const lm5 = { x: (centerX - scale * 0.18) / w, y: centerY / h };
      const lm17 = { x: (centerX + scale * 0.18) / w, y: centerY / h };

      // Mock 3D coordinates in meters at simulated depth
      const depthVal = 0.4; // 40 cm away
      const p5_3d = unproject(lm5, depthVal, activeProjectionMatrix);
      const p17_3d = unproject(lm17, depthVal, activeProjectionMatrix);

      // Store in global hand positions for bangle overlay rendering
      lastValidHandPositions = { p5: p5_3d, p17: p17_3d };

      if (simProgressFrame >= SIM_TOTAL_FRAMES) {
        isSimulatingScan = false;
        clearInterval(simIntervalId);
        
        const simBtn = document.getElementById('btn-simulate-scan');
        if (simBtn) {
          simBtn.disabled = false;
          simBtn.textContent = "Simulate Scan (PC Test)";
          simBtn.style.opacity = '1';
          simBtn.style.display = 'none'; // Hide once locked
        }

        lockCalibration(smoothedKnuckleWidth);
      }
    }

    function drawSimulatedFrame() {
      const w = overlayCanvas.width;
      const h = overlayCanvas.height;
      const centerX = w / 2;
      const centerY = h / 2 + h * 0.03;
      const scale = Math.min(w, h) * 0.36;

      // Mock landmarks array for wireframe drawing
      const mockLandmarks = [
        { x: centerX / w, y: (centerY + scale * 0.5) / h }, // wrist
        null, null, null, null,
        { x: (centerX - scale * 0.18) / w, y: centerY / h }, // knuckle 5 (index)
        null, null, null, null, null, null, null, null, null, null, null,
        { x: (centerX + scale * 0.18) / w, y: centerY / h }  // knuckle 17 (pinky)
      ];

      // Draw hand wireframe and projected circle
      const progressFraction = simProgressFrame / SIM_TOTAL_FRAMES;
      drawHandWireframe(mockLandmarks, true, progressFraction);
      if (lastValidHandPositions) {
        drawProjectedBangleOverlay(
          lastValidHandPositions.p5,
          lastValidHandPositions.p17,
          smoothedKnuckleWidth
        );
      }
    }

    let currentSlide = 0;
    const totalSlides = 3;
    
    // ------------------------------------------------------------------------
    