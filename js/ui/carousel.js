// RETURNING USER NAVIGATION GATE & DYNAMIC ONBOARDING CAROUSEL
    // ------------------------------------------------------------------------
    function checkBrowserDeviceSupport() {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      
      const instructionsCard = document.getElementById('instructions-carousel-card');
      const handoffCard = document.getElementById('desktop-handoff-card');
      const returningUserCard = document.getElementById('returning-user-card');
      const qrImg = document.getElementById('handoff-qr-image');

      if (qrImg) {
        // Automatically inject current origin/path as target for mobile sizer
        const currentUrl = window.location.origin + window.location.pathname;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(currentUrl)}`;
      }

      const isReturning = localStorage.getItem('bangle_sizer_returning') === 'true';

      if (isAndroid || isIOS || (isMobile && window.location.search.includes('bypass=true')) || isLocalTest()) {
        if (handoffCard) {
          handoffCard.classList.add('hidden');
          handoffCard.style.display = 'none';
        }
        
        if (isReturning) {
          if (returningUserCard) {
            returningUserCard.classList.remove('hidden');
            returningUserCard.style.display = 'flex';
          }
          if (instructionsCard) {
            instructionsCard.classList.add('hidden');
            instructionsCard.style.display = 'none';
          }
        } else {
          if (returningUserCard) {
            returningUserCard.classList.add('hidden');
            returningUserCard.style.display = 'none';
          }
          if (instructionsCard) {
            instructionsCard.classList.remove('hidden');
            instructionsCard.style.display = 'flex';
          }
        }
      } else {
        if (handoffCard) {
          handoffCard.classList.remove('hidden');
          handoffCard.style.display = 'flex';
        }
        if (instructionsCard) {
          instructionsCard.classList.add('hidden');
          instructionsCard.style.display = 'none';
        }
        if (returningUserCard) {
          returningUserCard.classList.add('hidden');
          returningUserCard.style.display = 'none';
        }
      }
    }

    function checkReturningUser() {
      checkBrowserDeviceSupport();
    }

    let carouselIndex = 0;
    const totalCarouselSlides = 3;

    function initCarousel() {
      const track = document.getElementById('carousel-track');
      const dots = document.querySelectorAll('.carousel-dot');
      const btnPrev = document.getElementById('btn-carousel-prev');
      const btnNext = document.getElementById('btn-carousel-next');
      const btnScan = document.getElementById('btn-direct-scan');

      if (!track) return;

      function updateCarousel() {
        const slideWidthPct = 100 / totalCarouselSlides;
        track.style.transform = `translateX(-${carouselIndex * slideWidthPct}%)`;

        // Update dots active class
        dots.forEach((dot, idx) => {
          if (idx === carouselIndex) {
            dot.classList.add('active');
          } else {
            dot.classList.remove('active');
          }
        });

        // Hide/Show next/prev/scan controls dynamically
        if (carouselIndex === 0) {
          if (btnPrev) btnPrev.style.display = 'none';
          if (btnNext) {
            btnNext.style.display = 'block';
            btnNext.style.width = '100%';
            btnNext.textContent = 'Next';
          }
          if (btnScan) btnScan.style.display = 'none';
        } else if (carouselIndex === totalCarouselSlides - 1) {
          if (btnPrev) {
            btnPrev.style.display = 'block';
            btnPrev.style.width = 'calc(35% - 6px)';
          }
          if (btnNext) btnNext.style.display = 'none';
          if (btnScan) {
            btnScan.style.display = 'flex';
            btnScan.style.width = 'calc(65% - 6px)';
          }
        } else {
          if (btnPrev) {
            btnPrev.style.display = 'block';
            btnPrev.style.width = 'calc(35% - 6px)';
          }
          if (btnNext) {
            btnNext.style.display = 'block';
            btnNext.style.width = 'calc(65% - 6px)';
            btnNext.textContent = 'Next';
          }
          if (btnScan) btnScan.style.display = 'none';
        }
      }

      if (btnNext) {
        btnNext.onclick = (e) => {
          e.preventDefault();
          if (carouselIndex < totalCarouselSlides - 1) {
            carouselIndex++;
            updateCarousel();
          }
        };
      }

      if (btnPrev) {
        btnPrev.onclick = (e) => {
          e.preventDefault();
          if (carouselIndex > 0) {
            carouselIndex--;
            updateCarousel();
          }
        };
      }

      dots.forEach((dot) => {
        dot.onclick = (e) => {
          const targetIdx = parseInt(e.target.getAttribute('data-index') || '0');
          carouselIndex = targetIdx;
          updateCarousel();
        };
      });

      // Escape hatch click for simulator testing
      document.getElementById('btn-skip-to-simulator')?.addEventListener('click', (e) => {
        e.preventDefault();
        const instructionsCard = document.getElementById('instructions-carousel-card');
        const handoffCard = document.getElementById('desktop-handoff-card');
        if (handoffCard) {
          handoffCard.classList.add('hidden');
          handoffCard.style.display = 'none';
        }
        if (instructionsCard) {
          instructionsCard.classList.remove('hidden');
          instructionsCard.style.display = 'flex';
        }
      });

      // Show tutorial from returning user card
      document.getElementById('btn-show-tutorial')?.addEventListener('click', (e) => {
        e.preventDefault();
        const instructionsCard = document.getElementById('instructions-carousel-card');
        const returningUserCard = document.getElementById('returning-user-card');
        if (returningUserCard) {
          returningUserCard.classList.add('hidden');
          returningUserCard.style.display = 'none';
        }
        if (instructionsCard) {
          instructionsCard.classList.remove('hidden');
          instructionsCard.style.display = 'flex';
        }
      });

      // Skip instructions & scan directly
      document.getElementById('link-skip-instructions')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof startAR === 'function') {
          startAR();
        }
      });

      // Touch swipe gestures
      let touchStartX = 0;
      let touchEndX = 0;
      const trackContainer = document.querySelector('.carousel-track-container');
      if (trackContainer) {
        trackContainer.addEventListener('touchstart', (e) => {
          touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        trackContainer.addEventListener('touchend', (e) => {
          touchEndX = e.changedTouches[0].screenX;
          const threshold = 40;
          const diffX = touchStartX - touchEndX;
          if (Math.abs(diffX) > threshold) {
            if (diffX > 0) {
              if (carouselIndex < totalCarouselSlides - 1) {
                carouselIndex++;
                updateCarousel();
              }
            } else {
              if (carouselIndex > 0) {
                carouselIndex--;
                updateCarousel();
              }
            }
          }
        }, { passive: true });
      }

      carouselIndex = 0;
      updateCarousel();
    }

    // --- PASTE THIS NEW STANDALONE FUNCTION AT THE BOTTOM OF YOUR FILE ---

    function updateStoreFunnels(detectedSize) {
        const mapsBtn = document.getElementById('btn-maps-navigation');
        const shareBtn = document.getElementById('btn-share-bangle-size');
        const storeMapsUrl = "https://maps.app.goo.gl/o3iS41VXG6iFXY6s9"; 

        // 1. Synchronize the Left Segment (Maps Route)
        if (mapsBtn) {
            mapsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Find Size ${detectedSize}`;
            mapsBtn.href = storeMapsUrl;
        }

        // 2. Wire up the WhatsApp Share Option Modal for the Right Segment
        if (shareBtn) {
            shareBtn.onclick = (e) => {
                e.preventDefault();
                const shareModal = document.getElementById('share-option-modal');
                if (shareModal) {
                    shareModal.classList.remove('hidden');
                }
            };
        }

        // Wire up the inner buttons of the Share Modal
        const shareModal = document.getElementById('share-option-modal');
        const closeShareBtn = document.getElementById('btn-close-share-options');
        if (closeShareBtn && shareModal) {
            closeShareBtn.onclick = (e) => {
                e.preventDefault();
                shareModal.classList.add('hidden');
            };
        }

        const giftBtn = document.getElementById('btn-share-gift');
        const inviteBtn = document.getElementById('btn-share-invite');
        const appUrl = window.location.origin + window.location.pathname;

        if (giftBtn) {
            giftBtn.onclick = (e) => {
                e.preventDefault();
                const giftMessage = `Hint hint! 🎁 I just measured my hand using Saubhagya Bangles' AR sizer, and my perfect size is ${detectedSize}! 💍 In case you were looking for gift ideas! 😉 Try it yourself or visit their boutique here:\n📍 Physical Shop: ${storeMapsUrl}\n📱 Measure at home: ${appUrl}`;
                const whatsappDeepLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(giftMessage)}`;
                window.open(whatsappDeepLink, '_blank');
                if (shareModal) shareModal.classList.add('hidden');
            };
        }

        if (inviteBtn) {
            inviteBtn.onclick = (e) => {
                e.preventDefault();
                const inviteMessage = `Guess what? I'm a size ${detectedSize} in bangles! ✨ I measured it at home using Saubhagya Bangles' AR sizer. You should find your size too so we can go shopping together! 🛍️\n📍 Boutique Location: ${storeMapsUrl}\n📱 Try the AR Sizer: ${appUrl}`;
                const whatsappDeepLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(inviteMessage)}`;
                window.open(whatsappDeepLink, '_blank');
                if (shareModal) shareModal.classList.add('hidden');
            };
        }
    }

    function selectBangleSize(sizeStr) {
      const recommendation = BANGLE_SIZES.find(sz => sz.size === sizeStr) || BANGLE_SIZES[2];
      
      document.getElementById('result-size-label').textContent = recommendation.size;
      const estimatedWidth = recommendation.diameterMM + 2.0;
      document.getElementById('result-width-mm').textContent = `${(estimatedWidth / 10).toFixed(2)} cm`;
      document.getElementById('result-diameter-mm').textContent = `${(recommendation.diameterMM / 10).toFixed(2)} cm`;
      
      const scale = recommendation.diameterMM / 60.3;
      const svgGraphic = document.querySelector('.bangle-svg-graphic');
      if (svgGraphic) {
        svgGraphic.style.transform = `rotate(-90deg) scale(${scale})`;
      }
    }
    function drawHandStencil(ctx, w, h) {
      ctx.save();
      // On iOS/Webcam fallback, use lower opacity for positioning guide
      if (typeof isWebcamDemo !== 'undefined' && isWebcamDemo) {
        ctx.strokeStyle = "rgba(212, 175, 55, 0.18)";
        ctx.lineWidth = 2.0;
        ctx.setLineDash([6, 6]);
        ctx.shadowBlur = 4;
        ctx.shadowColor = "rgba(212, 175, 55, 0.08)";
      } else {
        ctx.strokeStyle = "rgba(212, 175, 55, 0.4)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.shadowBlur = 6;
        ctx.shadowColor = "rgba(212, 175, 55, 0.15)";
      }
      
      const centerX = w / 2;
      const centerY = h / 2 + h * 0.03;
      const scale = Math.min(w, h) * 0.36;
      
      ctx.beginPath();
      // Draw wrist left side
      ctx.moveTo(centerX - scale * 0.22, centerY + scale * 0.5);
      ctx.lineTo(centerX - scale * 0.22, centerY + scale * 0.3);
      
      // Thumb contour
      ctx.quadraticCurveTo(centerX - scale * 0.42, centerY + scale * 0.18, centerX - scale * 0.38, centerY - scale * 0.05);
      ctx.quadraticCurveTo(centerX - scale * 0.28, centerY - scale * 0.13, centerX - scale * 0.22, centerY + scale * 0.05);
      
      // Index finger
      ctx.lineTo(centerX - scale * 0.22, centerY - scale * 0.32);
      ctx.quadraticCurveTo(centerX - scale * 0.13, centerY - scale * 0.37, centerX - scale * 0.10, centerY - scale * 0.32);
      ctx.lineTo(centerX - scale * 0.10, centerY + scale * 0.05);
      
      // Middle finger
      ctx.lineTo(centerX - scale * 0.10, centerY - scale * 0.39);
      ctx.quadraticCurveTo(centerX, centerY - scale * 0.44, centerX + scale * 0.05, centerY - scale * 0.39);
      ctx.lineTo(centerX + scale * 0.05, centerY + scale * 0.05);
      
      // Ring finger
      ctx.lineTo(centerX + scale * 0.05, centerY - scale * 0.35);
      ctx.quadraticCurveTo(centerX + scale * 0.14, centerY - scale * 0.40, centerX + scale * 0.17, centerY - scale * 0.35);
      ctx.lineTo(centerX + scale * 0.17, centerY + scale * 0.08);
      
      // Pinky finger
      ctx.lineTo(centerX + scale * 0.17, centerY - scale * 0.23);
      ctx.quadraticCurveTo(centerX + scale * 0.25, centerY - scale * 0.28, centerX + scale * 0.27, centerY - scale * 0.23);
      ctx.quadraticCurveTo(centerX + scale * 0.30, centerY + scale * 0.15, centerX + scale * 0.22, centerY + scale * 0.3);
      
      // Wrist right side
      ctx.lineTo(centerX + scale * 0.22, centerY + scale * 0.5);
      ctx.stroke();
  
      // Knuckle line
      ctx.beginPath();
      if (typeof isWebcamDemo !== 'undefined' && isWebcamDemo) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = "rgba(212, 175, 55, 0.15)";
      } else {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(212, 175, 55, 0.25)";
      }
      ctx.moveTo(centerX - scale * 0.18, centerY);
      ctx.lineTo(centerX + scale * 0.18, centerY);
      ctx.stroke();
      
      if (typeof isWebcamDemo !== 'undefined' && isWebcamDemo) {
        ctx.fillStyle = "rgba(212, 175, 55, 0.3)";
      } else {
        ctx.fillStyle = "rgba(212, 175, 55, 0.55)";
      }
      ctx.beginPath();
      ctx.arc(centerX - scale * 0.18, centerY, 5, 0, 2 * Math.PI);
      ctx.arc(centerX + scale * 0.18, centerY, 5, 0, 2 * Math.PI);
      ctx.fill();
  
      ctx.fillStyle = (typeof isWebcamDemo !== 'undefined' && isWebcamDemo) ? "rgba(212, 175, 55, 0.45)" : "rgba(212, 175, 55, 0.65)";
      ctx.font = "700 11px 'Montserrat', sans-serif";
      ctx.textAlign = "center";
      ctx.setLineDash([]);
      
      const guideText = (typeof isWebcamDemo !== 'undefined' && isWebcamDemo) 
        ? "POSITIONING GUIDE (KEEP 12\" / 30CM DISTANCE)" 
        : "ALIGN KNUCKLES HERE";
      ctx.fillText(guideText, centerX, centerY + scale * 0.62);
      
      ctx.restore();
    }

    // ------------------------------------------------------------------------
    