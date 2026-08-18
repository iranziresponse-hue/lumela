"use client";

import { REPORT_TTL_MS, STORAGE_KEYS } from "@/lib/constants";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";

function readJson(key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

function pruneReports(reports) {
  const cutoff = Date.now() - REPORT_TTL_MS;
  return reports.filter((report) => new Date(report.created_at).getTime() >= cutoff);
}

function uniqueReports(reports) {
  const seen = new Set();

  return reports.filter((report) => {
    if (seen.has(report.id)) {
      return false;
    }

    seen.add(report.id);
    return true;
  });
}

function normalizeReport(report) {
  return {
    ...report,
    reporter_key: report.reporter_key || report.id
  };
}

async function fetchPublicReports(cutoff) {
  const { data, error } = await supabase
    .from("public_reports")
    .select("id,status,lat,lng,reporter_key,photo_url,weight,flags,hidden,created_at")
    .eq("hidden", false)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) {
    return { data: null, error };
  }

  return { data: data || [], error: null };
}

async function insertReport(report) {
  const { data: rpcData, error: rpcError } = await supabase.rpc("submit_power_report", {
    p_id: report.id,
    p_status: report.status,
    p_lat: report.lat,
    p_lng: report.lng,
    p_phone_hash: report.phone_hash,
    p_photo_url: report.photo_url,
    p_weight: report.weight || 1,
    p_created_at: report.created_at
  });

  if (rpcError) {
    return { duplicate: false, permanent: false, error: rpcError };
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;

  if (result?.accepted !== false) {
    return { duplicate: false, permanent: false, error: null };
  }

  if (result.reason === "duplicate") {
    return { duplicate: true, permanent: false, error: null };
  }

  // invalid_status / invalid_location / invalid_reporter: retrying won't
  // help, so this must not go back on the retry queue.
  return { duplicate: false, permanent: true, error: new Error(result.reason || "rejected") };
}

export async function attachReportPhoto(reportId, photoUrl, phoneHash) {
  const { data, error } = await supabase.rpc("attach_report_photo", {
    p_id: reportId,
    p_photo_url: photoUrl,
    p_phone_hash: phoneHash
  });

  if (error) {
    return { accepted: false, error };
  }

  const result = Array.isArray(data) ? data[0] : data;
  return { accepted: Boolean(result?.accepted), error: null };
}

export async function flagReport(reportId, reporterHash) {
  const { data, error } = await supabase.rpc("flag_report", {
    p_id: reportId,
    p_reporter_hash: reporterHash
  });

  if (error) {
    // report_flags has a foreign key back to reports -- flagging an id
    // that doesn't exist server-side anymore (stale local/cached data,
    // or the report was since removed) fails this way. That's an
    // expected, recoverable case, not a real error to alarm the user
    // over.
    if (error.code === "23503") {
      return { accepted: false, hidden: false, gone: true, error: null };
    }

    return { accepted: false, hidden: false, gone: false, error };
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    accepted: Boolean(result?.accepted),
    hidden: Boolean(result?.hidden),
    gone: false,
    error: null
  };
}

export function getLocalReports() {
  return pruneReports(readJson(STORAGE_KEYS.localReports, []));
}

export function saveLocalReport(report) {
  const reports = pruneReports([report, ...getLocalReports()]);
  writeJson(STORAGE_KEYS.localReports, reports);
  return reports;
}

export function getQueuedReports() {
  return readJson(STORAGE_KEYS.queuedReports, []);
}

export function queueReport(report) {
  const queued = getQueuedReports();
  writeJson(STORAGE_KEYS.queuedReports, uniqueReports([report, ...queued]));
}

export function getCachedReports() {
  return pruneReports(readJson(STORAGE_KEYS.cachedReports, []));
}

export function cacheReports(reports) {
  writeJson(STORAGE_KEYS.cachedReports, pruneReports(reports));
}

// A report can be cached/queued locally on a device and still be within
// its TTL window, yet no longer exist server-side (removed by
// moderation, or -- as surfaced by live testing -- test data cleanup).
// Nothing else prunes for that case, since it's driven by an explicit
// "this id is gone" signal from the server, not by time.
export function removeLocalReport(reportId) {
  writeJson(
    STORAGE_KEYS.localReports,
    getLocalReports().filter((report) => report.id !== reportId)
  );
  writeJson(
    STORAGE_KEYS.cachedReports,
    getCachedReports().filter((report) => report.id !== reportId)
  );
}

export function getFlaggedReportIds() {
  return readJson(STORAGE_KEYS.flaggedReports, []);
}

export function markReportFlagged(reportId) {
  const flagged = getFlaggedReportIds();

  if (!flagged.includes(reportId)) {
    writeJson(STORAGE_KEYS.flaggedReports, [reportId, ...flagged]);
  }
}

export async function fetchReports() {
  if (!hasSupabaseConfig) {
    return { reports: uniqueReports([...getLocalReports(), ...getCachedReports()]), synced: false };
  }

  const cutoff = new Date(Date.now() - REPORT_TTL_MS).toISOString();
  const { data, error } = await fetchPublicReports(cutoff);

  if (error) {
    // Falling back to local-only data is deliberate (lets the device's own
    // reports still show up offline) but it must never be silent -- a
    // misconfigured backend (e.g. the report_hash_pepper in schema.sql's
    // README section not set) would otherwise degrade every device to
    // "sees only its own reports" with no visible sign anything is wrong.
    console.error("Lumela: couldn't fetch the shared report feed", error);
    return { reports: uniqueReports([...getLocalReports(), ...getCachedReports()]), synced: false };
  }

  const reports = uniqueReports([...(data || []).map(normalizeReport), ...getLocalReports()]);
  cacheReports(reports);
  return { reports: pruneReports(reports), synced: true };
}

export async function submitReport(report) {
  saveLocalReport(report);

  if (!hasSupabaseConfig || !navigator.onLine) {
    queueReport(report);
    return { queued: true };
  }

  const result = await insertReport(report);

  if (result.duplicate) {
    return { queued: false, duplicate: true };
  }

  if (result.permanent) {
    return { queued: false, rejected: true, reason: result.error.message };
  }

  if (result.error) {
    queueReport(report);
    return { queued: true };
  }

  return { queued: false };
}

export async function flushQueuedReports() {
  if (!hasSupabaseConfig || !navigator.onLine) {
    return;
  }

  const queued = getQueuedReports();
  const remaining = [];

  for (const report of queued) {
    const result = await insertReport(report);

    if (result.error && !result.duplicate && !result.permanent) {
      remaining.push(report);
    }
  }

  writeJson(STORAGE_KEYS.queuedReports, remaining);
}
