# WebXR Bangle Size Estimator 💍

A production-grade, contactless bangle size sizer custom-built for **Saubhagya Bangles**. This application leverages hardware-calibrated depth-sensing via the **WebXR Depth-Sensing API** on supported Android devices, falling back to a webcam-based **MediaPipe Hands** skeleton model on iOS and unsupported devices.

The tool guides users through onboarding and calibrates a high-precision measurement of their knuckles, mapping the width to traditional Indian/bridal bangle sizes (e.g., `2.2`, `2.4`, `2.6`, `2.8`, `2.10`).

---

## 🌟 Key Features

*   **Dual-Engine Pipeline:**
    *   **WebXR Precision Scan:** Uses raw hardware depth buffers (`immersive-ar` session with `depth-sensing` and `camera-access` features) for true metric-scale precision on Android Chrome.
    *   **Camera Estimate (MediaPipe Fallback):** Uses MediaPipe Hands to track 21 skeleton landmarks from any standard web camera (iOS/Safari, Desktop, etc.).
*   **Onboarding & UI Experience:**
    *   Luxurious theme styled in deep burgundy (`#0a0104`), gold accents (`#d4af37`), and premium typography (Cormorant Garamond & Montserrat).
    *   Interactive step-by-step instructions carousel with custom inline-SVG vector illustrations showing proper hand squeezing, positioning, and camera alignment.
    *   **Touch Swipe & Mobile Layout Optimizations:** Added full touch swipe navigation support for the onboarding instructions carousel, alongside compact, responsive CSS adjustments to prevent vertical overflow and clipping on shorter viewports (< 840px height) and narrow mobile screens.
    *   **Expandable Boutique & Developer Easter Egg:** Features a premium expandable boutique info drawer with collapsible details and a direct Google Maps integration. Triple-tapping the boutique logo triggers a progressive haptic vibration sequence and unlocks a hidden link directly to this repository.
    *   Dynamic QR code mobile handoff card for desktop visitors to seamlessly scan and open on mobile browsers.
*   **Signal Filtering & Tremor Resistance:**
    *   **3D One-Euro Filter:** Applied to key knuckles to damp high-frequency hand tremors while maintaining low latency.
    *   **Coplanar Normal Rotation:** Reconstructs the 3D plane of the palm to correct perspective projection errors.
    *   **Pitch & Distance Safeguards:** Restricts measurements when the hand is tilted beyond 15° or held at incorrect distances (ideal range: 15 cm to 1.0 m) with live HUD gauge indicators.
*   **Interactive Simulation Testbed & Automated Benchmark:**
    *   Built-in UI panel to simulate hand metrics, pitch, depth, and noise (Gaussian jitter, distance drift).
    *   Live Landmark Feed: Feeds noisy simulated coordinate structures directly into the live WebGL/Canvas overlay.
    *   Accuracy Test Suite: Runs 10 trials of 300 frames each to compare performance metrics (MAE, locked width deviation, jitter standard deviation, calibration speed) between the baseline (1D Kalman) and upgraded sizer pipelines.
*   **Serverless Telemetry & Feedback Backend:**
    *   Node.js API Route for Vercel/Netlify (`/api/log-feedback`) to record anonymous sizer accuracy events.
    *   Supabase Database integration (CORS-configured table writes) to log session data, platforms, approximate geographic origin, recommended size, and customer validation feedback.

---

## 📁 Codebase Architecture

```filepath
bangle-size-estimator/
├── .env                       # Environment configurations for Supabase write keys
├── .gitignore                 # Standard exclusions (.env, .vercel, etc.)
├── index.html                 # App layout, onboarding screens, HUDs, and overlays
├── optimized_parameters.json  # Simulation results showing default vs optimized parameters
├── privacy.html               # Customer data privacy guidelines
├── terms.html                 # Terms of service page
├── api/
│   └── log-feedback.js        # Serverless telemetry handler (Node.js API Route)
├── css/
│   ├── variables.css          # Core design tokens, gradients, and font families
│   ├── layout.css             # Page grids, responsive heights, and flex boxes
│   ├── animations.css         # Keyframe loaders, fade-ins, and spring physics easing
│   └── components/
│       ├── ar-hud.css         # Scanning dashboard, metrics bars, and live gauges
│       ├── carousel.css       # Instruction slider carousel styles
│       ├── modals.css         # Sizing results card, feedback panel, and share dialogs
│       └── testbed.css        # Simulator interface styles
└── js/
    ├── core/
    │   ├── state.js           # Global parameters, filter initializers, and preallocated memory
    │   ├── init.js            # Page load bindings, UI listeners, and feedback loops
    │   ├── ar-engine.js       # WebXR session management and fallbacks
    │   ├── hand-tracking.js   # MediaPipe Hands library loaders and processing
    │   ├── tracking-engine.js # Calibration state machine, safeguards, and size mapping
    │   ├── simulation.js      # Landmark projection math for the canvas overlay
    │   ├── xr-tick.js         # Tick lifecycle for requestAnimationFrame loops
    │   ├── webgl.js           # WebGL helper context, shaders, and PBO bindings
    │   └── testbed.js         # Benchmark runner and Box-Muller Gaussian noise simulation
    ├── ui/
    │   ├── carousel.js        # Slide controller with progress dots
    │   └── graphics.js        # Canvas overlay renderers (skeleton joints, gold sizer rings)
    └── utils/
        ├── constants.js       # Knuckle-to-bangle size tables (inner diameters)
        ├── filters.js         # 1D Kalman, One-Euro, and Trimmed Mean algorithms
        ├── math.js            # Custom 3D vector and matrix projections
        ├── telemetry.js       # UUID-enabled client telemetry event dispatcher
        └── debug.js           # Custom float debug overlay logger
```

