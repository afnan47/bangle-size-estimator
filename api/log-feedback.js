/**
 * Reference Serverless Function (Node.js API Route for Vercel/Netlify)
 * Path: /api/log-feedback
 * 
 * Receives anonymous sizer events, adds location meta from CDN headers,
 * strips identifying IP addresses, and writes to logs/databases.
 */

export default async function handler(req, res) {
  // CORS configuration if hosted on a separate domain
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const payload = req.body;

    // 1. Basic validation
    if (!payload || !payload.event_type || !payload.session_id || !payload.user_id) {
      return res.status(400).json({ error: 'Invalid payload: missing event_type, session_id, or user_id' });
    }

    // 2. Extract broad geographic origin using serverless platform headers
    // Vercel provides: 'x-vercel-ip-country'
    // Cloudflare provides: 'cf-ipcountry'
    // Netlify provides: 'x-country-code'
    const countryCode = 
      req.headers['x-vercel-ip-country'] || 
      req.headers['cf-ipcountry'] || 
      req.headers['x-country-code'] || 
      'Unknown';

    // 3. Assemble sanitized record strictly avoiding PII (no IP address is logged)
    const logRecord = {
      event_type: payload.event_type,
      session_id: payload.session_id,
      user_id: payload.user_id,
      created_at: payload.timestamp || new Date().toISOString(),
      device_platform: payload.device_platform || 'Unknown',
      raw_knuckle_width_mm: payload.raw_knuckle_width_mm ? parseFloat(payload.raw_knuckle_width_mm) : null,
      calibration_scale: payload.calibration_scale ? parseFloat(payload.calibration_scale) : null,
      recommended_size: payload.recommended_size || null,
      user_size: payload.user_size || null,
      is_correct: typeof payload.is_correct === 'boolean' ? payload.is_correct : null,
      approximate_location: countryCode.toUpperCase()
    };

    // 4. Output to console. This automatically routes to server log drains 
    // (e.g. Logflare, Datadog, Axiom) where it can be queried using SQL/BI.
    console.log('[TELEMETRY_LOG]', JSON.stringify(logRecord));

    // 5. Determine which table to write to (production vs development)
    const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
    const tableName = process.env.SUPABASE_TELEMETRY_TABLE || (isProduction ? 'bangle_sizer_telemetry' : 'bangle_sizer_telemetry_dev');

    // Direct write to Supabase database via standard REST API
    // To enable, configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) env vars.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        const dbResponse = await fetch(`${supabaseUrl}/rest/v1/${tableName}`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(logRecord)
        });

        if (!dbResponse.ok) {
          const errorText = await dbResponse.text();
          console.error('[Supabase DB Write Error]:', errorText);
        } else {
          console.log('[Supabase DB Write]: Event recorded successfully.');
        }
      } catch (dbErr) {
        console.error('[Supabase Network/Connection Error]:', dbErr.message);
      }
    } else {
      console.log('[Supabase DB Write]: Skipped. (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables not set)');
    }

    return res.status(200).json({ success: true, message: 'Event logged anonymously' });
  } catch (err) {
    console.error('[Telemetry Server Error]:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
