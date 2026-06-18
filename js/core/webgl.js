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

        const sizeInBytes = targetWidth * targetHeight * 4;

        // Ensure cache buffers are allocated and matching dimensions
        if (!cachedPixels || cachedPixels.length !== sizeInBytes) {
          cachedPixels = new Uint8Array(sizeInBytes);
          cachedPixels32 = new Uint32Array(cachedPixels.buffer);
          
          offscreenCanvas.width = targetWidth;
          offscreenCanvas.height = targetHeight;
          cachedImageData = offscreenCtx.createImageData(targetWidth, targetHeight);
          console.log(`Allocated/resized frame caches. targetWidth: ${targetWidth}, targetHeight: ${targetHeight}`);
        }

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
                
                // Read pixels from completed buffer directly into cachedPixels
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboBuffers[nextPboIndex]);
                gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, cachedPixels);
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
            // Synchronous fallback into cachedPixels
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, downsampleFBO);
            gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, cachedPixels);
          }
        } else {
          // WebGL1 Fallback: bind camera texture directly to FBO and read (no blit support)
          if (!cameraFBO) {
            cameraFBO = gl.createFramebuffer();
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, cameraFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);
          
          if (!cachedRawPixels || cachedRawPixels.length !== cameraWidth * cameraHeight * 4) {
            cachedRawPixels = new Uint8Array(cameraWidth * cameraHeight * 4);
          }
          gl.readPixels(0, 0, cameraWidth, cameraHeight, gl.RGBA, gl.UNSIGNED_BYTE, cachedRawPixels);
          
          // CPU scaling downsampler using 32-bit views
          const rawPixels32 = new Uint32Array(cachedRawPixels.buffer);
          const pixels32 = cachedPixels32;
          
          for (let y = 0; y < targetHeight; y++) {
            const srcY = Math.floor((y / targetHeight) * cameraHeight);
            const srcIdxOffset = srcY * cameraWidth;
            const destIdxOffset = y * targetWidth;
            for (let x = 0; x < targetWidth; x++) {
              const srcX = Math.floor((x / targetWidth) * cameraWidth);
              pixels32[destIdxOffset + x] = rawPixels32[srcIdxOffset + srcX];
            }
          }
        }

        // Restore default framebuffer binding
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Debug check to verify FBO pixels are not completely blank
        if (frameCount % 60 === 0) {
          let allZero = true;
          const stride = Math.floor(cachedPixels.length / 200);
          for (let i = 0; i < cachedPixels.length; i += stride) {
            if (cachedPixels[i] !== 0) { allZero = false; break; }
          }
          console.log("FBO Blit Check - targetWidth: " + targetWidth + ", targetHeight: " + targetHeight + ", is FBO buffer blank?", allZero);
        }

        // Draw pixel data onto canvas for MediaPipe input
        // Using Uint32Array view of ImageData buffer for 4x faster block copies
        const pixels32 = cachedPixels32;
        const destPixels32 = new Uint32Array(cachedImageData.data.buffer);

        // Flip image vertically since WebGL framebuffer origin is bottom-left
        for (let y = 0; y < targetHeight; y++) {
          const srcRow = y * targetWidth;
          const destRow = (targetHeight - 1 - y) * targetWidth;
          destPixels32.set(pixels32.subarray(srcRow, srcRow + targetWidth), destRow);
        }

        offscreenCtx.putImageData(cachedImageData, 0, 0);
        return offscreenCanvas;
      } catch (err) {
        console.error("Error in extractWebXRFrame:", err);
        return null;
      }
    }

    // ------------------------------------------------------------------------
    