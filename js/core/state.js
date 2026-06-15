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
    let unstableFrameCount = 0; // Tracks consecutive unstable frames for grace period
    let activeProjectionMatrix = null;
    
    const kalmanFilter = new KnuckleKalmanFilter();
    let smoothedKnuckleWidth = 60.0;
    let calibrationScale = parseFloat(localStorage.getItem('bangle_sizer_calibration_scale')) || 1.0;
    let lastUncalibratedSmoothedWidth = 60.0;
    let isWebcamDemo = false;
    let webcamStream = null;
    let lastValidHandPositions = null; // Stores [{x_view, y_view, z_view}, ...] for rendering bangle circles

    // One-Euro Filters for knuckle landmarks 5 & 17
    const filterP5 = new OneEuroFilter3D(30, 1.0, 0.0005, 1.0);
    const filterP17 = new OneEuroFilter3D(30, 1.0, 0.0005, 1.0);
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
    