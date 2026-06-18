// SCREEN SPACE DRAWING LAYER & BANGLE OVERLAY
    // ------------------------------------------------------------------------
    // Preallocated temporary arrays for graphics math to avoid GC pressure
    const g_v1 = [0, 0, 0];
    const g_v2 = [0, 0, 0];
    const g_normalVec = [0, 0, 0];
    const g_unitNormal = [0, 0, 0];
    const g_ampNormal = [0, 0, 0];
    const g_uDir = [1, 0, 0];
    const g_wDir = [0, 1, 0];

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

    function drawMediaPipeSkeleton(landmarks, isValid) {
      if (!landmarks || landmarks.length !== 21 || !landmarks[1]) return;

      const w = overlayCanvas.width;
      const h = overlayCanvas.height;

      const dotColor = isValid ? "rgba(212, 175, 55, 0.85)" : "rgba(217, 83, 79, 0.8)";
      const lineColor = isValid ? "rgba(212, 175, 55, 0.35)" : "rgba(217, 83, 79, 0.3)";

      const fingers = [
        [0, 1, 2, 3, 4],       // Thumb
        [5, 6, 7, 8],          // Index
        [9, 10, 11, 12],       // Middle
        [13, 14, 15, 16],      // Ring
        [17, 18, 19, 20]       // Pinky
      ];

      overlayCtx.save();
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeStyle = lineColor;
      overlayCtx.fillStyle = dotColor;

      fingers.forEach(chain => {
        overlayCtx.beginPath();
        for (let i = 0; i < chain.length; i++) {
          const pt = landmarks[chain[i]];
          if (!pt) continue;
          const x = pt.x * w;
          const y = pt.y * h;
          if (i === 0) {
            overlayCtx.moveTo(x, y);
          } else {
            overlayCtx.lineTo(x, y);
          }
        }
        overlayCtx.stroke();
      });

      // Palm connector
      const palmChain = [0, 5, 9, 13, 17, 0];
      overlayCtx.beginPath();
      palmChain.forEach((idx, i) => {
        const pt = landmarks[idx];
        if (!pt) return;
        const x = pt.x * w;
        const y = pt.y * h;
        if (i === 0) overlayCtx.moveTo(x, y);
        else overlayCtx.lineTo(x, y);
      });
      overlayCtx.stroke();

      // Joints
      for (let i = 0; i < 21; i++) {
        const pt = landmarks[i];
        if (!pt) continue;
        overlayCtx.beginPath();
        overlayCtx.arc(pt.x * w, pt.y * h, 3.5, 0, 2 * Math.PI);
        overlayCtx.fill();
      }

      overlayCtx.restore();
    }

    function drawHandWireframe(landmarks, isValid, progressFraction = 0) {
      // Draw high-fidelity MediaPipe hand skeleton if available
      drawMediaPipeSkeleton(landmarks, isValid);

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

    // Zero-latency 3D circle projected overlay with premium Kada styling
    function drawProjectedBangleOverlay(p5_3d, p17_3d, measuredWidthMM, wrist_3d = null) {
      if (!activeProjectionMatrix) return;

      const w = overlayCanvas.width;
      const h = overlayCanvas.height;

      // 1. Center of the bangle is the midpoint between knuckles 5 and 17 in view space
      const cx = (p5_3d[0] + p17_3d[0]) / 2;
      const cy = (p5_3d[1] + p17_3d[1]) / 2;
      const cz = (p5_3d[2] + p17_3d[2]) / 2;

      // 2. Set the recommended bangle radius in meters
      const recSize = getRecommendedBangleSize(measuredWidthMM);
      const diameterMeters = recSize.diameterMM / 1000;
      const radiusMeters = diameterMeters / 2;

      // 3. Generate basis vectors for palm plane alignment
      g_uDir[0] = 1; g_uDir[1] = 0; g_uDir[2] = 0;
      g_wDir[0] = 0; g_wDir[1] = 1; g_wDir[2] = 0;
      let isCoplanarAligned = false;

      if (isUpgradedSizerMode && wrist_3d) {
        subtractVectors(p5_3d, wrist_3d, g_v1);
        subtractVectors(p17_3d, wrist_3d, g_v2);
        crossProduct(g_v1, g_v2, g_normalVec);
        normalizeVector(g_normalVec, g_unitNormal);

        if (magnitude(g_unitNormal) > 0.1) {
          const ampX = g_unitNormal[0] * 2.0;
          const ampY = g_unitNormal[1] * 2.0;
          const ampZ = g_unitNormal[2];
          
          g_ampNormal[0] = ampX; g_ampNormal[1] = ampY; g_ampNormal[2] = ampZ;
          normalizeVector(g_ampNormal, g_ampNormal);

          normalizeVector(g_v1, g_uDir);
          
          crossProduct(g_uDir, g_ampNormal, g_wDir);
          normalizeVector(g_wDir, g_wDir);
          isCoplanarAligned = true;
        }
      }

      // Projection parameters (extract to avoid repetitive indexing in loop)
      const m0 = activeProjectionMatrix[0];
      const m5 = activeProjectionMatrix[5];
      const m8 = activeProjectionMatrix[8];
      const m9 = activeProjectionMatrix[9];

      // Helper to draw projected circle directly onto canvas path without allocating arrays
      function drawProjectedCircle(r, angleOffset = 0, numPoints = 60) {
        overlayCtx.beginPath();
        let first = true;
        
        for (let i = 0; i <= numPoints; i++) {
          const theta = ((i * 2 * Math.PI) / numPoints) + angleOffset;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          
          let px, py, pz;
          if (isCoplanarAligned) {
            px = cx + r * (cosT * g_uDir[0] + sinT * g_wDir[0]);
            py = cy + r * (cosT * g_uDir[1] + sinT * g_wDir[1]);
            pz = cz + r * (cosT * g_uDir[2] + sinT * g_wDir[2]);
          } else {
            px = cx + r * cosT;
            py = cy + r * sinT;
            pz = cz;
          }
          
          const w_val = -pz;
          const ndcX = (m0 * px + m8 * pz) / w_val;
          const ndcY = (m5 * py + m9 * pz) / w_val;
          const u = ((ndcX + 1) / 2) * w;
          const v = ((1 - ndcY) / 2) * h;
          
          if (first) {
            overlayCtx.moveTo(u, v);
            first = false;
          } else {
            overlayCtx.lineTo(u, v);
          }
        }
        overlayCtx.closePath();
      }

      const spinAngle = (Date.now() / 2000) % (2 * Math.PI);
      
      // Inline project3DTo2D for center point
      const center_w_val = -cz;
      const center_ndcX = (m0 * cx + m8 * cz) / center_w_val;
      const center_ndcY = (m5 * cy + m9 * cz) / center_w_val;
      const centerU = ((center_ndcX + 1) / 2) * w;
      const centerV = ((1 - center_ndcY) / 2) * h;

      // Render based on selected style
      const activeStyle = typeof selectedBangleStyle !== 'undefined' ? selectedBangleStyle : 'gold-filigree';

      if (activeStyle === 'gold-filigree') {
        // Double-ring Filigree with gold beads
        // Pre-calculate first point projected coordinate for gradient approximation
        const firstPx = cx + (radiusMeters + 0.0015) * (isCoplanarAligned ? g_uDir[0] : 1);
        const firstPy = cy + (radiusMeters + 0.0015) * (isCoplanarAligned ? g_uDir[1] : 0);
        const firstPz = cz + (radiusMeters + 0.0015) * (isCoplanarAligned ? g_uDir[2] : 0);
        const f_w = -firstPz;
        const f_ndcX = (m0 * firstPx + m8 * firstPz) / f_w;
        const f_ndcY = (m5 * firstPy + m9 * firstPz) / f_w;
        const firstU = ((f_ndcX + 1) / 2) * w;
        const firstV = ((1 - f_ndcY) / 2) * h;

        // Draw outer ring
        drawProjectedCircle(radiusMeters + 0.0015);
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, firstU, firstV);
        overlayCtx.lineWidth = 2.5;
        overlayCtx.shadowBlur = 6;
        overlayCtx.shadowColor = "rgba(212, 175, 55, 0.3)";
        overlayCtx.stroke();
        overlayCtx.shadowBlur = 0;

        // Draw inner ring
        drawProjectedCircle(radiusMeters - 0.0015);
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, firstU, firstV);
        overlayCtx.lineWidth = 1.8;
        overlayCtx.stroke();

        // Draw gold beads inside the rings directly
        const numBeads = 36;
        for (let i = 0; i <= numBeads; i++) {
          const theta = ((i * 2 * Math.PI) / numBeads) + spinAngle;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          
          let px, py, pz;
          if (isCoplanarAligned) {
            px = cx + radiusMeters * (cosT * g_uDir[0] + sinT * g_wDir[0]);
            py = cy + radiusMeters * (cosT * g_uDir[1] + sinT * g_wDir[1]);
            pz = cz + radiusMeters * (cosT * g_uDir[2] + sinT * g_wDir[2]);
          } else {
            px = cx + radiusMeters * cosT;
            py = cy + radiusMeters * sinT;
            pz = cz;
          }
          
          const w_val = -pz;
          const ndcX = (m0 * px + m8 * pz) / w_val;
          const ndcY = (m5 * py + m9 * pz) / w_val;
          const u = ((ndcX + 1) / 2) * w;
          const v = ((1 - ndcY) / 2) * h;
          
          overlayCtx.beginPath();
          overlayCtx.arc(u, v, 3.5, 0, 2 * Math.PI);
          overlayCtx.fillStyle = getGoldGradient(u, v, u + 2, v + 2);
          overlayCtx.fill();
          overlayCtx.strokeStyle = "rgba(23, 4, 10, 0.4)";
          overlayCtx.lineWidth = 0.5;
          overlayCtx.stroke();
        }

      } else if (activeStyle === 'kundan-kada') {
        // Thick Kundan band with glowing rubies and emeralds
        const firstPx = cx + radiusMeters * (isCoplanarAligned ? g_uDir[0] : 1);
        const firstPy = cy + radiusMeters * (isCoplanarAligned ? g_uDir[1] : 0);
        const firstPz = cz + radiusMeters * (isCoplanarAligned ? g_uDir[2] : 0);
        const f_w = -firstPz;
        const f_ndcX = (m0 * firstPx + m8 * firstPz) / f_w;
        const f_ndcY = (m5 * firstPy + m9 * firstPz) / f_w;
        const firstU = ((f_ndcX + 1) / 2) * w;
        const firstV = ((1 - f_ndcY) / 2) * h;

        // Draw base band
        drawProjectedCircle(radiusMeters);
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, firstU, firstV);
        overlayCtx.lineWidth = 7.5;
        overlayCtx.shadowBlur = 10;
        overlayCtx.shadowColor = "rgba(212, 175, 55, 0.4)";
        overlayCtx.stroke();
        overlayCtx.shadowBlur = 0;

        // Draw gems (alternating rubies and emeralds)
        const numGems = 12;
        for (let index = 0; index <= numGems; index++) {
          const theta = ((index * 2 * Math.PI) / numGems) + spinAngle;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          
          let px, py, pz;
          if (isCoplanarAligned) {
            px = cx + radiusMeters * (cosT * g_uDir[0] + sinT * g_wDir[0]);
            py = cy + radiusMeters * (cosT * g_uDir[1] + sinT * g_wDir[1]);
            pz = cz + radiusMeters * (cosT * g_uDir[2] + sinT * g_wDir[2]);
          } else {
            px = cx + radiusMeters * cosT;
            py = cy + radiusMeters * sinT;
            pz = cz;
          }
          
          const w_val = -pz;
          const ndcX = (m0 * px + m8 * pz) / w_val;
          const ndcY = (m5 * py + m9 * pz) / w_val;
          const u = ((ndcX + 1) / 2) * w;
          const v = ((1 - ndcY) / 2) * h;
          
          // Gem base border
          overlayCtx.beginPath();
          overlayCtx.arc(u, v, 4.5, 0, 2 * Math.PI);
          overlayCtx.fillStyle = "rgba(212, 175, 55, 0.95)";
          overlayCtx.fill();

          // Gem center stone
          overlayCtx.beginPath();
          overlayCtx.arc(u, v, 2.5, 0, 2 * Math.PI);
          const isRuby = index % 2 === 0;
          overlayCtx.fillStyle = isRuby ? "#e63946" : "#2a9d8f"; // Ruby red or Emerald green
          overlayCtx.fill();
          
          // Sparkle dot
          overlayCtx.beginPath();
          overlayCtx.arc(u - 1, v - 1, 0.8, 0, 2 * Math.PI);
          overlayCtx.fillStyle = "#ffffff";
          overlayCtx.fill();
        }

      } else if (activeStyle === 'polki-kada') {
        // Antique gold band with sparkling uncut diamonds
        const firstPx = cx + radiusMeters * (isCoplanarAligned ? g_uDir[0] : 1);
        const firstPy = cy + radiusMeters * (isCoplanarAligned ? g_uDir[1] : 0);
        const firstPz = cz + radiusMeters * (isCoplanarAligned ? g_uDir[2] : 0);
        const f_w = -firstPz;
        const f_ndcX = (m0 * firstPx + m8 * firstPz) / f_w;
        const f_ndcY = (m5 * firstPy + m9 * firstPz) / f_w;
        const firstU = ((f_ndcX + 1) / 2) * w;
        const firstV = ((1 - f_ndcY) / 2) * h;

        // Base band
        drawProjectedCircle(radiusMeters);
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, firstU, firstV, true);
        overlayCtx.lineWidth = 6;
        overlayCtx.stroke();

        // Draw Polki stones (octagon cut diamonds)
        const numStones = 8;
        for (let index = 0; index < numStones; index++) {
          const theta = ((index * 2 * Math.PI) / numStones) + spinAngle;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          
          let px, py, pz;
          if (isCoplanarAligned) {
            px = cx + radiusMeters * (cosT * g_uDir[0] + sinT * g_wDir[0]);
            py = cy + radiusMeters * (cosT * g_uDir[1] + sinT * g_wDir[1]);
            pz = cz + radiusMeters * (cosT * g_uDir[2] + sinT * g_wDir[2]);
          } else {
            px = cx + radiusMeters * cosT;
            py = cy + radiusMeters * sinT;
            pz = cz;
          }
          
          const w_val = -pz;
          const ndcX = (m0 * px + m8 * pz) / w_val;
          const ndcY = (m5 * py + m9 * pz) / w_val;
          const u = ((ndcX + 1) / 2) * w;
          const v = ((1 - ndcY) / 2) * h;
          
          overlayCtx.beginPath();
          // Uncut diamond shape (octagon)
          for (let step = 0; step < 8; step++) {
            const angle = (step * Math.PI) / 4;
            const px_stone = u + 4.5 * Math.cos(angle);
            const py_stone = v + 4.5 * Math.sin(angle);
            if (step === 0) overlayCtx.moveTo(px_stone, py_stone);
            else overlayCtx.lineTo(px_stone, py_stone);
          }
          overlayCtx.closePath();
          
          // Diamond radial reflection gradient
          const gemGrad = overlayCtx.createRadialGradient(u - 1, v - 1, 0.5, u, v, 4.5);
          gemGrad.addColorStop(0, "#ffffff");
          gemGrad.addColorStop(0.3, "#e9ecef");
          gemGrad.addColorStop(0.7, "#ced4da");
          gemGrad.addColorStop(1, "#adb5bd");
          overlayCtx.fillStyle = gemGrad;
          overlayCtx.fill();

          overlayCtx.strokeStyle = "rgba(212, 175, 55, 0.85)";
          overlayCtx.lineWidth = 1;
          overlayCtx.stroke();
        }
      }

      // Helper to construct gold gradient dynamically
      function getGoldGradient(cx_val, cy_val, tx, ty, isAntique = false) {
        const grad = overlayCtx.createLinearGradient(cx_val - 50, cy_val - 50, cx_val + 50, cy_val + 50);
        if (isAntique) {
          grad.addColorStop(0, '#705313');
          grad.addColorStop(0.5, '#c5a880');
          grad.addColorStop(1, '#503b0c');
        } else {
          grad.addColorStop(0, '#8a640f');
          grad.addColorStop(0.35, '#f5e2b3');
          grad.addColorStop(0.5, '#d4af37');
          grad.addColorStop(0.65, '#f5e2b3');
          grad.addColorStop(1, '#8a640f');
        }
        return grad;
      }

      // Draw sizing tag near the bangle circle center
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
    