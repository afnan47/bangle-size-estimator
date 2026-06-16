// APPLICATION LIFECYCLE INITIALIZATION (CLEAN EDITED VERSION)
    // ------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", () => {
      // 1. Initialize onboarding mechanics & run layout check
      initCarousel();
      checkReturningUser();

      // 2. Clean, declarative binding map for simple click triggers
      const standardClickBindings = [
        { id: 'btn-direct-scan', action: startAR },
        { id: 'btn-exit-ar',     action: stopAR },
        { id: 'btn-recalibrate', action: recalibrate }
      ];

      standardClickBindings.forEach(({ id, action }) => {
        document.getElementById(id)?.addEventListener('click', action);
      });

      // 3. Handle complex view toggle navigations cleanly with optional chaining
      document.getElementById('btn-close-results')?.addEventListener('click', () => {
        document.getElementById('result-modal')?.classList.add('hidden');
        document.getElementById('screen-onboarding')?.classList.remove('hidden');
        checkReturningUser();
      });

      document.getElementById('btn-error-close')?.addEventListener('click', () => {
        document.getElementById('error-modal')?.classList.add('hidden');
        document.getElementById('screen-onboarding')?.classList.remove('hidden');
        checkReturningUser();
      });

      // 4. Interactive preview ruler ticks mapping
      BANGLE_SIZES.forEach(sz => {
        document.getElementById(`tick-${sz.size.replace('.', '-')}`)
          ?.addEventListener('click', () => selectBangleSize(sz.size));
      });

      // 5. Customer Feedback Panels UI loops
      document.getElementById('btn-feedback-yes')?.addEventListener('click', () => {
        localStorage.setItem('bangle_sizer_calibration_scale', calibrationScale.toString());
        console.log(`Feedback confirmed: Scale saved -> ${calibrationScale.toFixed(4)}`);

        document.querySelector('.feedback-buttons-row')?.classList.add('hidden');
        document.getElementById('feedback-sizes-container')?.classList.add('hidden');
        document.getElementById('feedback-success-msg')?.classList.remove('hidden');
        document.querySelector('.feedback-question')?.classList.add('hidden');
      });

      document.getElementById('btn-feedback-no')?.addEventListener('click', () => {
        document.getElementById('feedback-sizes-container')?.classList.remove('hidden');
      });

      document.querySelectorAll('.btn-feedback-circle').forEach(pill => {
        pill.addEventListener('click', (e) => {
          const correctSize = e.target.getAttribute('data-size');
          const recommendation = BANGLE_SIZES.find(sz => sz.size === correctSize);
          if (!recommendation) return;

          const targetWidth = recommendation.diameterMM + 2.0;
          if (lastUncalibratedSmoothedWidth > 10.0) {
            calibrationScale = targetWidth / lastUncalibratedSmoothedWidth;
            localStorage.setItem('bangle_sizer_calibration_scale', calibrationScale.toString());
          }

          document.querySelectorAll('.btn-feedback-circle').forEach(p => p.classList.remove('selected'));
          e.target.classList.add('selected');
          selectBangleSize(correctSize);

          document.querySelector('.feedback-buttons-row')?.classList.add('hidden');
          document.getElementById('feedback-sizes-container')?.classList.add('hidden');
          document.getElementById('feedback-success-msg')?.classList.remove('hidden');
          document.querySelector('.feedback-question')?.classList.add('hidden');
        });
      });
      
      // 6. Graphics & simulation setups
      overlayCanvas = document.getElementById('overlay-canvas');
      if (overlayCanvas) overlayCtx = overlayCanvas.getContext('2d');
      window.addEventListener('resize', resizeOverlayCanvas);

      document.getElementById('btn-simulate-scan')?.addEventListener('click', startSimulatedScan);

      if (isLocalTest()) {
        document.getElementById('btn-toggle-debug').style.display = 'block';
        document.getElementById('btn-toggle-testbed').style.display = 'block';
      } else {
        document.getElementById('btn-toggle-debug').style.display = 'none';
        document.getElementById('btn-toggle-testbed').style.display = 'none';
      }
    });

    function isLocalTest() {
      const hn = window.location.hostname;
      return hn === 'localhost' || 
             hn === '127.0.0.1' || 
             window.location.protocol === 'file:' || 
             hn.endsWith('.local') ||
             /^192\.168\./.test(hn) ||
             /^10\./.test(hn) ||
             /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hn) ||
             window.location.search.includes('test=true');
    }

    function resizeOverlayCanvas() {
      if (overlayCanvas) {
        overlayCanvas.width = window.innerWidth;
        overlayCanvas.height = window.innerHeight;
      }
    }

    function showUIError(title, desc) {
      document.getElementById('error-title').textContent = title;
      document.getElementById('error-desc').textContent = desc;
      errorModal.classList.remove('hidden');
      screenOnboarding.classList.add('hidden');
    }

    function updateHUD(status, liveWidthText, progressPct, instruction, isWarning = false) {
      const badge = document.getElementById('badge-status');
      badge.textContent = status;
      badge.className = "status-badge " + status.toLowerCase().replace("...", "");

      document.getElementById('live-width').textContent = liveWidthText;
      
      const pBar = document.getElementById('calibration-progress');
      pBar.style.width = `${progressPct}%`;
      if (progressPct >= 100) {
        pBar.style.background = "var(--state-success)";
      } else {
        pBar.style.background = "var(--accent-grad)";
      }

      const instEl = document.getElementById('hud-status-instruction');
      instEl.textContent = instruction;
      if (isWarning) {
        instEl.classList.add('warning-active');
      } else {
        instEl.classList.remove('warning-active');
      }
    }

    // ------------------------------------------------------------------------
    