// APPLICATION LIFECYCLE INITIALIZATION (CLEAN EDITED VERSION)
    // ------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", () => {
      // 1. Initialize onboarding mechanics & run layout check
      initCarousel();
      checkReturningUser();

      // 2. Clean, declarative binding map for simple click triggers
      // 2. Clean, declarative binding map for simple click triggers
      const standardClickBindings = [
        { id: 'btn-direct-scan', action: startAR },
        { id: 'btn-returning-start', action: startAR },
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


      // 5. Customer Feedback Panels UI loops
      document.getElementById('btn-feedback-yes')?.addEventListener('click', () => {
        localStorage.setItem('bangle_sizer_calibration_scale', calibrationScale.toString());
        console.log(`Feedback confirmed: Scale saved -> ${calibrationScale.toFixed(4)}`);

        // Send telemetry feedback submitted (correct)
        if (typeof window.BangleSizerTelemetry !== 'undefined') {
          const recommendedSize = document.getElementById('result-size-label')?.textContent || '';
          window.BangleSizerTelemetry.sendEvent('feedback_submitted', {
            raw_knuckle_width_mm: lastUncalibratedSmoothedWidth,
            calibration_scale: calibrationScale,
            recommended_size: recommendedSize,
            user_size: recommendedSize,
            is_correct: true
          });
        }

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

          // Capture telemetry info before update
          const oldScale = calibrationScale;
          const recommendedSize = document.getElementById('result-size-label')?.textContent || '';

          const targetWidth = recommendation.diameterMM + 2.0;
          if (lastUncalibratedSmoothedWidth > 10.0) {
            calibrationScale = targetWidth / lastUncalibratedSmoothedWidth;
            localStorage.setItem('bangle_sizer_calibration_scale', calibrationScale.toString());
          }

          // Send telemetry feedback submitted (incorrect corrected)
          if (typeof window.BangleSizerTelemetry !== 'undefined') {
            window.BangleSizerTelemetry.sendEvent('feedback_submitted', {
              raw_knuckle_width_mm: lastUncalibratedSmoothedWidth,
              calibration_scale: oldScale,
              recommended_size: recommendedSize,
              user_size: correctSize,
              is_correct: false
            });
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
      // 5.5 Bangle Catalog style selector click listeners
      document.querySelectorAll('.catalog-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const clickedItem = e.currentTarget;
          document.querySelectorAll('.catalog-item').forEach(c => c.classList.remove('active'));
          clickedItem.classList.add('active');
          
          const style = clickedItem.getAttribute('data-style');
          selectedBangleStyle = style;
          
          // Re-draw static overlay immediately to reflect the design change on canvas
          if (typeof drawBangleStaticOverlay === 'function') {
            drawBangleStaticOverlay();
          }
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

      // 5.8. Boutique Card toggle listener
      const btnToggleBoutique = document.getElementById('btn-toggle-boutique');
      const boutiqueContent = document.getElementById('boutique-content');
      const boutiqueChevron = document.getElementById('boutique-chevron');
      if (btnToggleBoutique && boutiqueContent && boutiqueChevron) {
        btnToggleBoutique.addEventListener('click', (e) => {
          e.preventDefault();
          const isExpanded = boutiqueContent.classList.toggle('expanded');
          if (isExpanded) {
            boutiqueChevron.style.transform = 'rotate(180deg)';
          } else {
            boutiqueChevron.style.transform = 'rotate(0deg)';
          }
        });
      }

      // 5.9. Easter Egg: Triple-click the brand logo to reveal the GitHub link
      const brandLogo = document.querySelector('.brand-logo');
      const brandTagline = document.querySelector('.brand-tagline');
      let clickCount = 0;
      let clickTimer = null;
      let taglineResetTimer = null;
      const originalTagline = brandTagline ? brandTagline.textContent : 'Find the right bangle size for you';

      if (brandLogo && brandTagline) {
        brandLogo.addEventListener('click', () => {
          clickCount++;
          if (clickTimer) clearTimeout(clickTimer);
          if (taglineResetTimer) clearTimeout(taglineResetTimer);
          
          // Trigger light reflection shimmer animation
          brandLogo.classList.remove('easter-egg-spin');
          void brandLogo.offsetWidth; // Trigger reflow to restart animation
          brandLogo.classList.add('easter-egg-spin');
          setTimeout(() => {
            brandLogo.classList.remove('easter-egg-spin');
          }, 1100);

          
          // Trigger haptic feedback on supported mobile browsers
          if (navigator.vibrate) {
            if (clickCount === 1) {
              navigator.vibrate(15);
            } else if (clickCount === 2) {
              navigator.vibrate(25);
            } else if (clickCount === 3) {
              navigator.vibrate([40, 60, 40]);
            }
          }
          
          if (clickCount === 1) {
            brandTagline.innerHTML = '<span style="color: var(--accent-gold); text-shadow: 0 0 8px rgba(212, 175, 55, 0.4);">✦ Tap twice more to inspect ✦</span>';
          } else if (clickCount === 2) {
            brandTagline.innerHTML = '<span style="color: var(--accent-gold); text-shadow: 0 0 12px rgba(212, 175, 55, 0.6);">✦ Tap once more... ✦</span>';
          }
          
          if (clickCount === 3) {
            clickCount = 0;
            brandTagline.textContent = originalTagline;
            
            // Show link
            const ghLink = document.getElementById('github-easter-egg');
            if (ghLink) {
              ghLink.classList.remove('hidden');
              ghLink.style.display = 'flex';
              ghLink.classList.add('fade-in-egg');
            }
          } else {
            // Reset state if they stop tapping
            clickTimer = setTimeout(() => {
              clickCount = 0;
              brandTagline.style.opacity = '0';
              taglineResetTimer = setTimeout(() => {
                brandTagline.textContent = originalTagline;
                brandTagline.style.opacity = '1';
              }, 250);
            }, 2000); // 2 seconds window to complete the taps
          }
        });
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
      setScanButtonsLoading(false);
    }

    function updateHUD(status, liveWidthText, progressPct, instruction, isWarning = false, pitchVal = null, depthVal = null) {
      const badge = document.getElementById('badge-status');
      if (badge) {
        badge.textContent = status;
        badge.className = "status-badge " + status.toLowerCase().replace("...", "").trim();
      }

      const lw = document.getElementById('live-width');
      if (lw) lw.textContent = liveWidthText;
      
      const pBar = document.getElementById('calibration-progress');
      if (pBar) {
        pBar.style.width = `${progressPct}%`;
        if (progressPct >= 100) {
          pBar.style.background = "var(--state-success)";
        } else {
          pBar.style.background = "var(--accent-grad)";
        }
      }

      const instEl = document.getElementById('hud-status-instruction');
      if (instEl) {
        instEl.textContent = instruction;
        if (isWarning) {
          instEl.classList.add('warning-active');
        } else {
          instEl.classList.remove('warning-active');
        }
      }

      // 1. Dynamic glowing card classes based on status
      const hudCard = document.querySelector('.hud-card');
      if (hudCard) {
        hudCard.classList.remove('searching-active', 'calibrating-active', 'unstable-active', 'success-active');
        const statusClean = status.toLowerCase().replace("...", "").trim();
        if (statusClean === 'searching') {
          hudCard.classList.add('searching-active');
        } else if (statusClean === 'calibrating') {
          hudCard.classList.add('calibrating-active');
        } else if (statusClean === 'unstable') {
          hudCard.classList.add('unstable-active');
        } else if (statusClean === 'success') {
          hudCard.classList.add('success-active');
        }
      }

      // 2. Update tilt & distance gauges
      const tiltEl = document.getElementById('hud-tilt-gauge');
      if (tiltEl) {
        if (pitchVal !== null && pitchVal !== undefined) {
          tiltEl.textContent = `Tilt: ${Math.round(pitchVal)}° / 25° Max`;
          if (pitchVal > 25) {
            tiltEl.style.color = 'var(--state-warning)';
          } else {
            tiltEl.style.color = 'var(--accent-gold)';
          }
        } else {
          tiltEl.textContent = 'Tilt: --°';
          tiltEl.style.color = 'var(--text-secondary)';
        }
      }

      const distEl = document.getElementById('hud-distance-gauge');
      if (distEl) {
        if (depthVal !== null && depthVal !== undefined) {
          const depthCm = Math.round(depthVal * 100);
          distEl.textContent = `Distance: ${depthCm} cm`;
          if (depthVal < 0.15 || depthVal > 1.0) {
            distEl.style.color = 'var(--state-warning)';
          } else {
            distEl.style.color = 'var(--text-secondary)';
          }
        } else {
          distEl.textContent = 'Distance: -- cm';
          distEl.style.color = 'var(--text-secondary)';
        }
      }
    }

    function setScanButtonsLoading(isLoading) {
      const btns = [
        document.getElementById('btn-direct-scan'),
        document.getElementById('btn-returning-start'),
        document.getElementById('link-skip-instructions')
      ];
      btns.forEach(btn => {
        if (!btn) return;
        if (isLoading) {
          btn.classList.add('loading');
          btn.style.pointerEvents = 'none';
          if (btn.tagName === 'BUTTON') btn.disabled = true;
        } else {
          btn.classList.remove('loading');
          btn.style.pointerEvents = '';
          if (btn.tagName === 'BUTTON') btn.disabled = false;
        }
      });
    }

    // ------------------------------------------------------------------------
    