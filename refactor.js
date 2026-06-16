
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, 'js');
const cssDir = path.join(__dirname, 'css');

// Read app.js
const appJsContent = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf-8');

// Define extraction logic
function extractSection(content, startMarker, endMarker) {
    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) return '';
    const endIndex = endMarker ? content.indexOf(endMarker, startIndex + startMarker.length) : content.length;
    return content.substring(startIndex, endIndex === -1 ? content.length : endIndex);
}

// Ensure directories exist
['js/utils', 'js/ui', 'js/core', 'css/components'].forEach(dir => {
    fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
});

// SPLIT CSS (Disabled because CSS is already permanently split and styles.css is now an import hub)

// SPLIT JS (using global script loading to avoid complex ES module refactoring for 2200 lines of highly coupled code)
const debugJS = extractSection(appJsContent, '// ONSCREEN DEBUG CONSOLE LOGGER', '// CONSTANTS & CONFIGURATION');
const constantsJS = extractSection(appJsContent, '// CONSTANTS & CONFIGURATION', '// SIGNAL STABILIZATION: 1D KALMAN FILTER');
const filtersJS = extractSection(appJsContent, '// SIGNAL STABILIZATION: 1D KALMAN FILTER', '// VECTOR MATH HELPERS');
const mathJS = extractSection(appJsContent, '// VECTOR MATH HELPERS', '// GLOBAL STATE');
const stateJS = extractSection(appJsContent, '// GLOBAL STATE', '// APPLICATION LIFECYCLE INITIALIZATION');
const initJS = extractSection(appJsContent, '// APPLICATION LIFECYCLE INITIALIZATION', '// WEBXR & GL RUNTIME INITIALIZATION');
const arEngineJS = extractSection(appJsContent, '// WEBXR & GL RUNTIME INITIALIZATION', '// PC UI/UX TEST SIMULATION ENGINES');
const simulationJS = extractSection(appJsContent, '// PC UI/UX TEST SIMULATION ENGINES', '// RETURNING USER NAVIGATION GATE');
const carouselJS = extractSection(appJsContent, '// RETURNING USER NAVIGATION GATE', '// WEBGL GPU DOWNSAMPLING');
const webglJS = extractSection(appJsContent, '// WEBGL GPU DOWNSAMPLING', '// WEBXR FRAME TICK & MEDIAPIPE SCHEDULER');
const xrTickJS = extractSection(appJsContent, '// WEBXR FRAME TICK & MEDIAPIPE SCHEDULER', '// HAND DETECTION & COORDINATE TRANSLATION');
const handTrackingJS = extractSection(appJsContent, '// HAND DETECTION & COORDINATE TRANSLATION', '// TRACKING HANDLER & STABILITY ENGINE');
const trackingEngineJS = extractSection(appJsContent, '// TRACKING HANDLER & STABILITY ENGINE', '// SCREEN SPACE DRAWING LAYER');
const graphicsJS = extractSection(appJsContent, '// SCREEN SPACE DRAWING LAYER & BANGLE OVERLAY', '// SIMULATOR TESTBED ENGINE');
const testbedJS = extractSection(appJsContent, '// =========================================================================\n    // SIMULATOR TESTBED ENGINE', null) || extractSection(appJsContent, '// SIMULATOR TESTBED ENGINE', null);

fs.writeFileSync(path.join(jsDir, 'utils', 'debug.js'), debugJS);
fs.writeFileSync(path.join(jsDir, 'utils', 'constants.js'), constantsJS);
fs.writeFileSync(path.join(jsDir, 'utils', 'filters.js'), filtersJS);
fs.writeFileSync(path.join(jsDir, 'utils', 'math.js'), mathJS);
fs.writeFileSync(path.join(jsDir, 'core', 'state.js'), stateJS);
fs.writeFileSync(path.join(jsDir, 'core', 'init.js'), initJS);
fs.writeFileSync(path.join(jsDir, 'core', 'ar-engine.js'), arEngineJS);
fs.writeFileSync(path.join(jsDir, 'core', 'simulation.js'), simulationJS);
fs.writeFileSync(path.join(jsDir, 'ui', 'carousel.js'), carouselJS);
fs.writeFileSync(path.join(jsDir, 'core', 'webgl.js'), webglJS);
fs.writeFileSync(path.join(jsDir, 'core', 'xr-tick.js'), xrTickJS);
fs.writeFileSync(path.join(jsDir, 'core', 'hand-tracking.js'), handTrackingJS);
fs.writeFileSync(path.join(jsDir, 'core', 'tracking-engine.js'), trackingEngineJS);
fs.writeFileSync(path.join(jsDir, 'ui', 'graphics.js'), graphicsJS);
fs.writeFileSync(path.join(jsDir, 'core', 'testbed.js'), testbedJS);

console.log("Refactoring complete");
