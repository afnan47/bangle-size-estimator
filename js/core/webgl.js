// WEBGL GPU DOWNSAMPLING & CAMERA TEXTURE EXTRACTOR
    // ------------------------------------------------------------------------
    function initDownsampleFBO(gl, width, height) {
      if (downsampleFBO && downsampleWidth === width && downsampleHeight === height) {
        return;
      }
      if (downsampleFBO) {
        gl.deleteFramebuffer(downsampleFBO);
        gl.deleteTexture(downsampleTexture);
      }
      downsampleWidth = width;
      downsampleHeight = height;
      
      downsampleFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, downsampleFBO);
      
      downsampleTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, downsampleTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, downsampleTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function extractWebXRFrame(gl, frame, session, cameraTexture) {
      try {
        if (!cameraTexture) {
          if (frameCount % 60 === 0) {
            console.warn("extractWebXRFrame called but cameraTexture is null.");
          }
          return null;
        }

        const baseLayer = session.renderState.baseLayer;
        if (!baseLayer) return null;

        const pose = frame.getViewerPose(xrRefSpace);
        if (!pose || pose.views.length === 0) return null;

        const view = pose.views[0];
        const viewport = baseLayer.getViewport(view);
        if (!viewport || viewport.width === 0 || viewport.height === 0) return null;

        // Ensure we have valid camera dimensions from WebXR Raw Camera
        const cameraWidth = view.camera ? view.camera.width : viewport.width;
        const cameraHeight = view.camera ? view.camera.height : viewport.height;

        // Downsample to a target size of max 512px maintaining aspect ratio
        const maxDim = 512;
        let targetWidth = maxDim;
        let targetHeight = maxDim;
        
        if (cameraWidth > cameraHeight) {
          targetHeight = Math.round((cameraHeight / cameraWidth) * maxDim);
        } else {
          targetWidth = Math.round((cameraWidth / cameraHeight) * maxDim);
        }

        const pixels = new Uint8Array(targetWidth * targetHeight * 4);

        if (gl instanceof WebGL2RenderingContext) {
          // 1. Initialize downsample framebuffer
          initDownsampleFBO(gl, targetWidth, targetHeight);

          // 2. Initialize and bind camera framebuffer
          if (!cameraFBO) {
            cameraFBO = gl.createFramebuffer();
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, cameraFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);

          const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
          if (status !== gl.FRAMEBUFFER_COMPLETE) {
            if (frameCount % 60 === 0) {
              console.warn("Camera FBO is incomplete: " + status);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return null;
          }

          // 3. Blit from Camera FBO to Downsample FBO (linear resizing)
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cameraFBO);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, downsampleFBO);
          gl.blitFramebuffer(
            0, 0, cameraWidth, cameraHeight,
            0, 0, targetWidth, targetHeight,
            gl.COLOR_BUFFER_BIT,
            gl.LINEAR
          );

          // 4. Read pixels asynchronously using PBOs if upgraded mode is active
          if (isUpgradedSizerMode) {
            const sizeInBytes = targetWidth * targetHeight * 4;
            // Initialize PBOs if needed
            if (!isPboInitialized) {
              pboBuffers[0] = gl.createBuffer();
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[0]);
              gl.bufferData(gl.PIXEL_PACK_BUFFER, sizeInBytes, gl.STREAM_READ);

              pboBuffers[1] = gl.createBuffer();
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[1]);
              gl.bufferData(gl.PIXEL_PACK_BUFFER, sizeInBytes, gl.STREAM_READ);

              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
              isPboInitialized = true;
              console.log("WebGL2 Async PBO Readback initialized. Target: " + targetWidth + "x" + targetHeight);
            }

            const nextPboIndex = (activePboIndex + 1) % 2;
            const fence = pboFences[nextPboIndex];
            let readbackCompleted = false;

            if (fence) {
              const waitStatus = gl.clientWaitSync(fence, 0, 0);
              if (waitStatus === gl.ALREADY_SIGNALED || waitStatus === gl.CONDITION_SATISFIED) {
                gl.deleteSync(fence);
                pboFences[nextPboIndex] = null;
                
                // Read pixels from completed buffer
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[nextPboIndex]);
                gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                readbackCompleted = true;
              }
            }

            // Queue up the read for the current frame into the active PBO
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, downsampleFBO);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[activePboIndex]);
            gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
            pboFences[activePboIndex] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

            // Shift pointers
            activePboIndex = nextPboIndex;

            if (!readbackCompleted) {
              // GPU copy in progress, return null for this frame to avoid blocking the render loop
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              return null;
            }
          } else {
            // Synchronous fallback
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, downsampleFBO);
            gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          }
        } else {
          // WebGL1 Fallback: bind camera texture directly to FBO and read (no blit support)
          if (!cameraFBO) {
            cameraFBO = gl.createFramebuffer();
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, cameraFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);
          
          const rawPixels = new Uint8Array(cameraWidth * cameraHeight * 4);
          gl.readPixels(0, 0, cameraWidth, cameraHeight, gl.RGBA, gl.UNSIGNED_BYTE, rawPixels);
          
          // CPU scaling downsampler
          for (let y = 0; y < targetHeight; y++) {
            const srcY = Math.floor((y / targetHeight) * cameraHeight);
            for (let x = 0; x < targetWidth; x++) {
              const srcX = Math.floor((x / targetWidth) * cameraWidth);
              const srcIdx = (srcX + srcY * cameraWidth) * 4;
              const destIdx = (x + y * targetWidth) * 4;
              pixels[destIdx] = rawPixels[srcIdx];
              pixels[destIdx+1] = rawPixels[srcIdx+1];
              pixels[destIdx+2] = rawPixels[srcIdx+2];
              pixels[destIdx+3] = rawPixels[srcIdx+3];
            }
          }
        }

        // Restore default framebuffer binding
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Debug check to verify FBO pixels are not completely blank
        if (frameCount % 60 === 0) {
          let allZero = true;
          const stride = Math.floor(pixels.length / 200);
          for (let i = 0; i < pixels.length; i += stride) {
            if (pixels[i] !== 0) { allZero = false; break; }
          }
          console.log("FBO Blit Check - targetWidth: " + targetWidth + ", targetHeight: " + targetHeight + ", is FBO buffer blank?", allZero);
        }

        // Draw pixel data onto canvas for MediaPipe input
        offscreenCanvas.width = targetWidth;
        offscreenCanvas.height = targetHeight;
        const imageData = offscreenCtx.createImageData(targetWidth, targetHeight);

        // Flip image vertically since WebGL framebuffer origin is bottom-left
        for (let y = 0; y < targetHeight; y++) {
          const srcRow = y * targetWidth * 4;
          const destRow = (targetHeight - 1 - y) * targetWidth * 4;
          imageData.data.set(pixels.subarray(srcRow, srcRow + targetWidth * 4), destRow);
        }

        offscreenCtx.putImageData(imageData, 0, 0);
        return offscreenCanvas;
      } catch (err) {
        console.error("Error in extractWebXRFrame:", err);
        return null;
      }
    }

    // ------------------------------------------------------------------------
    