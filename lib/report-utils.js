import { getDistance } from "geolib";
import {
  MIN_VERIFIED_WEIGHT,
  REPORT_TTL_MS,
  VERIFICATION_RADIUS_M,
  VERIFICATION_WINDOW_MS
} from "@/lib/constants";

export function isFreshReport(report, now = Date.now()) {
  return now - new Date(report.created_at).getTime() <= REPORT_TTL_MS;
}

export function formatAgo(dateLike) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(dateLike).getTime()) / 60000)
  );

  if (minutes < 1) {
    return "just now";
  }

  if (minutes === 1) {
    return "1 min ago";
  }

  return `${minutes} min ago`;
}

export function hasRecentLocalReport(reports, candidate) {
  const candidateTime = new Date(candidate.created_at).getTime();

  return reports.some((report) => {
    if (!report.phone_hash) {
      return false;
    }

    if (report.phone_hash !== candidate.phone_hash) {
      return false;
    }

    const reportTime = new Date(report.created_at).getTime();

    if (Math.abs(candidateTime - reportTime) > VERIFICATION_WINDOW_MS) {
      return false;
    }

    return getDistance(
      { latitude: candidate.lat, longitude: candidate.lng },
      { latitude: report.lat, longitude: report.lng }
    ) <= VERIFICATION_RADIUS_M;
  });
}

export function clusterReports(reports) {
  const freshReports = reports
    .filter((report) => !report.hidden && isFreshReport(report))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const clusters = [];

  freshReports.forEach((report) => {
    const reportPoint = { latitude: report.lat, longitude: report.lng };
    const match = clusters.find((cluster) => {
      const sameStatus = cluster.status === report.status;
      const recentEnough =
        Math.abs(new Date(cluster.latestAt) - new Date(report.created_at)) <=
        VERIFICATION_WINDOW_MS;
      const closeEnough =
        getDistance(reportPoint, {
          latitude: cluster.lat,
          longitude: cluster.lng
        }) <= VERIFICATION_RADIUS_M;

      return sameStatus && recentEnough && closeEnough;
    });

    if (!match) {
      clusters.push({
        id: report.id,
        status: report.status,
        lat: report.lat,
        lng: report.lng,
        latestAt: report.created_at,
        people: new Set([report.reporter_key || report.phone_hash || report.id]),
        weight: Number(report.weight || 1),
        reports: [report]
      });
      return;
    }

    match.reports.push(report);
    match.people.add(report.reporter_key || report.phone_hash || report.id);
    match.weight += Number(report.weight || 1);

    const count = match.reports.length;
    match.lat = (match.lat * (count - 1) + report.lat) / count;
    match.lng = (match.lng * (count - 1) + report.lng) / count;

    if (new Date(report.created_at) > new Date(match.latestAt)) {
      match.latestAt = report.created_at;
    }
  });

  return clusters.map((cluster) => ({
    ...cluster,
    peopleCount: cluster.people.size,
    verified: cluster.weight >= MIN_VERIFIED_WEIGHT
  }));
}

export function clustersToGeoJson(clusters) {
  return {
    type: "FeatureCollection",
    features: clusters.map((cluster) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [cluster.lng, cluster.lat]
      },
      properties: {
        id: cluster.id,
        status: cluster.status,
        verified: cluster.verified,
        peopleCount: cluster.peopleCount,
        weight: cluster.weight,
        latestAt: cluster.latestAt
      }
    }))
  };
}

export function statusLabel(status) {
  return status === "on" ? "POWER ON" : "POWER OFF";
}
