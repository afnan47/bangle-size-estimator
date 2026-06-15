// ONSCREEN DEBUG CONSOLE LOGGER (OVERRIDE CONSOLE)
    // ------------------------------------------------------------------------
    (function() {
      const debugConsole = document.getElementById('debug-console');
      const debugToggle = document.getElementById('btn-toggle-debug');
      const debugOutput = document.getElementById('debug-log-output');

      if (debugToggle && debugConsole) {
        debugToggle.addEventListener('click', () => {
          if (debugConsole.style.display === 'none' || debugConsole.style.display === '') {
            debugConsole.style.display = 'block';
            debugConsole.scrollTop = debugConsole.scrollHeight;
          } else {
            debugConsole.style.display = 'none';
          }
        });
      }

      function logToConsole(type, ...args) {
        const msg = args.map(arg => {
          if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
          if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch(e) { return String(arg); }
          }
          return String(arg);
        }).join(' ');

        const line = document.createElement('div');
        line.style.marginBottom = '6px';
        line.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        line.style.paddingBottom = '4px';

        let color = '#38bdf8'; // light blue
        if (type === 'error') color = '#ef4444'; // red
        if (type === 'warn') color = '#f59e0b'; // amber
        if (type === 'info') color = '#10b981'; // green

        line.style.color = color;
        const timestamp = new Date().toLocaleTimeString();
        line.textContent = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
        
        if (debugOutput) {
          debugOutput.appendChild(line);
          if (debugOutput.childNodes.length > 200) {
            debugOutput.removeChild(debugOutput.firstChild);
          }
          debugConsole.scrollTop = debugConsole.scrollHeight;
        }
      }

      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;

      console.log = (...args) => {
        originalLog.apply(console, args);
        logToConsole('log', ...args);
      };
      console.error = (...args) => {
        originalError.apply(console, args);
        logToConsole('error', ...args);
      };
      console.warn = (...args) => {
        originalWarn.apply(console, args);
        logToConsole('warn', ...args);
      };

      window.addEventListener('error', (e) => {
        logToConsole('error', `Uncaught Script Error: ${e.message} at ${e.filename}:${e.lineno}`);
      });
      window.addEventListener('unhandledrejection', (e) => {
        logToConsole('error', `Unhandled Promise Rejection: ${e.reason}`);
      });

      console.log("Device UserAgent:", navigator.userAgent);
      console.log("WebXR support available:", !!navigator.xr);
    })();

    // ------------------------------------------------------------------------
    