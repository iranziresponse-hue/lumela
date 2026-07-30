export const KAMPALA_CENTER = {
  lat: 0.3476,
  lng: 32.5825
};

export const KAMPALA_BOUNDS = [
  [32.397, 0.142],
  [32.777, 0.535]
];

export const REPORT_TTL_MS = 2 * 60 * 60 * 1000;
export const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
export const VERIFICATION_RADIUS_M = 1000;
export const MIN_VERIFIED_WEIGHT = 3;

export const STORAGE_KEYS = {
  deviceId: "lumela.deviceId",
  localReports: "lumela.localReports",
  queuedReports: "lumela.queuedReports",
  cachedReports: "lumela.cachedReports"
};
