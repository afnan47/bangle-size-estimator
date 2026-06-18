// WEBXR & GL RUNTIME INITIALIZATION
    // ------------------------------------------------------------------------
    async function startAR() {
      setScanButtonsLoading(true);
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

        // Update Sizer Mode badges for WebXR Precision Scan
        const modeBadge = document.getElementById('sizer-mode-badge');
        if (modeBadge) {
          modeBadge.textContent = "WebXR Precision Scan";
          modeBadge.style.color = "var(--accent-gold)";
          modeBadge.style.background = "rgba(212, 175, 55, 0.15)";
          modeBadge.style.borderColor = "rgba(212, 175, 55, 0.3)";
        }
        const resultBadge = document.getElementById('result-mode-badge');
        if (resultBadge) {
          resultBadge.textContent = "WebXR Precision Scan";
        }

        // Toggle UI
        screenOnboarding.classList.add('hidden');
        arContainer.classList.remove('hidden');
        resizeOverlayCanvas();
        recalibrate();
        setScanButtonsLoading(false);

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
      setScanButtonsLoading(true);
      isWebcamDemo = true;
      console.log("Initializing PC Webcam Demo / Heuristic Mode...");
      
      const video = document.getElementById('webcam-video');
      if (!video) {
        showUIError("Demo Failed", "Webcam video element was not found.");
        setScanButtonsLoading(false);
        return;
      }

      // Check if mobile device to request the back (environment) camera
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const facing = isMobile ? "environment" : "user";
      console.log(`Requesting camera facingMode: "${facing}"`);

      try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1280 },
            height: { ideal: 720 }
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

        // Update Sizer Mode badges for Camera Estimate (Beta)
        const modeBadge = document.getElementById('sizer-mode-badge');
        if (modeBadge) {
          modeBadge.textContent = "Camera Estimate (Beta)";
          modeBadge.style.color = "#ffb03a";
          modeBadge.style.background = "rgba(255, 176, 58, 0.12)";
          modeBadge.style.borderColor = "rgba(255, 176, 58, 0.3)";
        }
        const resultBadge = document.getElementById('result-mode-badge');
        if (resultBadge) {
          resultBadge.textContent = "Camera Estimate (Beta)";
        }

        // Hide onboarding, show AR container with video playing behind
        screenOnboarding.classList.add('hidden');
        arContainer.classList.remove('hidden');
        resizeOverlayCanvas();
        recalibrate();
        setScanButtonsLoading(false);
        
        // Calculate projection matrix dynamically based on aspect ratio to keep pixels square in 3D
        const videoWidth = video.videoWidth || 640;
        const videoHeight = video.videoHeight || 480;
        const aspect = videoHeight / videoWidth;
        const m0 = 1.6; // baseline FOV scale
        const m5 = m0 * aspect; // scale vertical focal length by aspect ratio to ensure square pixels
        activeProjectionMatrix = [
          m0, 0, 0, 0,
          0, m5, 0, 0,
          0, 0, -1, -1,
          0, 0, -0.2, 0
        ];

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
        setScanButtonsLoading(false);
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
        } else if (!isProcessingHand && (frameCount % trackingThrottleRate === 0)) {
          isProcessingHand = true;
          detectHandLandmarks(video).finally(() => {
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
        arContainer.classList.add('hidden');
        screenOnboarding.classList.remove('hidden');
      } else if (xrSession) {
        xrSession.end().then(() => {
          xrSession = null;
          arContainer.classList.add('hidden');
          screenOnboarding.classList.remove('hidden');
        });
      }
    }

    function recalibrate() {
      calibrationLocked = false;
      isProcessingHand = false;
      stableMeasurementCount = 0;
      unstableFrameCount = 0;
      measurementHistory = [];
      prevWristPos = null;
      kalmanFilter.reset(60.0);
      lastValidHandPositions = null;
      lastRenderedState = null;
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
    