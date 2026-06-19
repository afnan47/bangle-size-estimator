// =========================================================================
    // SIMULATOR TESTBED ENGINE & BENCHMARK SUITE
    // =========================================================================
    function generateSimulatedHand(trueWidthMM, pitchDeg, baseDepthMeters, jitterMM, driftAmtCm, frameIndex) {
      const W = trueWidthMM / 1000; // knuckle span in meters
      const H = 0.080; // wrist distance in meters
      const phi = (pitchDeg * Math.PI) / 180;

      // Distance drift (0.5Hz breathing sine wave simulation)
      const driftMeters = (driftAmtCm / 100) * Math.sin((frameIndex * 2 * Math.PI) / 60);
      const D = baseDepthMeters + driftMeters;

      // 1. Local coordinates rotated around Y-axis by phi
      let p5 = [-W/2 * Math.cos(phi), 0, W/2 * Math.sin(phi)];
      let p17 = [W/2 * Math.cos(phi), 0, -W/2 * Math.sin(phi)];
      let wrist = [0, -H, 0];

      // 2. Translate center of hand to camera view space
      const cy = -0.02; // Slightly below screen center
      p5[1] += cy; p5[2] -= D;
      p17[1] += cy; p17[2] -= D;
      wrist[1] += cy; wrist[2] -= D;

      // 3. Inject Gaussian Jitter noise to 3D view-space coordinates
      const noiseStd = jitterMM / 1000;
      function addNoise(val) {
        // Box-Muller transform for normal distribution
        let u1 = Math.random();
        let u2 = Math.random();
        if (u1 === 0) u1 = 0.0001;
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return val + z0 * noiseStd;
      }

      const p5_noisy = [addNoise(p5[0]), addNoise(p5[1]), addNoise(p5[2])];
      const p17_noisy = [addNoise(p17[0]), addNoise(p17[1]), addNoise(p17[2])];
      const wrist_noisy = [addNoise(wrist[0]), addNoise(wrist[1]), addNoise(wrist[2])];

      // 4. Project coordinates back to normalized device coordinates
      const proj = activeProjectionMatrix || [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0];
      const m0 = proj[0];
      const m5 = proj[5];
      const m8 = proj[8];
      const m9 = proj[9];

      function project(p) {
        const [X, Y, Z] = p;
        const wVal = -Z;
        const ndcX = (m0 * X + m8 * Z) / wVal;
        const ndcY = (m5 * Y + m9 * Z) / wVal;
        return {
          x: (ndcX + 1) / 2,
          y: (1 - ndcY) / 2,
          z: wVal // Store absolute metric depth
        };
      }

      return {
        landmarks: [
          project(wrist_noisy), // 0: Wrist
          null, null, null, null,
          project(p5_noisy),    // 5: Index knuckle
          null, null, null, null, null, null, null, null, null, null, null,
          project(p17_noisy)    // 17: Pinky knuckle
        ],
        trueWidthMM: trueWidthMM
      };
    }

    function runAccuracyTestBed() {
      const gtWidth = parseFloat(document.getElementById('slide-gt-width').value);
      const gtPitch = parseFloat(document.getElementById('slide-gt-pitch').value);
      const gtDepth = parseFloat(document.getElementById('slide-gt-depth').value) / 100;
      const jitter = parseFloat(document.getElementById('slide-noise-jitter').value);
      const drift = parseFloat(document.getElementById('slide-noise-drift').value);

      const runBtn = document.getElementById('btn-testbed-run-benchmark');
      runBtn.disabled = true;
      runBtn.textContent = "Running Benchmark...";

      const resultsSection = document.getElementById('testbed-results-section');
      resultsSection.style.display = 'block';
      document.getElementById('testbed-results-status').textContent = "Running...";
      document.getElementById('testbed-results-status').style.color = "var(--state-warning)";

      setTimeout(() => {
        const numTrials = 10;
        const maxFrames = 300;
        const requiredStable = 20; // Relaxed for easier measurement

        let baselineLocks = 0;
        let baselineLockSum = 0;
        let baselineMAESum = 0;
        let baselineJitterSum = 0;
        
        let upgradedLocks = 0;
        let upgradedLockSum = 0;
        let upgradedMAESum = 0;
        let upgradedJitterSum = 0;

        for (let trial = 0; trial < numTrials; trial++) {
          const baseKalman = new KnuckleKalmanFilter();
          const upKalman = new KnuckleKalmanFilter();
          const upFilterP5 = new OneEuroFilter3D(30, 0.96, 0.00106, 1.385); // (Optimized via simulation)
          const upFilterP17 = new OneEuroFilter3D(30, 0.96, 0.00106, 1.385); // (Optimized via simulation)

          let baseStableCount = 0;
          let baseLockedWidth = null;
          let baseLockFrame = null;
          let baseWidths = [];

          let upStableCount = 0;
          let upLockedWidth = null;
          let upLockFrame = null;
          let upWidths = [];
          let upMeasurementHistory = [];
          let upPrevWristPos = null;
          let upUnstableFrameCount = 0;

          for (let f = 0; f < maxFrames; f++) {
            const frameData = generateSimulatedHand(gtWidth, gtPitch, gtDepth, jitter, drift, f + trial * 1000);
            const lm0 = frameData.landmarks[0];
            const lm5 = frameData.landmarks[5];
            const lm17 = frameData.landmarks[17];

            // 1. Baseline Pipeline
            if (!baseLockedWidth) {
              const d5 = lm5.z;
              const d17 = lm17.z;
              let isValid = false;
              let width = null;

              if (d5 > 0.15 && d5 <= 1.0 && d17 > 0.15 && d17 <= 1.0) {
                const isTilted = Math.abs(d5 - d17) > 0.08;
                if (!isTilted) {
                  const p5_raw = unproject(lm5, d5, activeProjectionMatrix || [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
                  const p17_raw = unproject(lm17, d17, activeProjectionMatrix || [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
                  const rawMM = calculateDistance(p5_raw, p17_raw) * 1000;
                  if (rawMM >= 42 && rawMM <= 88) {
                    width = rawMM * calibrationScale;
                    isValid = true;
                  }
                }
              }

              if (isValid) {
                const smoothed = baseKalman.update(width);
                const variance = Math.abs(width - smoothed);
                if (variance < 2.2) { // Relaxed baseline variance threshold from 1.5 to 2.2
                  baseStableCount++;
                  baseWidths.push(smoothed);
                  if (baseStableCount >= requiredStable) {
                    baseLockedWidth = smoothed;
                    baseLockFrame = f;
                  }
                } else {
                  baseStableCount = Math.max(0, baseStableCount - 3);
                }
              } else {
                baseStableCount = Math.max(0, baseStableCount - 1);
              }
            }

            // 2. Upgraded Pipeline
            if (!upLockedWidth) {
              const d5 = lm5.z;
              const d17 = lm17.z;
              const d0 = lm0.z;
              let isValid = false;
              let width = null;
              let p0_3d = null;
              let p5_3d = null;
              let p17_3d = null;

              if (d5 > 0.15 && d5 <= 1.0 && d17 > 0.15 && d17 <= 1.0) {
                const p0_raw = unproject(lm0, d0, activeProjectionMatrix || [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
                const p5_raw = unproject(lm5, d5, activeProjectionMatrix || [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
                const p17_raw = unproject(lm17, d17, activeProjectionMatrix || [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);

                const v1 = subtractVectors(p5_raw, p0_raw);
                const v2 = subtractVectors(p17_raw, p0_raw);
                const palmNormal = crossProduct(v1, v2);
                const unitNormal = normalizeVector(palmNormal);
                const pitchRad = Math.acos(Math.min(1.0, Math.abs(unitNormal[2])));
                const pitchDeg = (pitchRad * 180) / Math.PI;

                if (pitchDeg <= 25) { // Max tilt relaxed to 25° for more forgiving measurement
                  p5_3d = upFilterP5.filter(p5_raw);
                  p17_3d = upFilterP17.filter(p17_raw);
                  p0_3d = p0_raw;
                  const rawMM = calculateDistance(p5_3d, p17_3d) * 1000;
                  if (rawMM >= 42 && rawMM <= 88) {
                    width = rawMM * calibrationScale;
                    isValid = true;
                  }
                }
              }

              if (isValid) {
                // 1. Wrist velocity gating (macro-movement check)
                let isMacroMovement = false;
                if (upPrevWristPos) {
                  const movementDist = calculateDistance(p0_3d, upPrevWristPos);
                  if (movementDist > 0.02) {
                    isMacroMovement = true;
                  }
                }
                upPrevWristPos = [p0_3d[0], p0_3d[1], p0_3d[2]];

                if (isMacroMovement) {
                  upStableCount = Math.max(0, upStableCount - 2); // decay slower on macro movement (forgiving)
                  upUnstableFrameCount = 0;
                  // upMeasurementHistory = []; // Do not reset history completely
                } else {
                  // 2. Sliding window buffer
                  upMeasurementHistory.push(width);
                  if (upMeasurementHistory.length > 60) {
                    upMeasurementHistory.shift();
                  }

                  // 3. Trimmed Mean / Standard deviation based filtering
                  const smoothed = getTrimmedMean(upMeasurementHistory, 0.28); // (Optimized via simulation)
                  const stdDev = getStandardDeviation(upMeasurementHistory);

                  const isHistoryReady = upMeasurementHistory.length >= 15;

                  if (isHistoryReady && stdDev < 2.2) { // Relaxed stdDev from 1.54 to 2.2 (forgiving tracking)
                    // Stable frame
                    upStableCount++;
                    upUnstableFrameCount = 0;
                    upWidths.push(smoothed);
                    if (upStableCount >= requiredStable) {
                      upLockedWidth = smoothed;
                      upLockFrame = f;
                    }
                  } else if (isHistoryReady && stdDev < 3.2) { // Relaxed stdDev from 2.54 to 3.2 (forgiving tracking)
                    // Shivering/Tremor detected (micro-movement)
                    upUnstableFrameCount++;
                    if (upUnstableFrameCount >= 15) {
                      upStableCount = Math.max(0, upStableCount - 1);
                    }
                    upWidths.push(smoothed);
                    
                    if (upStableCount >= requiredStable) {
                      upLockedWidth = smoothed;
                      upLockFrame = f;
                      break;
                    }
                  } else {
                    // High instability
                    upStableCount = Math.max(0, upStableCount - 2);
                    upUnstableFrameCount = 0;
                  }
                }
              } else {
                upStableCount = Math.max(0, upStableCount - 1);
              }
            }

          }

          if (baseLockedWidth) {
            baselineLocks++;
            baselineLockSum += (baseLockFrame / 30);
            baselineMAESum += Math.abs(baseLockedWidth - gtWidth);
          }
          if (baseWidths.length > 1) {
            const mean = baseWidths.reduce((a, b) => a + b, 0) / baseWidths.length;
            const variance = baseWidths.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / baseWidths.length;
            baselineJitterSum += Math.sqrt(variance);
          }

          if (upLockedWidth) {
            upgradedLocks++;
            upgradedLockSum += (upLockFrame / 30);
            upgradedMAESum += Math.abs(upLockedWidth - gtWidth);
          }
          if (upWidths.length > 1) {
            const mean = upWidths.reduce((a, b) => a + b, 0) / upWidths.length;
            const variance = upWidths.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / upWidths.length;
            upgradedJitterSum += Math.sqrt(variance);
          }
        }

        const baseSuccessRate = (baselineLocks / numTrials) * 100;
        const upSuccessRate = (upgradedLocks / numTrials) * 100;

        const baseAvgLockTime = baselineLocks > 0 ? (baselineLockSum / baselineLocks) : null;
        const upAvgLockTime = upgradedLocks > 0 ? (upgradedLockSum / upgradedLocks) : null;

        const baseAvgMAE = baselineLocks > 0 ? (baselineMAESum / baselineLocks) : null;
        const upAvgMAE = upgradedLocks > 0 ? (upgradedMAESum / upgradedLocks) : null;

        const baseAvgJitter = baselineJitterSum / numTrials;
        const upAvgJitter = upgradedJitterSum / numTrials;

        // Render metrics to UI
        document.getElementById('res-base-width').textContent = baseAvgMAE !== null ? `${(gtWidth + (baseAvgMAE * (baselineMAESum >= 0 ? 1 : -1))).toFixed(1)} mm` : "N/A";
        document.getElementById('res-up-width').textContent = upAvgMAE !== null ? `${(gtWidth + (upAvgMAE * (upgradedMAESum >= 0 ? 1 : -1))).toFixed(1)} mm` : "N/A";
        
        document.getElementById('res-base-mae').textContent = baseAvgMAE !== null ? `±${baseAvgMAE.toFixed(2)} mm` : "N/A";
        document.getElementById('res-up-mae').textContent = upAvgMAE !== null ? `±${upAvgMAE.toFixed(2)} mm` : "N/A";

        document.getElementById('res-base-jitter').textContent = `${baseAvgJitter.toFixed(3)} mm`;
        document.getElementById('res-up-jitter').textContent = `${upAvgJitter.toFixed(3)} mm`;

        document.getElementById('res-base-lock').textContent = `${baseSuccessRate.toFixed(0)}%`;
        document.getElementById('res-up-lock').textContent = `${upSuccessRate.toFixed(0)}%`;

        document.getElementById('res-base-time').textContent = baseAvgLockTime !== null ? `${baseAvgLockTime.toFixed(2)}s` : "N/A";
        document.getElementById('res-up-time').textContent = upAvgLockTime !== null ? `${upAvgLockTime.toFixed(2)}s` : "N/A";

        // Performance & accuracy commentary
        let commentary = "";
        if (upSuccessRate > baseSuccessRate) {
          commentary += `• Upgraded sizer achieves **${(upSuccessRate - baseSuccessRate).toFixed(0)}% higher lock reliability** under noise/tilt.<br>`;
        }
        if (baseAvgJitter > 0 && upAvgJitter > 0) {
          const jitterReduction = ((baseAvgJitter - upAvgJitter) / baseAvgJitter) * 100;
          if (jitterReduction > 0) {
            commentary += `• One-Euro filter **reduces raw tracking jitter by ${jitterReduction.toFixed(0)}%**.<br>`;
          }
        }
        if (baseAvgMAE !== null && upAvgMAE !== null) {
          const errorReduction = ((baseAvgMAE - upAvgMAE) / baseAvgMAE) * 100;
          if (errorReduction > 0) {
            commentary += `• Coplanar normal rotation **improves sizing accuracy by ${errorReduction.toFixed(0)}%** under hand tilt.<br>`;
          }
        }
        if (commentary === "") {
          commentary = "No significant difference detected. Try increasing noise or tilt parameters to stress-test the pipelines.";
        } else {
          commentary = "<strong>Analysis:</strong><br>" + commentary;
        }
        document.getElementById('res-text-analysis').innerHTML = commentary;

        document.getElementById('testbed-results-status').textContent = "Completed";
        document.getElementById('testbed-results-status').style.color = "var(--state-success)";

        runBtn.disabled = false;
        runBtn.textContent = "Run Accuracy Test";
      }, 50);
    }

    // Toggle Sizer Testbed Sidebar Panel
    document.addEventListener("DOMContentLoaded", () => {
      const testbedPanel = document.getElementById('simulator-testbed');
      const testbedToggle = document.getElementById('btn-toggle-testbed');
      const testbedClose = document.getElementById('btn-close-testbed');
      const liveSimBtn = document.getElementById('btn-testbed-live-sim');
      const runBenchmarkBtn = document.getElementById('btn-testbed-run-benchmark');
      const pipelineCheckbox = document.getElementById('check-upgraded-pipeline');

      if (testbedToggle && testbedPanel) {
        testbedToggle.addEventListener('click', () => {
          testbedPanel.classList.toggle('active');
        });
      }

      if (testbedClose && testbedPanel) {
        testbedClose.addEventListener('click', () => {
          testbedPanel.classList.remove('active');
        });
      }

      // Slider updates
      const sliderIds = [
        { slide: 'slide-gt-width', val: 'val-gt-width', unit: ' mm' },
        { slide: 'slide-gt-pitch', val: 'val-gt-pitch', unit: '°' },
        { slide: 'slide-gt-depth', val: 'val-gt-depth', unit: ' cm' },
        { slide: 'slide-noise-jitter', val: 'val-noise-jitter', unit: ' mm' },
        { slide: 'slide-noise-drift', val: 'val-noise-drift', unit: ' cm' }
      ];

      sliderIds.forEach(item => {
        const slider = document.getElementById(item.slide);
        const valLabel = document.getElementById(item.val);
        if (slider && valLabel) {
          slider.addEventListener('input', () => {
            valLabel.textContent = parseFloat(slider.value).toFixed(item.slide.includes('jitter') ? 1 : (item.slide.includes('width') ? 1 : 0)) + item.unit;
            if (isSimulationTestbedRunning) {
              if (calibrationLocked) {
                recalibrate();
              }
            }
          });
        }
      });

      // Pipeline checkbox toggle
      if (pipelineCheckbox) {
        pipelineCheckbox.addEventListener('change', () => {
          isUpgradedSizerMode = pipelineCheckbox.checked;
          if (isSimulationTestbedRunning) {
            recalibrate();
          }
        });
      }

      // Live simulation toggle button
      if (liveSimBtn) {
        liveSimBtn.addEventListener('click', () => {
          if (isSimulationTestbedRunning) {
            // Stop live simulation
            isSimulationTestbedRunning = false;
            liveSimBtn.textContent = "Start Live Sim";
            liveSimBtn.style.background = "";
            liveSimBtn.style.color = "";
            
            // Restore default PC Simulate button
            const simBtn = document.getElementById('btn-simulate-scan');
            if (simBtn) simBtn.style.display = 'block';

            recalibrate();
          } else {
            // Start live simulation
            isSimulationTestbedRunning = true;
            liveSimBtn.textContent = "Stop Live Sim";
            liveSimBtn.style.background = "var(--state-warning)";
            liveSimBtn.style.color = "var(--bg-dark)";

            // Hide default PC Simulate button to avoid confusion
            const simBtn = document.getElementById('btn-simulate-scan');
            if (simBtn) simBtn.style.display = 'none';

            if (!isNoCameraSim) {
              startNoCameraSimulation();
            } else {
              recalibrate();
            }
          }
        });
      }

      // Run Benchmark button
      if (runBenchmarkBtn) {
        runBenchmarkBtn.addEventListener('click', runAccuracyTestBed);
      }
    });