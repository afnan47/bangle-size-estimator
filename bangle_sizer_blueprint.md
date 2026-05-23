Technical Specification \& Implementation Blueprint: WebXR-Powered Mobile Bangle Sizer (Android)This document serves as a comprehensive developer specification for constructing, calibrating, and testing a mobile-first, cardless bangle sizing web application utilizing WebXR (with Depth-Sensing \& Hit-Testing) and Google MediaPipe Hands on Android Chrome.1. Core Mathematical \& Architectural LogicA physical bangle must slide over the widest part of a compressed hand. Traditional computer vision struggles with distance scaling (the "depth problem"). By using WebXR, we retrieve real-world physical dimensions ($1.0 \\text{ unit} = 1.0 \\text{ meter}$) directly from the device's ARCore engine.\[Camera Sensor] ──> \[WebXR Session (ARCore)] ──> \[GL Frame Capture]

&#x20;                        │ (Depth Buffer)            │

&#x20;                        ▼                           ▼

&#x20;                   \[XRCamera View]             \[MediaPipe Hands]

&#x20;                        │                           │

&#x20;                        ▼                           ▼

&#x20;             \[3D Unprojection Matrix] <─── \[2D Screen Landmarks (5, 17)]

&#x20;                        │

&#x20;                        ▼

&#x20;              \[Physical Distance (mm)] ──> \[Bangle Size Recommendation]

1.1 Sizing Strategy (Landmarks 5 and 17)Landmark 5: Base of the index finger (Metacarpophalangeal / MCP joint).Landmark 17: Base of the pinky finger (MCP joint).The physical distance $d$ between these points on a tightly squeezed hand dictates the minimal inner diameter of the bangle.1.2 Mathematical Projection (2D Screen Space to 3D View Space)Given a 2D landmark point on the screen $P\_{screen} = (u, v)$ where $u \\in \[0, \\text{width}]$ and $v \\in \[0, \\text{height}]$, we must compute its real-world 3D view-space coordinates $P\_{view} = (X\_{view}, Y\_{view}, Z\_{view})$.Calculate Normalized Device Coordinates (NDC):$$x\_{ndc} = \\frac{2u}{\\text{width}} - 1$$$$y\_{ndc} = 1 - \\frac{2v}{\\text{height}}$$$$z\_{ndc} = 2d\_{depth} - 1$$Where $d\_{depth}$ is the physical depth value extracted from the WebXR CPU depth buffer (getDepthInMeters(u, v)) at the matching pixel coordinate.Retrieve WebXR Projection Matrices:We pull the camera's Projection Matrix $M\_{proj}$ and its Inverse $M\_{proj}^{-1}$ from the active XRView.Compute 3D View-Space Position:By applying the inverse projection matrix to the NDC coordinates:$$\\begin{bmatrix} X\_{view} \\\\ Y\_{view} \\\\ Z\_{view} \\\\ W\_{view} \\end{bmatrix} = M\_{proj}^{-1} \\begin{bmatrix} x\_{ndc} \\\\ y\_{ndc} \\\\ z\_{ndc} \\\\ 1 \\end{bmatrix}$$We then divide by the homogeneous coordinate $W\_{view}$ to retrieve physical meters:$$X\_{final} = \\frac{X\_{view}}{W\_{view}}, \\quad Y\_{final} = \\frac{Y\_{view}}{W\_{view}}, \\quad Z\_{final} = \\frac{Z\_{view}}{W\_{view}}$$Calculate Euclidean Knuckle Width:Once both Landmark 5 ($P\_1$) and Landmark 17 ($P\_2$) are projected into 3D view-space, the absolute hand width in millimeters is calculated as:$$\\text{Hand Width (mm)} = \\sqrt{(X\_{final, 1} - X\_{final, 2})^2 + (Y\_{final, 1} - Y\_{final, 2})^2 + (Z\_{final, 1} - Z\_{final, 2})^2} \\times 1000$$2. Environment \& Testing Environment SetupWebXR and camera permissions require strict security contexts. Testing cannot be done using raw file setups (file://).Secure Port Forwarding:Run a local development server on your laptop (e.g., Node.js with Vite or Python's http.server on port 8080).Connect your physical Android phone to your laptop via USB.Enable Developer Options and USB Debugging on the Android device.Open Chrome on your desktop and navigate to chrome://inspect.Enable Port Forwarding: Map port 8080 on your phone to localhost:8080 on your laptop. This forces Chrome on Android to treat the connection as a secure origin (http://localhost:8080), bypassing HTTPS requirements for WebXR testing.Device Requirements:Android device running Android 10 or newer.Google Play Services for AR (ARCore) installed.Google Chrome (v110+) configured as the default browser.3. The Camera Resource Conflict Bypass (Critical Hack)On mobile browsers, ARCore claims exclusive hardware control of the camera sensor. If you try to run navigator.mediaDevices.getUserMedia() while WebXR is active, the camera initialization will fail with a NotReadableError or instantly crash the WebXR session.The Solution: WebGL Framebuffer ExtractionWe must read the raw WebGL textures that ARCore is rendering on the screen during the onXRFrame loop, copy the pixels to an offscreen canvas, and feed that canvas directly into MediaPipe Hands.// Step-by-step extraction workflow

