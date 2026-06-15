// CONSTANTS & CONFIGURATION
    // ------------------------------------------------------------------------
    const REQUIRED_STABLE_FRAMES = 45; // ~1.5s of steady tracking at 30fps
    
    // Standard bangle sizes mapping (Inner diameter in MM)
    const BANGLE_SIZES = [
      { size: "2.2", diameterMM: 54.0, positionPct: 10 },
      { size: "2.4", diameterMM: 57.2, positionPct: 30 },
      { size: "2.6", diameterMM: 60.3, positionPct: 50 },
      { size: "2.8", diameterMM: 63.5, positionPct: 70 },
      { size: "2.10", diameterMM: 66.7, positionPct: 90 }
    ];

    // ------------------------------------------------------------------------
    