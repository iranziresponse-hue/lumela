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
  writeJson(STORAGE_KEYS.queuedReports, [report, ...queued]);
}

export function getCachedReports() {
  return pruneReports(readJson(STORAGE_KEYS.cachedReports, []));
}

export function cacheReports(reports) {
  writeJson(STORAGE_KEYS.cachedReports, pruneReports(reports));
}

export async function fetchReports() {
  if (!hasSupabaseConfig) {
    return uniqueReports([...getLocalReports(), ...getCachedReports()]);
  }

  const cutoff = new Date(Date.now() - REPORT_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("reports")
    .select("id,status,lat,lng,phone_hash,photo_url,weight,flags,hidden,created_at")
    .eq("hidden", false)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) {
    return uniqueReports([...getLocalReports(), ...getCachedReports()]);
  }

  const reports = uniqueReports([...(data || []), ...getLocalReports()]);
  cacheReports(reports);
  return pruneReports(reports);
}

export async function submitReport(report) {
  saveLocalReport(report);

  if (!hasSupabaseConfig || !navigator.onLine) {
    queueReport(report);
    return { queued: true };
  }

  const { error } = await supabase.from("reports").insert({
    id: report.id,
    status: report.status,
    lat: report.lat,
    lng: report.lng,
    phone_hash: report.phone_hash,
    photo_url: report.photo_url,
    weight: report.weight || 1,
    created_at: report.created_at
  });

  if (error) {
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
    const { error } = await supabase.from("reports").insert({
      id: report.id,
      status: report.status,
      lat: report.lat,
      lng: report.lng,
      phone_hash: report.phone_hash,
      photo_url: report.photo_url,
      weight: report.weight || 1,
      created_at: report.created_at
    });

    if (error) {
      remaining.push(report);
    }
  }

  writeJson(STORAGE_KEYS.queuedReports, remaining);
}