let offscreenCanvas = document.createElement('canvas');

let offscreenCtx = offscreenCanvas.getContext('2d');



function extractWebXRFrame(gl, frame, session) {

&#x20; const baseLayer = session.renderState.baseLayer;

&#x20; gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);

&#x20; 

&#x20; // Set dimensions to match WebXR viewport

&#x20; const viewport = session.renderState.baseLayer.getViewport(frame.getViewerPose(referenceSpace).views\[0]);

&#x20; offscreenCanvas.width = viewport.width;

&#x20; offscreenCanvas.height = viewport.height;



&#x20; // Extract pixels from the WebGL context

&#x20; const pixels = new Uint8Array(viewport.width \* viewport.height \* 4);

&#x20; gl.readPixels(

&#x20;   viewport.x, viewport.y, 

&#x20;   viewport.width, viewport.height, 

&#x20;   gl.RGBA, 

&#x20;   gl.UNSIGNED\_BYTE, 

&#x20;   pixels

&#x20; );



&#x20; // Write pixels back to 2D canvas context for MediaPipe input

&#x20; const imageData = offscreenCtx.createImageData(viewport.width, viewport.height);

&#x20; // Vertically flip the image since WebGL coordinates are inverted relative to standard image coordinates

&#x20; for (let y = 0; y < viewport.height; y++) {

&#x20;   const srcRow = y \* viewport.width \* 4;

&#x20;   const destRow = (viewport.height - 1 - y) \* viewport.width \* 4;

&#x20;   imageData.data.set(pixels.subarray(srcRow, srcRow + viewport.width \* 4), destRow);

&#x20; }

&#x20; offscreenCtx.putImageData(imageData, 0, 0);

&#x20; return offscreenCanvas;

}

4\. WebXR Session \& Depth Sensing LifecycleThis lifecycle initializes the AR hardware with CPU-optimized depth configurations, which yields the highly accurate raw distance arrays we need.let xrSession = null;

let xrRefSpace = null;

let xrDepthInfo = null;



async function startAR() {

&#x20; if (!navigator.xr) {

&#x20;   showError("WebXR is not supported on this browser.");

&#x20;   return;

&#x20; }



&#x20; const supported = await navigator.xr.isSessionSupported('immersive-ar');

&#x20; if (!supported) {

&#x20;   showError("Immersive AR is not supported on this device.");

&#x20;   return;

&#x20; }



&#x20; try {

&#x20;   // Request CPU-optimized depth-sensing and hit-test capability

&#x20;   xrSession = await navigator.xr.requestSession('immersive-ar', {

&#x20;     requiredFeatures: \['local', 'depth-sensing', 'hit-test'],

&#x20;     depthSensing: {

&#x20;       usagePreference: \['cpu-optimized'],

&#x20;       dataFormatPreference: \['luminance-alpha']

&#x20;     }

&#x20;   });



&#x20;   const canvas = document.createElement('canvas');

&#x20;   const gl = canvas.getContext('webgl', { xrCompatible: true });

&#x20;   xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, gl) });



&#x20;   xrRefSpace = await xrSession.requestReferenceSpace('local');

&#x20;   xrSession.requestAnimationFrame((time, frame) => onXRFrame(time, frame, gl));



&#x20; } catch (err) {

&#x20;   showError("AR Initialization failed: " + err.message);

&#x20; }

}



function onXRFrame(time, frame, gl) {

&#x20; if (!xrSession) return;

&#x20; xrSession.requestAnimationFrame((t, f) => onXRFrame(t, f, gl));



&#x20; const pose = frame.getViewerPose(xrRefSpace);

&#x20; if (pose) {

&#x20;   const view = pose.views\[0];

&#x20;   

&#x20;   // Extract Depth Information map

&#x20;   try {

&#x20;     xrDepthInfo = frame.getDepthInformation(view);

&#x20;   } catch (e) {

&#x20;     console.warn("Depth information unavailable for this frame", e);

&#x20;   }



&#x20;   // Step 1: Capture frame pixels for computer vision

&#x20;   const frameCanvas = extractWebXRFrame(gl, frame, xrSession);

&#x20;   

&#x20;   // Step 2: Pass frame to MediaPipe Hands (asynchronously)

&#x20;   detectHandLandmarks(frameCanvas, view);

&#x20; }

}

