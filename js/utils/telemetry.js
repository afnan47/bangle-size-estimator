/**
 * Bangle Size Estimator Telemetry Module
 * Handles anonymous logging for sizer accuracy tracking and BI size distributions.
 */
(function() {
  const TELEMETRY_ENDPOINT = '/api/log-feedback';
  
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

  const DEBUG_LOGGING = isLocalTest();

  // 1. Generate or retrieve non-persistent Session ID (lasts for the tab session)
  let sessionId = sessionStorage.getItem('bangle_sizer_session_id');
  if (!sessionId) {
    sessionId = generateUUID();
    sessionStorage.setItem('bangle_sizer_session_id', sessionId);
  }

  // 1.5 Generate or retrieve persistent User ID (lasts across visits via localStorage)
  let userId = localStorage.getItem('bangle_sizer_user_id');
  if (!userId) {
    userId = generateUUID();
    localStorage.setItem('bangle_sizer_user_id', userId);
  }

  // Helper: UUID v4 fallback generator
  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback pseudo-random UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // 2. Anonymize and categorize platform instead of raw userAgent string
  function getSanitizedPlatform() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    
    // Check mobile platforms
    if (/android/i.test(userAgent)) {
      return 'Android';
    }
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      return 'iOS';
    }
    
    // Check desktop platforms
    if (/Macintosh|Mac OS X/i.test(userAgent)) {
      return 'macOS';
    }
    if (/Windows/i.test(userAgent)) {
      return 'Windows';
    }
    if (/Linux/i.test(userAgent)) {
      return 'Linux';
    }
    
    return 'Other';
  }

  // 3. Telemetry interface
  const Telemetry = {
    /**
     * Sends an anonymized event payload to the serverless function.
     * @param {string} eventType - 'measurement_locked' or 'feedback_submitted'
     * @param {Object} eventData - Custom payload fields
     */
    sendEvent(eventType, eventData) {
      const payload = {
        event_type: eventType,
        session_id: sessionId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        device_platform: getSanitizedPlatform(),
        ...eventData
      };

      if (DEBUG_LOGGING) {
        console.log(`[Telemetry] Dispatching "${eventType}" event:`, payload);
      }

      fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }
        if (DEBUG_LOGGING) {
          console.log(`[Telemetry] "${eventType}" successfully recorded.`);
        }
      })
      .catch(error => {
        // Fail silently in production, log for debug/development purposes
        console.warn(`[Telemetry] Failed to log event "${eventType}":`, error.message);
      });
    }
  };

  // Expose to window global scope
  window.BangleSizerTelemetry = Telemetry;
})();
