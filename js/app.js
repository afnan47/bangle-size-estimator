    // ------------------------------------------------------------------------
    // ONSCREEN DEBUG CONSOLE LOGGER (OVERRIDE CONSOLE)
    // ------------------------------------------------------------------------
    (function() {
      const debugConsole = document.getElementById('debug-console');
      const debugToggle = document.getElementById('btn-toggle-debug');
      const debugOutput = document.getElementById('debug-log-output');

      if (debugToggle && debugConsole) {
        debugToggle.addEventListener('click', () => {
          if (debugConsole.style.display === 'none' || debugConsole.style.display === '') {
            debugConsole.style.display = 'block';
            debugConsole.scrollTop = debugConsole.scrollHeight;
          } else {
            debugConsole.style.display = 'none';
          }
        });
      }

      function logToConsole(type, ...args) {
        const msg = args.map(arg => {
          if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
          if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch(e) { return String(arg); }
          }
          return String(arg);
        }).join(' ');

        const line = document.createElement('div');
        line.style.marginBottom = '6px';
        line.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        line.style.paddingBottom = '4px';

        let color = '#38bdf8'; // light blue
        if (type === 'error') color = '#ef4444'; // red
        if (type === 'warn') color = '#f59e0b'; // amber
        if (type === 'info') color = '#10b981'; // green

        line.style.color = color;
        const timestamp = new Date().toLocaleTimeString();
        line.textContent = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
        
        if (debugOutput) {
          debugOutput.appendChild(line);
          if (debugOutput.childNodes.length > 200) {
            debugOutput.removeChild(debugOutput.firstChild);
          }
          debugConsole.scrollTop = debugConsole.scrollHeight;
        }
      }

      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;

      console.log = (...args) => {
        originalLog.apply(console, args);
        logToConsole('log', ...args);
      };
      console.error = (...args) => {
        originalError.apply(console, args);
        logToConsole('error', ...args);
      };
      console.warn = (...args) => {
        originalWarn.apply(console, args);
        logToConsole('warn', ...args);
      };

      window.addEventListener('error', (e) => {
        logToConsole('error', `Uncaught Script Error: ${e.message} at ${e.filename}:${e.lineno}`);
      });
      window.addEventListener('unhandledrejection', (e) => {
        logToConsole('error', `Unhandled Promise Rejection: ${e.reason}`);
      });

      console.log("Device UserAgent:", navigator.userAgent);
      console.log("WebXR support available:", !!navigator.xr);
    })();

    // ------------------------------------------------------------------------
    // CONSTANTS & CONFIGURATION
    // ------------------------------------------------------------------------
    const REQUIRED_STABLE_FRAMES = 45; // ~1.5s of steady tracking at 30fps
    
    // Standard bangle sizes mapping (Inner diameter in MM)
    const BANGLE_SIZES = [
      { size: "2.2", diameterMM: 54.0, positionPct: 10 },
      { size: "2.4", diameterMM: 57.2, positionPct: 30 },
      { size: "2.6", diameterMM: 60.3, positionPct: 50 },
      { size: "2.8", diameterMM: 63.5, positionPct: 70 },
      { size: "2.10", diameterMM: 66.7, positionPct: 90 }
    ];

    // ------------------------------------------------------------------------
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

      filter(val, timestamp) {
        return [
          this.filtX.filter(val[0], timestamp),
          this.filtY.filter(val[1], timestamp),
          this.filtZ.filter(val[2], timestamp)
        ];
      }

      reset() {
        this.filtX.reset();
        this.filtY.reset();
        this.filtZ.reset();
      }
    }

    // ------------------------------------------------------------------------
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
    // GLOBAL STATE
    // ------------------------------------------------------------------------
    let xrSession = null;
    let xrRefSpace = null;
    let xrDepthInfo = null;
    
    let gl = null;
    let glBinding = null; // WebXR WebGL binding for raw camera access
    let overlayCanvas = null;
    let overlayCtx = null;
    
    // Frame extraction textures & FBO
    let offscreenCanvas = document.createElement('canvas');
    let offscreenCtx = offscreenCanvas.getContext('2d');
    let cameraFBO = null; // FBO bound to WebXR camera texture
    let downsampleFBO = null; // FBO bound to downsampled texture
    let downsampleTexture = null;
    let downsampleWidth = 0;
    let downsampleHeight = 0;
    
    let isProcessingHand = false;
    let calibrationLocked = false;
    let stableMeasurementCount = 0;
    let activeProjectionMatrix = null;
    
    const kalmanFilter = new KnuckleKalmanFilter();
    let smoothedKnuckleWidth = 60.0;
    let calibrationScale = parseFloat(localStorage.getItem('bangle_sizer_calibration_scale')) || 1.0;
    let lastUncalibratedSmoothedWidth = 60.0;
    let isWebcamDemo = false;
    let webcamStream = null;
    let lastValidHandPositions = null; // Stores [{x_view, y_view, z_view}, ...] for rendering bangle circles

    // One-Euro Filters for knuckle landmarks 5 & 17
    const filterP5 = new OneEuroFilter3D(30, 0.5, 0.005, 1.0);
    const filterP17 = new OneEuroFilter3D(30, 0.5, 0.005, 1.0);
    let isUpgradedSizerMode = true; // Enabled by default, can be toggled by the testbed simulation
    let isSimulationTestbedRunning = false;

    // WebGL2 Async Pixel Buffer Objects (PBOs) pack buffers
    let pboBuffers = [null, null];
    let pboFences = [null, null];
    let activePboIndex = 0;
    let isPboInitialized = false;

    // PC UI/UX Test Simulation parameters
    let isNoCameraSim = false;
    let isSimulatingScan = false;
    let simProgressFrame = 0;
    const SIM_TOTAL_FRAMES = 45;
    let simIntervalId = null;
    
    // Debug Logging Trackers
    let frameCount = 0;
    let handFirstDetected = false;
    let depthFirstResolved = false;

    // UI elements
    const screenOnboarding = document.getElementById('screen-onboarding');
    const arContainer = document.getElementById('ar-container');
    const resultModal = document.getElementById('result-modal');
    const errorModal = document.getElementById('error-modal');

    // ------------------------------------------------------------------------
    // APPLICATION LIFECYCLE INITIALIZATION
    // ------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", () => {
      initCarousel();
      document.getElementById('btn-exit-ar').addEventListener('click', stopAR);
      document.getElementById('btn-recalibrate').addEventListener('click', recalibrate);
      document.getElementById('btn-close-results').addEventListener('click', () => {
        resultModal.classList.add('hidden');
        screenOnboarding.classList.remove('hidden');
        // Reset carousel back to slide 0 when exiting results screen
        currentSlide = 0;
        const track = document.getElementById('carousel-track');
        if (track) track.style.transform = `translateX(0%)`;
        const dots = document.querySelectorAll('.carousel-dot');
        dots.forEach((dot, idx) => {
          if (idx === 0) dot.classList.add('active');
          else dot.classList.remove('active');
        });
        const btnNext = document.getElementById('btn-carousel-next');
        if (btnNext) btnNext.innerHTML = 'Next';
      });
      document.getElementById('btn-error-close').addEventListener('click', () => {
        errorModal.classList.add('hidden');
        screenOnboarding.classList.remove('hidden');
      });

      // Attach click events to the sizing ruler ticks for interactive preview
      BANGLE_SIZES.forEach(sz => {
        const id = `tick-${sz.size.replace('.', '-')}`;
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('click', () => {
            selectBangleSize(sz.size);
          });
        }
      });

      // Feedback button Yes click handler
      document.getElementById('btn-feedback-yes').addEventListener('click', () => {
        localStorage.setItem('bangle_sizer_calibration_scale', calibrationScale.toString());
        console.log(`Feedback confirmed: Bangle size correct. Calibration scale: ${calibrationScale.toFixed(4)}`);

        // Hide Yes/No buttons and show success message
        document.querySelector('.feedback-buttons-row').classList.add('hidden');
        document.getElementById('feedback-sizes-container').classList.add('hidden');
        document.getElementById('feedback-success-msg').classList.remove('hidden');
        document.querySelector('.feedback-question').classList.add('hidden');
      });

      // Feedback button No click handler — slide in size correction grid below
      document.getElementById('btn-feedback-no').addEventListener('click', () => {
        const sizesContainer = document.getElementById('feedback-sizes-container');
        if (sizesContainer.classList.contains('hidden')) {
          // Re-trigger animation by removing and re-adding element
          sizesContainer.classList.remove('hidden');
        }
      });

      // Interactive feedback size pills (circle buttons) click handler
      const sizePills = document.querySelectorAll('.btn-feedback-circle');
      sizePills.forEach(pill => {
        pill.addEventListener('click', (e) => {
          const correctSize = e.target.getAttribute('data-size');
          const recommendation = BANGLE_SIZES.find(sz => sz.size === correctSize);
          if (!recommendation) return;

          const targetWidth = recommendation.diameterMM + 2.0;
          if (lastUncalibratedSmoothedWidth > 10.0) {
            const newScale = targetWidth / lastUncalibratedSmoothedWidth;
            calibrationScale = newScale;
            localStorage.setItem('bangle_sizer_calibration_scale', newScale.toString());
            console.log(`Feedback corrected: target size ${correctSize} (${targetWidth.toFixed(1)}mm). New calibration scale: ${newScale.toFixed(4)}`);
          }

          sizePills.forEach(p => p.classList.remove('selected'));
          e.target.classList.add('selected');

          selectBangleSize(correctSize);

          // Hide the whole feedback panel interaction and show success
          document.querySelector('.feedback-buttons-row').classList.add('hidden');
          document.getElementById('feedback-sizes-container').classList.add('hidden');
          document.getElementById('feedback-success-msg').classList.remove('hidden');
          document.querySelector('.feedback-question').classList.add('hidden');
        });
      });
      
      // Initialize drawing layer canvas sizes
      overlayCanvas = document.getElementById('overlay-canvas');
      overlayCtx = overlayCanvas.getContext('2d');
      window.addEventListener('resize', resizeOverlayCanvas);

      // Simulate Scan button listener (PC Test mode)
      const simBtn = document.getElementById('btn-simulate-scan');
      if (simBtn) {
        simBtn.addEventListener('click', startSimulatedScan);
      }

      // Configure debug console and simulation testbed visibility based on environment
      const debugBtn = document.getElementById('btn-toggle-debug');
      const testbedToggle = document.getElementById('btn-toggle-testbed');
      
      if (isLocalTest()) {
        if (debugBtn) debugBtn.style.display = 'block';
        if (testbedToggle) testbedToggle.style.display = 'block';
      } else {
        if (debugBtn) debugBtn.style.display = 'none';
        if (testbedToggle) testbedToggle.style.display = 'none';
      }
    });

    function isLocalTest() {
      const hn = window.location.hostname;
      return hn === 'localhost' || 
             hn === '127.0.0.1' || 
             window.location.protocol === 'file:' || 
             hn.endsWith('.local') ||
             /^192\.168\./.test(hn) ||
             /^10\./.test(hn) ||
             /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hn) ||
             window.location.search.includes('test=true');
    }

    function resizeOverlayCanvas() {
      if (overlayCanvas) {
        overlayCanvas.width = window.innerWidth;
        overlayCanvas.height = window.innerHeight;
      }
    }

    function showUIError(title, desc) {
      document.getElementById('error-title').textContent = title;
      document.getElementById('error-desc').textContent = desc;
      errorModal.classList.remove('hidden');
      screenOnboarding.classList.add('hidden');
    }

    function updateHUD(status, liveWidthText, progressPct, instruction, isWarning = false) {
      const badge = document.getElementById('badge-status');
      badge.textContent = status;
      badge.className = "status-badge " + status.toLowerCase().replace("...", "");

      document.getElementById('live-width').textContent = liveWidthText;
      
      const pBar = document.getElementById('calibration-progress');
      pBar.style.width = `${progressPct}%`;
      if (progressPct >= 100) {
        pBar.style.background = "var(--state-success)";
      } else {
        pBar.style.background = "var(--accent-grad)";
      }

      const instEl = document.getElementById('hud-status-instruction');
      instEl.textContent = instruction;
      if (isWarning) {
        instEl.classList.add('warning-active');
      } else {
        instEl.classList.remove('warning-active');
      }
    }

    // ------------------------------------------------------------------------
    // WEBXR & GL RUNTIME INITIALIZATION
    // ------------------------------------------------------------------------
    async function startAR() {
      let supported = false;
      if (navigator.xr) {
        try {
          supported = await navigator.xr.isSessionSupported('immersive-ar');
        } catch (e) {
          supported = false;
        }
      }

      if (!supported) {
        console.warn("WebXR immersive-ar is not supported. Attempting PC Webcam Demo Mode fallback...");
        startWebcamDemo();
        return;
      }

      try {
        console.log("Requesting WebXR immersive-ar session...");
        console.log("Required features: ['local', 'depth-sensing', 'dom-overlay', 'camera-access']");
        
        // Request WebXR session with device depth-sensing, DOM overlay, and camera-access capabilities
        xrSession = await navigator.xr.requestSession('immersive-ar', {
          requiredFeatures: ['local', 'depth-sensing', 'dom-overlay', 'camera-access'],
          depthSensing: {
            usagePreference: ['cpu-optimized'],
            dataFormatPreference: ['luminance-alpha']
          },
          domOverlay: { root: document.body }
        });
        
        console.log("SUCCESS: WebXR immersive-ar session started.");

        // Initialize WebGL context
        const canvas = document.getElementById('webgl-canvas');
        console.log("Initializing WebGL context...");
        gl = canvas.getContext('webgl2', { xrCompatible: true });
        if (!gl) {
          gl = canvas.getContext('webgl', { xrCompatible: true });
          console.warn("WebGL2 not supported. Falling back to WebGL1 (GPU blitting will be disabled).");
        } else {
          console.log("SUCCESS: WebGL2 context initialized.");
        }

        // Initialize XRWebGLBinding for raw camera frame access
        try {
          console.log("Initializing XRWebGLBinding...");
          glBinding = new XRWebGLBinding(xrSession, gl);
          console.log("SUCCESS: XRWebGLBinding initialized.");
        } catch (e) {
          console.error("CRITICAL: Failed to create XRWebGLBinding.", e);
        }

        // Configure XR render layers
        console.log("Configuring WebXR base render layer...");
        xrSession.updateRenderState({
          baseLayer: new XRWebGLLayer(xrSession, gl)
        });
        console.log("SUCCESS: WebXR render layer bound.");

        xrRefSpace = await xrSession.requestReferenceSpace('local');
        console.log("SUCCESS: XR local reference space obtained.");

        // Toggle UI
        screenOnboarding.classList.add('hidden');
        arContainer.style.display = 'block';
        resizeOverlayCanvas();
        recalibrate();

        // Start render frame loop
        console.log("Launching requestAnimationFrame frame loop...");
        xrSession.requestAnimationFrame((time, frame) => onXRFrame(time, frame, gl));
        console.log("SUCCESS: Frame loop registered.");

      } catch (err) {
        console.error("CRITICAL: startAR failed with error:", err);
        console.warn("Attempting PC Webcam Demo fallback due to WebXR session error...");
        startWebcamDemo();
      }
    }

    async function startWebcamDemo() {
      isWebcamDemo = true;
      console.log("Initializing PC Webcam Demo Mode...");
      
      const video = document.getElementById('webcam-video');
      if (!video) {
        showUIError("Demo Failed", "Webcam video element was not found.");
        return;
      }

      try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });
        video.srcObject = webcamStream;
        video.style.display = 'block';
        
        // Wait for video to load metadata
        await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            video.play();
            resolve();
          };
        });

        // Hide onboarding, show AR container with video playing behind
        screenOnboarding.classList.add('hidden');
        arContainer.style.display = 'block';
        resizeOverlayCanvas();
        recalibrate();
        
        // Mock a projection matrix for the PC demo view
        activeProjectionMatrix = [1.29, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0];

        // Start webcam frame rendering loop
        console.log("Launching Webcam Frame Loop...");
        requestAnimationFrame(onWebcamFrame);

        // Show simulate scan button in local test environment
        if (isLocalTest()) {
          const simBtn = document.getElementById('btn-simulate-scan');
          if (simBtn) simBtn.style.display = 'block';
        }

      } catch (err) {
        console.error("Webcam access failed:", err);
        if (isLocalTest()) {
          console.warn("Falling back to camera-less simulation mode for local testing...");
          startNoCameraSimulation();
        } else {
          showUIError("Camera Access Required", "Failed to access webcam for sizer demo: " + err.message);
        }
      }
    }

    function onWebcamFrame() {
      if (!isWebcamDemo || !webcamStream) return;
      frameCount++;

      const video = document.getElementById('webcam-video');
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        // Clear WebGL canvas if it exists
        if (gl) {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        // Draw overlay guides and process hand landmarks
        if (calibrationLocked) {
          drawBangleStaticOverlay();
        } else if (isSimulatingScan) {
          drawSimulatedFrame();
        } else if (!isProcessingHand) {
          isProcessingHand = true;
          handsDetector.send({ image: video }).finally(() => {
            isProcessingHand = false;
          });
        }
      }

      requestAnimationFrame(onWebcamFrame);
    }

    function stopAR() {
      // Clear simulation states
      isNoCameraSim = false;
      isSimulatingScan = false;
      if (simIntervalId) {
        clearInterval(simIntervalId);
        simIntervalId = null;
      }
      const simBtn = document.getElementById('btn-simulate-scan');
      if (simBtn) {
        simBtn.style.display = 'none';
        simBtn.disabled = false;
        simBtn.textContent = "Simulate Scan (PC Test)";
        simBtn.style.opacity = '1';
      }
      const container = document.getElementById('ar-container');
      if (container) {
        container.classList.remove('simulated-bg');
      }

      if (isWebcamDemo) {
        isWebcamDemo = false;
        if (webcamStream) {
          webcamStream.getTracks().forEach(track => track.stop());
          webcamStream = null;
        }
        const video = document.getElementById('webcam-video');
        if (video) {
          video.pause();
          video.srcObject = null;
          video.style.display = 'none';
        }
        arContainer.style.display = 'none';
        screenOnboarding.classList.remove('hidden');
      } else if (xrSession) {
        xrSession.end().then(() => {
          xrSession = null;
          arContainer.style.display = 'none';
          screenOnboarding.classList.remove('hidden');
        });
      }
    }

    function recalibrate() {
      calibrationLocked = false;
      isProcessingHand = false;
      stableMeasurementCount = 0;
      kalmanFilter.reset(60.0);
      lastValidHandPositions = null;
      if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      updateHUD("Searching...", "-.- cm", 0, "Fit your knuckles (index to pinky base) inside the frame");
      if (resultModal) {
        resultModal.classList.add('hidden');
      }
      
      // Reset simulation states
      isSimulatingScan = false;
      if (simIntervalId) {
        clearInterval(simIntervalId);
        simIntervalId = null;
      }

      if (isLocalTest() && isWebcamDemo) {
        const simBtn = document.getElementById('btn-simulate-scan');
        if (simBtn) {
          simBtn.style.display = 'block';
          simBtn.disabled = false;
          simBtn.textContent = "Simulate Scan (PC Test)";
          simBtn.style.opacity = '1';
        }
      }
      
      // Reset feedback UI panel elements
      const feedbackButtonsRow = document.querySelector('.feedback-buttons-row');
      const feedbackSizesContainer = document.getElementById('feedback-sizes-container');
      const feedbackSuccessMsg = document.getElementById('feedback-success-msg');
      const feedbackQuestion = document.querySelector('.feedback-question');
      const sizePills = document.querySelectorAll('.btn-feedback-circle');

      if (feedbackButtonsRow) feedbackButtonsRow.classList.remove('hidden');
      if (feedbackSizesContainer) feedbackSizesContainer.classList.add('hidden');
      if (feedbackSuccessMsg) feedbackSuccessMsg.classList.add('hidden');
      if (feedbackQuestion) feedbackQuestion.classList.remove('hidden');
      if (sizePills) sizePills.forEach(p => p.classList.remove('selected'));
    }

    // ------------------------------------------------------------------------
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

      // Clear overlay canvas
      if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }

      if (calibrationLocked) {
        drawBangleStaticOverlay();
      } else {
        if (isSimulationTestbedRunning) {
          const gtWidth = parseFloat(document.getElementById('slide-gt-width').value);
          const gtPitch = parseFloat(document.getElementById('slide-gt-pitch').value);
          const gtDepth = parseFloat(document.getElementById('slide-gt-depth').value) / 100; // cm to m
          const jitter = parseFloat(document.getElementById('slide-noise-jitter').value);
          const drift = parseFloat(document.getElementById('slide-noise-drift').value);

          const frameData = generateSimulatedHand(gtWidth, gtPitch, gtDepth, jitter, drift, frameCount);
          processHandLandmarks(frameData.landmarks);
        } else if (!isSimulatingScan) {
          // Draw dashed guide stencil
          if (overlayCtx && overlayCanvas) {
            drawHandStencil(overlayCtx, overlayCanvas.width, overlayCanvas.height);
          }
        } else {
          drawSimulatedFrame();
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

    function initCarousel() {
      const track = document.getElementById('carousel-track');
      const dots = document.querySelectorAll('.carousel-dot');
      const btnNext = document.getElementById('btn-carousel-next');
      if (!track || !btnNext) return;

      btnNext.onclick = () => {
        if (currentSlide < totalSlides - 1) {
          currentSlide++;
          updateCarousel();
        } else {
          startAR();
        }
      };

      dots.forEach((dot, idx) => {
        dot.onclick = () => {
          currentSlide = idx;
          updateCarousel();
        };
      });

      function updateCarousel() {
        track.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
        dots.forEach((d, idx) => {
          if (idx === currentSlide) d.classList.add('active');
          else d.classList.remove('active');
        });

        if (currentSlide === totalSlides - 1) {
          btnNext.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg> Start AR Sizer`;
        } else {
          btnNext.innerHTML = 'Next';
        }
      }
    }

    function selectBangleSize(sizeStr) {
      const recommendation = BANGLE_SIZES.find(sz => sz.size === sizeStr) || BANGLE_SIZES[2];
      
      document.getElementById('result-size-label').textContent = recommendation.size;
      const estimatedWidth = recommendation.diameterMM + 2.0;
      document.getElementById('result-width-mm').textContent = `${(estimatedWidth / 10).toFixed(2)} cm`;
      document.getElementById('result-diameter-mm').textContent = `${(recommendation.diameterMM / 10).toFixed(2)} cm`;
      
      const rulerMarker = document.getElementById('result-ruler-marker');
      if (rulerMarker) {
        rulerMarker.style.left = `${recommendation.positionPct}%`;
      }
      
      BANGLE_SIZES.forEach(sz => {
        const el = document.getElementById(`tick-${sz.size.replace('.', '-')}`);
        if (el) {
          if (sz.size === recommendation.size) {
            el.classList.add('highlighted');
          } else {
            el.classList.remove('highlighted');
          }
        }
      });

      const scale = recommendation.diameterMM / 60.3;
      const svgGraphic = document.querySelector('.bangle-svg-graphic');
      if (svgGraphic) {
        svgGraphic.style.transform = `rotate(-90deg) scale(${scale})`;
      }
    }
    function drawHandStencil(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = "rgba(212, 175, 55, 0.4)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(212, 175, 55, 0.15)";
      
      const centerX = w / 2;
      const centerY = h / 2 + h * 0.03;
      const scale = Math.min(w, h) * 0.36;
      
      ctx.beginPath();
      // Draw wrist left side
      ctx.moveTo(centerX - scale * 0.22, centerY + scale * 0.5);
      ctx.lineTo(centerX - scale * 0.22, centerY + scale * 0.3);
      
      // Thumb contour
      ctx.quadraticCurveTo(centerX - scale * 0.42, centerY + scale * 0.18, centerX - scale * 0.38, centerY - scale * 0.05);
      ctx.quadraticCurveTo(centerX - scale * 0.28, centerY - scale * 0.13, centerX - scale * 0.22, centerY + scale * 0.05);
      
      // Index finger
      ctx.lineTo(centerX - scale * 0.22, centerY - scale * 0.32);
      ctx.quadraticCurveTo(centerX - scale * 0.13, centerY - scale * 0.37, centerX - scale * 0.10, centerY - scale * 0.32);
      ctx.lineTo(centerX - scale * 0.10, centerY + scale * 0.05);
      
      // Middle finger
      ctx.lineTo(centerX - scale * 0.10, centerY - scale * 0.39);
      ctx.quadraticCurveTo(centerX, centerY - scale * 0.44, centerX + scale * 0.05, centerY - scale * 0.39);
      ctx.lineTo(centerX + scale * 0.05, centerY + scale * 0.05);
      
      // Ring finger
      ctx.lineTo(centerX + scale * 0.05, centerY - scale * 0.35);
      ctx.quadraticCurveTo(centerX + scale * 0.14, centerY - scale * 0.40, centerX + scale * 0.17, centerY - scale * 0.35);
      ctx.lineTo(centerX + scale * 0.17, centerY + scale * 0.08);
      
      // Pinky finger
      ctx.lineTo(centerX + scale * 0.17, centerY - scale * 0.23);
      ctx.quadraticCurveTo(centerX + scale * 0.25, centerY - scale * 0.28, centerX + scale * 0.27, centerY - scale * 0.23);
      ctx.quadraticCurveTo(centerX + scale * 0.30, centerY + scale * 0.15, centerX + scale * 0.22, centerY + scale * 0.3);
      
      // Wrist right side
      ctx.lineTo(centerX + scale * 0.22, centerY + scale * 0.5);
      ctx.stroke();
 
      // Knuckle line
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(212, 175, 55, 0.25)";
      ctx.moveTo(centerX - scale * 0.18, centerY);
      ctx.lineTo(centerX + scale * 0.18, centerY);
      ctx.stroke();
      
      ctx.fillStyle = "rgba(212, 175, 55, 0.55)";
      ctx.beginPath();
      ctx.arc(centerX - scale * 0.18, centerY, 5, 0, 2 * Math.PI);
      ctx.arc(centerX + scale * 0.18, centerY, 5, 0, 2 * Math.PI);
      ctx.fill();
 
      ctx.fillStyle = "rgba(212, 175, 55, 0.65)";
      ctx.font = "700 11px 'Montserrat', sans-serif";
      ctx.textAlign = "center";
      ctx.setLineDash([]);
      ctx.fillText("ALIGN KNUCKLES HERE", centerX, centerY + scale * 0.62);
      
      ctx.restore();
    }

    // ------------------------------------------------------------------------
    // WEBGL GPU DOWNSAMPLING & CAMERA TEXTURE EXTRACTOR
    // ------------------------------------------------------------------------
    function initDownsampleFBO(gl, width, height) {
      if (downsampleFBO && downsampleWidth === width && downsampleHeight === height) {
        return;
      }
      if (downsampleFBO) {
        gl.deleteFramebuffer(downsampleFBO);
        gl.deleteTexture(downsampleTexture);
      }
      downsampleWidth = width;
      downsampleHeight = height;
      
      downsampleFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, downsampleFBO);
      
      downsampleTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, downsampleTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, downsampleTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function extractWebXRFrame(gl, frame, session, cameraTexture) {
      try {
        if (!cameraTexture) {
          if (frameCount % 60 === 0) {
            console.warn("extractWebXRFrame called but cameraTexture is null.");
          }
          return null;
        }

        const baseLayer = session.renderState.baseLayer;
        if (!baseLayer) return null;

        const pose = frame.getViewerPose(xrRefSpace);
        if (!pose || pose.views.length === 0) return null;

        const view = pose.views[0];
        const viewport = baseLayer.getViewport(view);
        if (!viewport || viewport.width === 0 || viewport.height === 0) return null;

        // Ensure we have valid camera dimensions from WebXR Raw Camera
        const cameraWidth = view.camera ? view.camera.width : viewport.width;
        const cameraHeight = view.camera ? view.camera.height : viewport.height;

        // Downsample to a target size of max 512px maintaining aspect ratio
        const maxDim = 512;
        let targetWidth = maxDim;
        let targetHeight = maxDim;
        
        if (cameraWidth > cameraHeight) {
          targetHeight = Math.round((cameraHeight / cameraWidth) * maxDim);
        } else {
          targetWidth = Math.round((cameraWidth / cameraHeight) * maxDim);
        }

        const pixels = new Uint8Array(targetWidth * targetHeight * 4);

        if (gl instanceof WebGL2RenderingContext) {
          // 1. Initialize downsample framebuffer
          initDownsampleFBO(gl, targetWidth, targetHeight);

          // 2. Initialize and bind camera framebuffer
          if (!cameraFBO) {
            cameraFBO = gl.createFramebuffer();
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, cameraFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);

          const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
          if (status !== gl.FRAMEBUFFER_COMPLETE) {
            if (frameCount % 60 === 0) {
              console.warn("Camera FBO is incomplete: " + status);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return null;
          }

          // 3. Blit from Camera FBO to Downsample FBO (linear resizing)
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cameraFBO);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, downsampleFBO);
          gl.blitFramebuffer(
            0, 0, cameraWidth, cameraHeight,
            0, 0, targetWidth, targetHeight,
            gl.COLOR_BUFFER_BIT,
            gl.LINEAR
          );

          // 4. Read pixels asynchronously using PBOs if upgraded mode is active
          if (isUpgradedSizerMode) {
            const sizeInBytes = targetWidth * targetHeight * 4;
            // Initialize PBOs if needed
            if (!isPboInitialized) {
              pboBuffers[0] = gl.createBuffer();
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[0]);
              gl.bufferData(gl.PIXEL_PACK_BUFFER, sizeInBytes, gl.STREAM_READ);

              pboBuffers[1] = gl.createBuffer();
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[1]);
              gl.bufferData(gl.PIXEL_PACK_BUFFER, sizeInBytes, gl.STREAM_READ);

              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
              isPboInitialized = true;
              console.log("WebGL2 Async PBO Readback initialized. Target: " + targetWidth + "x" + targetHeight);
            }

            const nextPboIndex = (activePboIndex + 1) % 2;
            const fence = pboFences[nextPboIndex];
            let readbackCompleted = false;

            if (fence) {
              const waitStatus = gl.clientWaitSync(fence, 0, 0);
              if (waitStatus === gl.ALREADY_SIGNALED || waitStatus === gl.CONDITION_SATISFIED) {
                gl.deleteSync(fence);
                pboFences[nextPboIndex] = null;
                
                // Read pixels from completed buffer
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[nextPboIndex]);
                gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                readbackCompleted = true;
              }
            }

            // Queue up the read for the current frame into the active PBO
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, downsampleFBO);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[activePboIndex]);
            gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
            pboFences[activePboIndex] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

            // Shift pointers
            activePboIndex = nextPboIndex;

            if (!readbackCompleted) {
              // GPU copy in progress, return null for this frame to avoid blocking the render loop
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              return null;
            }
          } else {
            // Synchronous fallback
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, downsampleFBO);
            gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          }
        } else {
          // WebGL1 Fallback: bind camera texture directly to FBO and read (no blit support)
          if (!cameraFBO) {
            cameraFBO = gl.createFramebuffer();
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, cameraFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);
          
          const rawPixels = new Uint8Array(cameraWidth * cameraHeight * 4);
          gl.readPixels(0, 0, cameraWidth, cameraHeight, gl.RGBA, gl.UNSIGNED_BYTE, rawPixels);
          
          // CPU scaling downsampler
          for (let y = 0; y < targetHeight; y++) {
            const srcY = Math.floor((y / targetHeight) * cameraHeight);
            for (let x = 0; x < targetWidth; x++) {
              const srcX = Math.floor((x / targetWidth) * cameraWidth);
              const srcIdx = (srcX + srcY * cameraWidth) * 4;
              const destIdx = (x + y * targetWidth) * 4;
              pixels[destIdx] = rawPixels[srcIdx];
              pixels[destIdx+1] = rawPixels[srcIdx+1];
              pixels[destIdx+2] = rawPixels[srcIdx+2];
              pixels[destIdx+3] = rawPixels[srcIdx+3];
            }
          }
        }

        // Restore default framebuffer binding
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Debug check to verify FBO pixels are not completely blank
        if (frameCount % 60 === 0) {
          let allZero = true;
          const stride = Math.floor(pixels.length / 200);
          for (let i = 0; i < pixels.length; i += stride) {
            if (pixels[i] !== 0) { allZero = false; break; }
          }
          console.log("FBO Blit Check - targetWidth: " + targetWidth + ", targetHeight: " + targetHeight + ", is FBO buffer blank?", allZero);
        }

        // Draw pixel data onto canvas for MediaPipe input
        offscreenCanvas.width = targetWidth;
        offscreenCanvas.height = targetHeight;
        const imageData = offscreenCtx.createImageData(targetWidth, targetHeight);

        // Flip image vertically since WebGL framebuffer origin is bottom-left
        for (let y = 0; y < targetHeight; y++) {
          const srcRow = y * targetWidth * 4;
          const destRow = (targetHeight - 1 - y) * targetWidth * 4;
          imageData.data.set(pixels.subarray(srcRow, srcRow + targetWidth * 4), destRow);
        }

        offscreenCtx.putImageData(imageData, 0, 0);
        return offscreenCanvas;
      } catch (err) {
        console.error("Error in extractWebXRFrame:", err);
        return null;
      }
    }

    // ------------------------------------------------------------------------
    // WEBXR FRAME TICK & MEDIAPIPE SCHEDULER
    // ------------------------------------------------------------------------
    function onXRFrame(time, frame, gl) {
      if (!xrSession) return;
      
      // Request next frame immediately to maintain ARCore lifecycle
      xrSession.requestAnimationFrame((t, f) => onXRFrame(t, f, gl));

      const pose = frame.getViewerPose(xrRefSpace);
      if (pose && pose.views.length > 0) {
        const view = pose.views[0];
        let cameraTexture = null;

        // Retrieve camera image texture if available
        if (glBinding && view.camera) {
          try {
            cameraTexture = glBinding.getCameraImage(view.camera);
          } catch (e) {
            if (frameCount % 60 === 0) {
              console.warn("Failed to retrieve camera texture from glBinding:", e);
            }
          }
        } else {
          if (frameCount % 60 === 0) {
            console.warn("glBinding or view.camera is missing. glBinding active:", !!glBinding, "camera active:", !!view.camera);
          }
        }

        // Retrieve depth information map from frame
        try {
          xrDepthInfo = frame.getDepthInformation(view);
        } catch (e) {
          console.warn("Depth information is unavailable for this view:", e);
        }

        // Render ARCore background (Clear screen with alpha=0, letting browser render camera feed)
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Stop measurement loop if sizer has locked in a measurement
        if (calibrationLocked) {
          // Keep drawing static overlay of the locked bangle
          drawBangleStaticOverlay();
          return;
        }

        // Step 1: Capture frame pixels for computer vision using the camera texture
        const frameCanvas = extractWebXRFrame(gl, frame, xrSession, cameraTexture);

        // Step 2: Feed into MediaPipe async detector (with processing lock to prevent lag)
        if (frameCanvas && !isProcessingHand) {
          isProcessingHand = true;
          detectHandLandmarks(frameCanvas, view).finally(() => {
            isProcessingHand = false;
          });
        }
      }
    }

    // ------------------------------------------------------------------------
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
      // Clear overlay canvas
      if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
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
        updateHUD("Searching...", "-.- cm", progress, "Point camera at hand. Squeeze your knuckles tight.");
        
        // Draw dashed hand silhouette stencil to guide the user placement
        if (overlayCtx && overlayCanvas) {
          drawHandStencil(overlayCtx, overlayCanvas.width, overlayCanvas.height);
        }
      }
    });

    async function detectHandLandmarks(canvasElement, xrView) {
      activeProjectionMatrix = xrView.projectionMatrix;
      await handsDetector.send({ image: canvasElement });
    }

    // Exact 3D view-space coordinates calculation without needing gl-matrix library
    function unproject(lm, depth, projectionMatrix) {
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
      const x = ((ndcX + m8) / m0) * depth;
      const y = ((ndcY + m9) / m5) * depth;
      const z = -depth;

      return [x, y, z];
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
    // SCREEN SPACE DRAWING LAYER & BANGLE OVERLAY
    // ------------------------------------------------------------------------
    function project3DTo2D(p_view, projectionMatrix, width, height) {
      const [X, Y, Z] = p_view;
      const m0 = projectionMatrix[0];
      const m5 = projectionMatrix[5];
      const m8 = projectionMatrix[8];
      const m9 = projectionMatrix[9];

      // Perspective divide (w = -Z)
      const w = -Z;
      const ndcX = (m0 * X + m8 * Z) / w;
      const ndcY = (m5 * Y + m9 * Z) / w;

      // Transform to canvas coordinate system
      const u = ((ndcX + 1) / 2) * width;
      const v = ((1 - ndcY) / 2) * height;

      return [u, v];
    }

    function drawHandWireframe(landmarks, isValid, progressFraction = 0) {
      const w = overlayCanvas.width;
      const h = overlayCanvas.height;

      // Knuckle landmarks
      const indexKnuckle = landmarks[5];
      const pinkyKnuckle = landmarks[17];
      const wrist = landmarks[0];

      // Convert to screen space coords
      const iX = indexKnuckle.x * w;
      const iY = indexKnuckle.y * h;
      const pX = pinkyKnuckle.x * w;
      const pY = pinkyKnuckle.y * h;
      const wX = wrist.x * w;
      const wY = wrist.y * h;

      const themeColor = isValid ? "rgba(212, 175, 55, 0.95)" : "rgba(217, 83, 79, 0.95)";

      // Draw light tracking visualizer lines representing hand box
      overlayCtx.beginPath();
      overlayCtx.moveTo(iX, iY);
      overlayCtx.lineTo(wX, wY);
      overlayCtx.lineTo(pX, pY);
      overlayCtx.strokeStyle = isValid ? "rgba(212, 175, 55, 0.25)" : "rgba(217, 83, 79, 0.2)";
      overlayCtx.lineWidth = 2;
      overlayCtx.stroke();

      // Draw laser-like knuckle connection line (neon glow)
      overlayCtx.beginPath();
      overlayCtx.moveTo(iX, iY);
      overlayCtx.lineTo(pX, pY);
      overlayCtx.strokeStyle = themeColor;
      overlayCtx.lineWidth = 4;
      overlayCtx.shadowBlur = isValid ? 10 : 0;
      overlayCtx.shadowColor = themeColor;
      overlayCtx.stroke();
      overlayCtx.shadowBlur = 0;

      // Draw index knuckle dot
      overlayCtx.beginPath();
      overlayCtx.arc(iX, iY, 8, 0, 2 * Math.PI);
      overlayCtx.fillStyle = themeColor;
      overlayCtx.shadowBlur = isValid ? 8 : 0;
      overlayCtx.shadowColor = themeColor;
      overlayCtx.fill();
      overlayCtx.shadowBlur = 0; // Reset shadow

      // Draw pinky knuckle dot
      overlayCtx.beginPath();
      overlayCtx.arc(pX, pY, 8, 0, 2 * Math.PI);
      overlayCtx.fillStyle = themeColor;
      overlayCtx.shadowBlur = isValid ? 8 : 0;
      overlayCtx.shadowColor = themeColor;
      overlayCtx.fill();
      overlayCtx.shadowBlur = 0;

      // Draw radial progress circle directly around hand center
      const midX = (iX + pX) / 2;
      const midY = (iY + pY) / 2;
      
      if (isValid && progressFraction > 0) {
        // Draw track
        overlayCtx.beginPath();
        overlayCtx.arc(midX, midY, 32, 0, 2 * Math.PI);
        overlayCtx.strokeStyle = "rgba(212, 175, 55, 0.1)";
        overlayCtx.lineWidth = 4;
        overlayCtx.stroke();

        // Draw active loading segment
        overlayCtx.beginPath();
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (2 * Math.PI * progressFraction);
        overlayCtx.arc(midX, midY, 32, startAngle, endAngle);
        overlayCtx.strokeStyle = "#d4af37";
        overlayCtx.lineWidth = 4;
        overlayCtx.lineCap = "round";
        overlayCtx.stroke();

        // Draw percentage text
        overlayCtx.font = "700 10px 'Montserrat', sans-serif";
        overlayCtx.fillStyle = "#d4af37";
        overlayCtx.textAlign = "center";
        overlayCtx.fillText(Math.round(progressFraction * 100) + "%", midX, midY + 3.5);
      }
    }

    // Zero-latency 3D circle projected overlay
    function drawProjectedBangleOverlay(p5_3d, p17_3d, measuredWidthMM, wrist_3d = null) {
      if (!activeProjectionMatrix) return;

      const w = overlayCanvas.width;
      const h = overlayCanvas.height;

      // 1. Center of the bangle is the midpoint between knuckles 5 and 17 in view space
      const cx = (p5_3d[0] + p17_3d[0]) / 2;
      const cy = (p5_3d[1] + p17_3d[1]) / 2;
      const cz = (p5_3d[2] + p17_3d[2]) / 2;
      const center = [cx, cy, cz];

      // 2. Set the recommended bangle radius in meters
      // Sizing is based on hand width minus compression factor
      const recSize = getRecommendedBangleSize(measuredWidthMM);
      const diameterMeters = recSize.diameterMM / 1000;
      const radiusMeters = diameterMeters / 2;

      // 3. Generate basis vectors for palm plane alignment if upgraded mode is active
      let uDir = [1, 0, 0];
      let wDir = [0, 1, 0];
      let isCoplanarAligned = false;

      if (isUpgradedSizerMode && wrist_3d) {
        const v1 = subtractVectors(p5_3d, wrist_3d);
        const v2 = subtractVectors(p17_3d, wrist_3d);
        const normalVec = crossProduct(v1, v2);
        const unitNormal = normalizeVector(normalVec);

        if (magnitude(unitNormal) > 0.1) {
          uDir = normalizeVector(v1);
          wDir = normalizeVector(crossProduct(uDir, unitNormal));
          isCoplanarAligned = true;
        }
      }

      // 4. Generate points on the circle in view space (either flat or coplanar aligned)
      const numPoints = 40;
      const circlePoints = [];
      for (let i = 0; i <= numPoints; i++) {
        const theta = (i * 2 * Math.PI) / numPoints;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        
        let p_view;
        if (isCoplanarAligned) {
          // Circle points embedded in 3D hand plane
          p_view = [
            cx + radiusMeters * (cosT * uDir[0] + sinT * wDir[0]),
            cy + radiusMeters * (cosT * uDir[1] + sinT * wDir[1]),
            cz + radiusMeters * (cosT * uDir[2] + sinT * wDir[2])
          ];
        } else {
          // Fallback: parallel to camera sensor
          p_view = [
            cx + radiusMeters * cosT,
            cy + radiusMeters * sinT,
            cz
          ];
        }
        
        // Project to 2D screen coordinates
        const [u, v] = project3DTo2D(p_view, activeProjectionMatrix, w, h);
        circlePoints.push([u, v]);
      }

      // 5. Draw the 3D projected circle on canvas
      overlayCtx.beginPath();
      overlayCtx.moveTo(circlePoints[0][0], circlePoints[0][1]);
      for (let i = 1; i < circlePoints.length; i++) {
        overlayCtx.lineTo(circlePoints[i][0], circlePoints[i][1]);
      }
      overlayCtx.closePath();

      // Premium Gold gradient style for circle stroke resembling a real gold bangle
      const grad = overlayCtx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#f5e2b3');
      grad.addColorStop(0.5, '#d4af37');
      grad.addColorStop(1, '#8a640f');

      overlayCtx.strokeStyle = grad;
      overlayCtx.lineWidth = 5;
      overlayCtx.shadowBlur = 12;
      overlayCtx.shadowColor = "rgba(212, 175, 55, 0.4)";
      overlayCtx.stroke();
      overlayCtx.shadowBlur = 0; // Reset

      // Draw sizing tag near the bangle circle center
      const [centerU, centerV] = project3DTo2D(center, activeProjectionMatrix, w, h);
      overlayCtx.font = "700 12px 'Montserrat', sans-serif";
      overlayCtx.fillStyle = "#fdfbf7";
      overlayCtx.textAlign = "center";
      overlayCtx.shadowBlur = 4;
      overlayCtx.shadowColor = "#000000";
      overlayCtx.fillText(`BANGLE SIZE ${recSize.size}`, centerU, centerV + 5);
      overlayCtx.shadowBlur = 0;
    }

    function drawBangleStaticOverlay() {
      if (lastValidHandPositions && activeProjectionMatrix) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        drawProjectedBangleOverlay(
          lastValidHandPositions.p5, 
          lastValidHandPositions.p17, 
          smoothedKnuckleWidth,
          lastValidHandPositions.wrist
        );
      }
    }

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
        const requiredStable = 45;

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
          const upFilterP5 = new OneEuroFilter3D(30, 0.5, 0.005, 1.0);
          const upFilterP17 = new OneEuroFilter3D(30, 0.5, 0.005, 1.0);

          let baseStableCount = 0;
          let baseLockedWidth = null;
          let baseLockFrame = null;
          let baseWidths = [];

          let upStableCount = 0;
          let upLockedWidth = null;
          let upLockFrame = null;
          let upWidths = [];

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
                if (variance < 1.5) {
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

                if (pitchDeg <= 15) {
                  const p5_3d = upFilterP5.filter(p5_raw);
                  const p17_3d = upFilterP17.filter(p17_raw);
                  const rawMM = calculateDistance(p5_3d, p17_3d) * 1000;
                  if (rawMM >= 42 && rawMM <= 88) {
                    width = rawMM * calibrationScale;
                    isValid = true;
                  }
                }
              }

              if (isValid) {
                const smoothed = upKalman.update(width);
                const variance = Math.abs(width - smoothed);
                if (variance < 1.5) {
                  upStableCount++;
                  upWidths.push(smoothed);
                  if (upStableCount >= requiredStable) {
                    upLockedWidth = smoothed;
                    upLockFrame = f;
                  }
                } else {
                  upStableCount = Math.max(0, upStableCount - 3);
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