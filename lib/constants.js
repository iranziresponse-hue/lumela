// No hardcoded city: the map starts on a neutral world view and recenters
// on the user's own location (via the map's geolocate control). Nothing
// about report validation or verification is tied to a place either --
// see submit_power_report's coordinate check and VERIFICATION_* below,
// which apply the same radius/time-window logic wherever a report comes
// from.
export const DEFAULT_MAP_CENTER = { lat: 20, lng: 0 };
export const DEFAULT_MAP_ZOOM = 1.5;

export const REPORT_TTL_MS = 2 * 60 * 60 * 1000;
export const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
export const VERIFICATION_RADIUS_M = 1000;
export const MIN_VERIFIED_WEIGHT = 3;

export const PHOTO_BUCKET = "report-photos";

export const STORAGE_KEYS = {
  deviceId: "lumela.deviceId",
  localReports: "lumela.localReports",
  queuedReports: "lumela.queuedReports",
  cachedReports: "lumela.cachedReports",
  flaggedReports: "lumela.flaggedReports"
};
