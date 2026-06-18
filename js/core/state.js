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
    
    // Cached pixel buffers for GC prevention
    let cachedPixels = null;
    let cachedPixels32 = null;
    let cachedImageData = null;
    let cachedRawPixels = null;
    
    let isProcessingHand = false;
    let trackingThrottleRate = 3; // Adaptive frame throttle rate (processes every N frames)
    let lastDetectionTimeMs = 0;  // MediaPipe detection latency in ms
    let lastRenderedState = null; // State of the last overlay draw ('searching', 'tracking', etc.)
    let calibrationLocked = false;
    let stableMeasurementCount = 0;
    let unstableFrameCount = 0; // Tracks consecutive unstable frames for grace period
    let activeProjectionMatrix = null;
    
    // Preallocated math vectors to eliminate GC pressure
    const temp_p0_raw = [0, 0, 0];
    const temp_p5_raw = [0, 0, 0];
    const temp_p17_raw = [0, 0, 0];
    const temp_v1 = [0, 0, 0];
    const temp_v2 = [0, 0, 0];
    const temp_palmNormal = [0, 0, 0];
    const temp_unitNormal = [0, 0, 0];
    const temp_p5_3d = [0, 0, 0];
    const temp_p17_3d = [0, 0, 0];

    const preallocatedLastValidHandPositions = {
      p5: [0, 0, 0],
      p17: [0, 0, 0],
      wrist: [0, 0, 0]
    };
    
    const kalmanFilter = new KnuckleKalmanFilter();
    let smoothedKnuckleWidth = 60.0;
    let calibrationScale = parseFloat(localStorage.getItem('bangle_sizer_calibration_scale')) || 1.0;
    let lastUncalibratedSmoothedWidth = 60.0;
    let isWebcamDemo = false;
    let webcamStream = null;
    let lastValidHandPositions = null; // References preallocatedLastValidHandPositions when valid

    // One-Euro Filters for knuckle landmarks 5 & 17
    const filterP5 = new OneEuroFilter3D(30, 1.0, 0.0005, 1.0);
    const filterP17 = new OneEuroFilter3D(30, 1.0, 0.0005, 1.0);
    let isUpgradedSizerMode = true; // Enabled by default, can be toggled by the testbed simulation
    let isSimulationTestbedRunning = false;
    let selectedBangleStyle = 'gold-filigree'; // Options: 'gold-filigree', 'kundan-kada', 'polki-kada'

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
    