---

## 📐 Sizing and Calibration Math

The core tracking module maps the knuckle width (index base to pinky base joint span) to traditional Indian bangle sizes.

### 1. Bangle Size Mapping Table

| Bangle Size | Inner Diameter (mm) | Knuckle Width Threshold (Calibrated mm)* |
| :---: | :---: | :---: |
| **2.2** | 54.0 mm | $\le$ 56.0 mm |
| **2.4** | 57.2 mm | 56.0 mm – 59.0 mm |
| **2.6** | 60.3 mm | 59.0 mm – 62.0 mm |
| **2.8** | 63.5 mm | 62.0 mm – 65.0 mm |
| **2.10** | 66.7 mm | $\gt$ 65.0 mm |

*\*Calibration adjusts measured knuckle width based on previous successful client recommendations saved in `localStorage`.*

### 2. Math & Safeguards Pipeline

1.  **Coordinate Extraction:** Obtains 3D landmarks for landmark `5` ($p_5$, Index base MCP) and `17` ($p_{17}$, Pinky base MCP).
2.  **Depth Sensing:** Queries the WebXR depth texture at $(u_5, v_5)$ and $(u_{17}, v_{17})$ using median-filtered CPU-based depth lookup.
3.  **Unprojection:** Converts normalized screen coordinate landmarks to camera space metrics $(X, Y, Z)$ using:
    $$\begin{bmatrix} X_{cam} \\ Y_{cam} \\ Z_{cam} \end{bmatrix} = \text{unproject}(\text{screen\_coord}, \text{depth}, \text{projection\_matrix})$$
4.  **Pitch (Tilt) Correction:** Reconstructs the palm's unit normal vector using the wrist joint ($p_0$) as the plane origin:
    $$\vec{v}_1 = p_5 - p_0, \quad \vec{v}_2 = p_{17} - p_0$$
    $$\vec{n} = \vec{v}_1 \times \vec{v}_2, \quad \hat{n} = \frac{\vec{n}}{\|\vec{n}\|}$$
    $$\theta_{\text{pitch}} = \arccos(|\hat{n}_z|)$$
    If $\theta_{\text{pitch}} > 15^\circ$, the pipeline flags **Unstable (Tilted)** and pauses calibration to prevent foreshortening underestimation.
5.  **3D Jitter Reduction:** Passes coordinates through a `OneEuroFilter3D` with dynamic cutoff adjustment (optimized parameters via simulation: $f_{\text{min}} = 0.96$, $\beta = 0.00106$, $d_{\text{cutoff}} = 1.385$):
    $$\alpha = \frac{1}{1 + \frac{\tau}{\Delta t}}, \quad f_{\text{cutoff}} = f_{\text{min}} + \beta \cdot |dx|$$
6.  **Sizing Confirmation:** Buffers the last 60 frames (2 seconds at 30fps) in a sliding window. It takes an optimized **28% trimmed mean** (updated from 20%) to eliminate tremor outliers. Once the sliding-window standard deviation $\sigma < 1.54\text{ mm}$ (or $0.154\text{ cm}$, updated from $1.5\text{ mm}$) over **40 consecutive frames** (approx. 1.33 seconds, optimized from 45 frames), the measurement locks.

---

## ⚡ Deployment & Local Setup

### 1. Run Locally

This project runs as a static site. You can start it using any simple local server:

Using `npx` (Live Server):
```bash
npx live-server
```

Or Python:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` (or `http://127.0.0.1:8000`) in your browser.

> [!IMPORTANT]
> **HTTPS Obligation:** The WebXR API and standard camera access APIs require a secure context (`HTTPS`) to function. For testing on physical mobile devices, serve the project over HTTPS (e.g. using `ngrok` or deploying to Vercel/Netlify) or add your local IP port to Chrome's `Insecure origins treated as secure` flag (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`).

---

### 2. Set Up Telemetry (Supabase + Vercel Functions)

To capture sizer diagnostics, configure the following environment variables on Vercel:

1.  Initialize a Supabase table named `bangle_sizer_telemetry` with the schema outlined below.
2.  Add your credentials to your Vercel project environment variables (or local `.env`):
    ```ini
    SUPABASE_URL=https://<your-project-id>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=<your-service-role-api-key>
    SUPABASE_TELEMETRY_TABLE=bangle_sizer_telemetry
    ```

#### Recommended Supabase Table Schema SQL:
```sql
CREATE TABLE bangle_sizer_telemetry (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    device_platform VARCHAR(50),
    raw_knuckle_width_mm NUMERIC,
    calibration_scale NUMERIC,
    recommended_size VARCHAR(20),
    user_size VARCHAR(20),
    is_correct BOOLEAN,
    approximate_location VARCHAR(10)
);

-- Indices for reporting
CREATE INDEX idx_telemetry_event_type ON bangle_sizer_telemetry(event_type);
CREATE INDEX idx_telemetry_session ON bangle_sizer_telemetry(session_id);
```

---

### 3. Deploying to Vercel

The repository is pre-configured with Vercel serverless functions layout. You can deploy it instantly:

```bash
# Install Vercel CLI (if not already installed)
npm install -g vercel

# Deploy project to production
vercel --prod
```

---

## 📱 Supported Devices

1.  **WebXR Precision Scan:**
    *   **OS:** Android (9.0+)
    *   **Browsers:** Google Chrome (v80+), Samsung Internet, Microsoft Edge
    *   **Requirements:** Google Play Services for AR (ARCore) installed
2.  **Camera Estimate Fallback:**
    *   **OS:** iOS (14.0+), macOS, Windows, Linux
    *   **Browsers:** Safari, Google Chrome, Firefox, Opera, Edge
    *   **Requirements:** A front/rear camera with decent lighting
