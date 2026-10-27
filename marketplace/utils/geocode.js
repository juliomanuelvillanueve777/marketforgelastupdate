'use strict';

const axios = require('axios');

const _cache = new Map();

async function geocodeLocation(locationStr) {
  if (!locationStr || !String(locationStr).trim()) return null;
  const key = String(locationStr).trim().toLowerCase();
  if (_cache.has(key)) return _cache.get(key);

  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: String(locationStr).trim(), format: 'json', limit: 1 },
      headers: { 'User-Agent': 'MarketForge/1.0 (local listing preview)' },
      timeout: 8000
    });

    if (!res.data || !Array.isArray(res.data) || !res.data[0]) {
      _cache.set(key, null);
      return null;
    }

    const lat = parseFloat(res.data[0].lat);
    const lon = parseFloat(res.data[0].lon);

    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      _cache.set(key, null);
      return null;
    }

    const result = { latitude: lat, longitude: lon };
    _cache.set(key, result);
    return result;
  } catch (e) {
    console.error('[geocode] error for "' + locationStr + '":', e.message);
    return null;
  }
}

module.exports = { geocodeLocation };
