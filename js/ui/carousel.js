// RETURNING USER NAVIGATION GATE
    // ------------------------------------------------------------------------
    function checkReturningUser() {
      // The returning user card is removed. We always show the instructions card.
      const carouselCard = document.getElementById('instructions-carousel-card');
      if (carouselCard) {
        carouselCard.classList.remove('hidden');
        carouselCard.style.display = 'flex';
      }
    }

    function initCarousel() {
      // Carousel is disabled; all instructions are shown at once.
    }

    // --- PASTE THIS NEW STANDALONE FUNCTION AT THE BOTTOM OF YOUR FILE ---

    function updateStoreFunnels(detectedSize) {
        const mapsBtn = document.getElementById('btn-maps-navigation');
        const shareBtn = document.getElementById('btn-share-bangle-size');
        const storeMapsUrl = "https://maps.app.goo.gl/o3iS41VXG6iFXY6s9"; 

        // 1. Synchronize the Left Segment (Maps Route)
        if (mapsBtn) {
            mapsBtn.innerText = `📍 Find Size ${detectedSize}`;
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
                const giftMessage = `Hint hint! 🎁 I just measured my hand using Saubhagya Bangles' AR size estimator and my perfect size is ${detectedSize}! 💍 In case you were looking for gift ideas! 😉 Try it yourself or visit their boutique here:\n📍 Physical Shop: ${storeMapsUrl}\n📱 Measure at home: ${appUrl}`;
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
      
      const rulerMarker = document.getElementById('result-ruler-marker');
      if (rulerMarker) {
        rulerMarker.style.left = `${recommendation.positionPct}%`;
      }
      
      BANGLE_SIZES.forEach(sz => {
        const el = document.getElementById(`tick-${sz.size.replace('.', '-')}`);
        if (el) {
          if (sz.size === recommendation.size) {
            el.classList.add('highlighted');
          } else {
            el.classList.remove('highlighted');
          }
        }
      });

      const scale = recommendation.diameterMM / 60.3;
      const svgGraphic = document.querySelector('.bangle-svg-graphic');
      if (svgGraphic) {
        svgGraphic.style.transform = `rotate(-90deg) scale(${scale})`;
      }
    }
    function drawHandStencil(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = "rgba(212, 175, 55, 0.4)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(212, 175, 55, 0.15)";
      
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
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(212, 175, 55, 0.25)";
      ctx.moveTo(centerX - scale * 0.18, centerY);
      ctx.lineTo(centerX + scale * 0.18, centerY);
      ctx.stroke();
      
      ctx.fillStyle = "rgba(212, 175, 55, 0.55)";
      ctx.beginPath();
      ctx.arc(centerX - scale * 0.18, centerY, 5, 0, 2 * Math.PI);
      ctx.arc(centerX + scale * 0.18, centerY, 5, 0, 2 * Math.PI);
      ctx.fill();
 
      ctx.fillStyle = "rgba(212, 175, 55, 0.65)";
      ctx.font = "700 11px 'Montserrat', sans-serif";
      ctx.textAlign = "center";
      ctx.setLineDash([]);
      ctx.fillText("ALIGN KNUCKLES HERE", centerX, centerY + scale * 0.62);
      
      ctx.restore();
    }

    // ------------------------------------------------------------------------
    