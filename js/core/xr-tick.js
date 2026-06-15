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
    