"use client";

// Free, keyless geocoding (both directions) via OpenStreetMap's Nominatim.
// Its usage policy caps public use at 1 req/sec, forbids bulk/systematic
// queries, and strictly forbids autocomplete/fire-on-keystroke search
// (https://operations.osmfoundation.org/policies/nominatim/) -- reverse
// lookups must only ever cover the one place currently shown, and forward
// search must only ever run on an explicit submit, never as the user
// types. Caching keeps repeat lookups of the same spot/query free.
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

// Explicit-submit forward search only -- see the module-level note on
// Nominatim's autocomplete policy. Callers must gate this behind a form
// submit / button click / Enter key, never an onChange handler.
export async function searchPlace(query) {
  const trimmed = query.trim();

  if (!trimmed) {
    return null;
  }

  const key = `search:${trimmed.toLowerCase()}`;
  const cache = readCache();

  if (key in cache) {
    return cache[key];
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      return null;
    }

    const results = await response.json();
    const top = results?.[0];
    const result = top
      ? { lat: Number(top.lat), lng: Number(top.lon), label: top.display_name }
      : null;

    cache[key] = result;
    writeCache(cache);
    return result;
  } catch {
    return null;
  }
}
