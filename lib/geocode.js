"use client";

// Free, keyless reverse geocoding via OpenStreetMap's Nominatim. Its usage
// policy caps public use at 1 req/sec and forbids bulk/systematic queries
// (https://operations.osmfoundation.org/policies/nominatim/) -- callers
// must only look up the one place currently shown, never a whole list.
// Caching by rounded coordinate keeps repeat views of the same spot free.
const CACHE_KEY = "lumela.geocodeCache";
const CACHE_LIMIT = 200;
const COORD_PRECISION = 4; // ~11m grid

function readCache() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeCache(cache) {
  if (typeof window === "undefined") {
    return;
  }

  const entries = Object.entries(cache);
  const trimmed = entries.length > CACHE_LIMIT ? entries.slice(-CACHE_LIMIT) : entries;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
}

function cacheKey(lat, lng) {
  return `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
}

function pickLabel(data) {
  const address = data?.address || {};
  const specific =
    data?.name || address.amenity || address.building || address.road || null;
  const area =
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.city ||
    address.town ||
    address.county ||
    null;

  if (area && specific && area !== specific) {
    return `${area}, ${specific}`;
  }

  return specific || area || null;
}

export async function reverseGeocode(lat, lng) {
  const key = cacheKey(lat, lng);
  const cache = readCache();

  if (key in cache) {
    return cache[key];
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const label = pickLabel(data);

    cache[key] = label;
    writeCache(cache);
    return label;
  } catch {
    return null;
  }
}