5\. MediaPipe Detection \& Coordinate Translation EngineTo map the tracked hand landmarks back into the real world, write an async coordinate translator function.// Load MediaPipe Hands via CDN scripts in your HTML head

// \[https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js](https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js)



let handsDetector = new Hands({

&#x20; locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`

});

handsDetector.setOptions({

&#x20; maxNumHands: 1,

&#x20; modelComplexity: 1,

&#x20; minDetectionConfidence: 0.8,

&#x20; minTrackingConfidence: 0.8

});



handsDetector.onResults((results) => {

&#x20; if (results.multiHandLandmarks \&\& results.multiHandLandmarks.length > 0) {

&#x20;   processHandLandmarks(results.multiHandLandmarks\[0]);

&#x20; } else {

&#x20;   updateUIState("Searching for hand...");

&#x20; }

});



async function detectHandLandmarks(canvasElement, xrView) {

&#x20; // Store the active camera projection matrix and viewport

&#x20; activeProjectionMatrix = xrView.projectionMatrix;

&#x20; activeViewport = xrSession.renderState.baseLayer.getViewport(xrView);

&#x20; 

&#x20; await handsDetector.send({ image: canvasElement });

}



function processHandLandmarks(landmarks) {

&#x20; // Landmark 5 (Index Knuckle) and 17 (Pinky Knuckle)

&#x20; const lm5 = landmarks\[5];

&#x20; const lm17 = landmarks\[17];



&#x20; // MediaPipe coordinates are normalized \[0.0 - 1.0]

&#x20; // Scale to viewport pixels

&#x20; const u5 = lm5.x \* activeViewport.width;

&#x20; const v5 = lm5.y \* activeViewport.height;



&#x20; const u17 = lm17.x \* activeViewport.width;

&#x20; const v17 = lm17.y \* activeViewport.height;



&#x20; if (!xrDepthInfo) return;



&#x20; // Retrieve physical depth in meters at the coordinates

&#x20; const depth5 = xrDepthInfo.getDepthInMeters(lm5.x, lm5.y);

&#x20; const depth17 = xrDepthInfo.getDepthInMeters(lm17.x, lm17.y);



&#x20; if (depth5 === 0 || depth17 === 0) {

&#x20;   updateUIState("Calibration error: Keep hand flat and close to surface.");

&#x20;   return;

&#x20; }



&#x20; // Unproject to 3D world space

&#x20; const p5\_3d = unproject(u5, v5, depth5, activeViewport, activeProjectionMatrix);

&#x20; const p17\_3d = unproject(u17, v17, depth17, activeViewport, activeProjectionMatrix);



&#x20; // Compute knuckle physical width (mm)

&#x20; const physicalWidth = calculateDistance(p5\_3d, p17\_3d) \* 1000;

&#x20; 

&#x20; // Clean signal with Kalman filter

&#x20; filterMeasurement(physicalWidth);

}



// Matrix unprojection implementation

function unproject(u, v, depth, viewport, projectionMatrix) {

&#x20; const invProj = mat4.create();

&#x20; mat4.invert(invProj, projectionMatrix);



&#x20; // Normalized Device Coordinates (NDC)

&#x20; const ndcX = (2 \* u) / viewport.width - 1;

&#x20; const ndcY = 1 - (2 \* v) / viewport.height;

&#x20; const ndcZ = 2 \* depth - 1;



&#x20; const vec = vec4.fromValues(ndcX, ndcY, ndcZ, 1.0);

&#x20; vec4.transformMat4(vec, vec, invProj);



&#x20; // Homogeneous coordinates division to retrieve true physical meters

&#x20; return vec3.fromValues(

&#x20;   vec\[0] / vec\[3],

&#x20;   vec\[1] / vec\[3],

&#x20;   vec\[2] / vec\[3]

&#x20; );

}



function calculateDistance(p1, p2) {

&#x20; return Math.sqrt(

&#x20;   Math.pow(p1\[0] - p2\[0], 2) +

&#x20;   Math.pow(p1\[1] - p2\[1], 2) +

&#x20;   Math.pow(p1\[2] - p2\[2], 2)

&#x20; );

}

