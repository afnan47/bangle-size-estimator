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

    // Zero-latency 3D circle projected overlay with premium Kada styling
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
      const recSize = getRecommendedBangleSize(measuredWidthMM);
      const diameterMeters = recSize.diameterMM / 1000;
      const radiusMeters = diameterMeters / 2;

      // 3. Generate basis vectors for palm plane alignment
      let uDir = [1, 0, 0];
      let wDir = [0, 1, 0];
      let isCoplanarAligned = false;

      if (isUpgradedSizerMode && wrist_3d) {
        const v1 = subtractVectors(p5_3d, wrist_3d);
        const v2 = subtractVectors(p17_3d, wrist_3d);
        const normalVec = crossProduct(v1, v2);
        const unitNormal = normalizeVector(normalVec);

        if (magnitude(unitNormal) > 0.1) {
          const ampX = unitNormal[0] * 2.0;
          const ampY = unitNormal[1] * 2.0;
          const ampZ = unitNormal[2];
          const ampNormal = normalizeVector([ampX, ampY, ampZ]);

          uDir = normalizeVector(v1);
          wDir = normalizeVector(crossProduct(uDir, ampNormal));
          isCoplanarAligned = true;
        }
      }

      // Helper to generate points
      function getProjectedPoints(r, angleOffset = 0, numPoints = 60) {
        const points = [];
        for (let i = 0; i <= numPoints; i++) {
          const theta = ((i * 2 * Math.PI) / numPoints) + angleOffset;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          
          let p_view;
          if (isCoplanarAligned) {
            p_view = [
              cx + r * (cosT * uDir[0] + sinT * wDir[0]),
              cy + r * (cosT * uDir[1] + sinT * wDir[1]),
              cz + r * (cosT * uDir[2] + sinT * wDir[2])
            ];
          } else {
            p_view = [
              cx + r * cosT,
              cy + r * sinT,
              cz
            ];
          }
          const [u, v] = project3DTo2D(p_view, activeProjectionMatrix, w, h);
          points.push([u, v]);
        }
        return points;
      }

      const spinAngle = (Date.now() / 2000) % (2 * Math.PI);
      const [centerU, centerV] = project3DTo2D(center, activeProjectionMatrix, w, h);

      // Render based on selected style
      const activeStyle = typeof selectedBangleStyle !== 'undefined' ? selectedBangleStyle : 'gold-filigree';

      if (activeStyle === 'gold-filigree') {
        // Double-ring Filigree with gold beads
        const outerPoints = getProjectedPoints(radiusMeters + 0.0015);
        const innerPoints = getProjectedPoints(radiusMeters - 0.0015);
        const beadPoints = getProjectedPoints(radiusMeters, spinAngle, 36);

        // Draw outer ring
        overlayCtx.beginPath();
        overlayCtx.moveTo(outerPoints[0][0], outerPoints[0][1]);
        for (let i = 1; i < outerPoints.length; i++) {
          overlayCtx.lineTo(outerPoints[i][0], outerPoints[i][1]);
        }
        overlayCtx.closePath();
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, outerPoints[0][0], outerPoints[0][1]);
        overlayCtx.lineWidth = 2.5;
        overlayCtx.shadowBlur = 6;
        overlayCtx.shadowColor = "rgba(212, 175, 55, 0.3)";
        overlayCtx.stroke();
        overlayCtx.shadowBlur = 0;

        // Draw inner ring
        overlayCtx.beginPath();
        overlayCtx.moveTo(innerPoints[0][0], innerPoints[0][1]);
        for (let i = 1; i < innerPoints.length; i++) {
          overlayCtx.lineTo(innerPoints[i][0], innerPoints[i][1]);
        }
        overlayCtx.closePath();
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, innerPoints[0][0], innerPoints[0][1]);
        overlayCtx.lineWidth = 1.8;
        overlayCtx.stroke();

        // Draw gold beads inside the rings
        beadPoints.forEach(([u, v]) => {
          overlayCtx.beginPath();
          overlayCtx.arc(u, v, 3.5, 0, 2 * Math.PI);
          overlayCtx.fillStyle = getGoldGradient(u, v, u + 2, v + 2);
          overlayCtx.fill();
          overlayCtx.strokeStyle = "rgba(23, 4, 10, 0.4)";
          overlayCtx.lineWidth = 0.5;
          overlayCtx.stroke();
        });

      } else if (activeStyle === 'kundan-kada') {
        // Thick Kundan band with glowing rubies and emeralds
        const bandPoints = getProjectedPoints(radiusMeters);
        
        // Draw base band
        overlayCtx.beginPath();
        overlayCtx.moveTo(bandPoints[0][0], bandPoints[0][1]);
        for (let i = 1; i < bandPoints.length; i++) {
          overlayCtx.lineTo(bandPoints[i][0], bandPoints[i][1]);
        }
        overlayCtx.closePath();
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, bandPoints[0][0], bandPoints[0][1]);
        overlayCtx.lineWidth = 7.5;
        overlayCtx.shadowBlur = 10;
        overlayCtx.shadowColor = "rgba(212, 175, 55, 0.4)";
        overlayCtx.stroke();
        overlayCtx.shadowBlur = 0;

        // Draw gems (alternating rubies and emeralds)
        const numGems = 12;
        const gemPoints = getProjectedPoints(radiusMeters, spinAngle, numGems);
        gemPoints.forEach(([u, v], index) => {
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
        });

      } else if (activeStyle === 'polki-kada') {
        // Antique gold band with sparkling uncut diamonds
        const basePoints = getProjectedPoints(radiusMeters);
        
        // Base band
        overlayCtx.beginPath();
        overlayCtx.moveTo(basePoints[0][0], basePoints[0][1]);
        for (let i = 1; i < basePoints.length; i++) {
          overlayCtx.lineTo(basePoints[i][0], basePoints[i][1]);
        }
        overlayCtx.closePath();
        overlayCtx.strokeStyle = getGoldGradient(centerU, centerV, basePoints[0][0], basePoints[0][1], true);
        overlayCtx.lineWidth = 6;
        overlayCtx.stroke();

        // Draw Polki stones (octagon cut diamonds)
        const numStones = 8;
        const stonePoints = getProjectedPoints(radiusMeters, spinAngle, numStones);
        stonePoints.forEach(([u, v]) => {
          overlayCtx.beginPath();
          // Uncut diamond shape (octagon)
          for (let step = 0; step < 8; step++) {
            const angle = (step * Math.PI) / 4;
            const px = u + 4.5 * Math.cos(angle);
            const py = v + 4.5 * Math.sin(angle);
            if (step === 0) overlayCtx.moveTo(px, py);
            else overlayCtx.lineTo(px, py);
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
        });
      }

      // Helper to construct gold gradient dynamically
      function getGoldGradient(cx, cy, tx, ty, isAntique = false) {
        const grad = overlayCtx.createLinearGradient(cx - 50, cy - 50, cx + 50, cy + 50);
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
    