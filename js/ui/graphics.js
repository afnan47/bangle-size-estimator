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
    