6\. Defensive Stabilization \& Signal FilteringA single pixel jitter in a noisy video stream can lead to an incorrect bangle recommendation. Implement a 1D Kalman Filter to smooth raw measurements.class KalmanFilter {

&#x20; constructor(processNoise = 0.005, measurementNoise = 0.5, estimationError = 1.0, initialValue = 60.0) {

&#x20;   this.q = processNoise;       // Process noise covariance

&#x20;   this.r = measurementNoise;   // Measurement noise covariance

&#x20;   this.p = estimationError;    // Estimation error covariance

&#x20;   this.x = initialValue;       // Value estimate

&#x20;   this.k = 0;                  // Kalman gain

&#x20; }



&#x20; update(measurement) {

&#x20;   // Prediction Update

&#x20;   this.p = this.p + this.q;



&#x20;   // Measurement Update

&#x20;   this.k = this.p / (this.p + this.r);

&#x20;   this.x = this.x + this.k \* (measurement - this.x);

&#x20;   this.p = (1 - this.k) \* this.p;



&#x20;   return this.x;

&#x20; }

}



const filter = new KalmanFilter();

let stableMeasurementCount = 0;

const REQUIRED\_STABLE\_FRAMES = 45; // \~1.5 seconds of static hand tracking



function filterMeasurement(rawVal) {

&#x20; // Extreme outlier validation

&#x20; if (rawVal < 45 || rawVal > 85) return; 



&#x20; const smoothedVal = filter.update(rawVal);

&#x20; const variance = Math.abs(rawVal - smoothedVal);



&#x20; if (variance < 0.8) {

&#x20;   stableMeasurementCount++;

&#x20; } else {

&#x20;   // Reset if user is moving their hand

&#x20;   stableMeasurementCount = 0;

&#x20; }



&#x20; updateCalibrationProgress(stableMeasurementCount / REQUIRED\_STABLE\_FRAMES);



&#x20; if (stableMeasurementCount >= REQUIRED\_STABLE\_FRAMES) {

&#x20;   displayFinalBangleSize(smoothedVal);

&#x20; }

}

7\. Bangle Sizing Lookup MapBangles are traditionally sold in sizes that signify their internal diameter in inches and sixteenths of an inch.Size $2.2$: $2 \\text{ inches and } 2/16\\text{ inches} = 2.125 \\text{ in} \\approx 54.0\\text{ mm}$Size $2.4$: $2 \\text{ inches and } 4/16\\text{ inches} = 2.250 \\text{ in} \\approx 57.2\\text{ mm}$Size $2.6$: $2 \\text{ inches and } 6/16\\text{ inches} = 2.375 \\text{ in} \\approx 60.3\\text{ mm}$Size $2.8$: $2 \\text{ inches and } 8/16\\text{ inches} = 2.500 \\text{ in} \\approx 63.5\\text{ mm}$Size $2.10$: $2 \\text{ inches and } 10/16\\text{ inches} = 2.625 \\text{ in} \\approx 66.7\\text{ mm}$Bangle Size Algorithmconst BANGLE\_SIZES = \[

&#x20; { size: "2.2", diameterMM: 54.0 },

&#x20; { size: "2.4", diameterMM: 57.2 },

&#x20; { size: "2.6", diameterMM: 60.3 },

&#x20; { size: "2.8", diameterMM: 63.5 },

&#x20; { size: "2.10", diameterMM: 66.7 }

];



function getRecommendedBangleSize(measuredKnuckleWidth) {

&#x20; // Add a 2mm tolerance factor for physical hand compression

&#x20; const searchDiameter = measuredKnuckleWidth - 2.0;



&#x20; for (let option of BANGLE\_SIZES) {

&#x20;   if (searchDiameter <= option.diameterMM) {

&#x20;     return option;

&#x20;   }

&#x20; }

&#x20; // Fallback for larger sizes

&#x20; return { size: "2.12+", diameterMM: 69.8 };

}

8\. Sizing Agent's Testing ChecklistTo confirm correct implementation, run through this execution sequence:\[ ] Is WebXR loading? Verify the "Start AR Sizer" button loads without throwing JavaScript browser support errors.\[ ] Check Depth Sensing: Ensure frame.getDepthInformation(view) returns a non-null object when aiming at a surface.\[ ] Address Camera Lockout: Double-check that getUserMedia is not called anywhere, and that frames are extracted directly from the WebGL rendering pipeline.\[ ] Test Hand Proximity: Verify that moving the hand closer or further from the camera does not dramatically change the calculated physical size. The values should remain stable within $\\pm 1.5\\text{ mm}$.\[ ] UI Calibration Flow: Ensure user is prompted to hold their hand flat and steady, showing a visual progress bar that locks when tracking becomes perfectly static.

