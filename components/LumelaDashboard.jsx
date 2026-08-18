"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Camera,
  CheckCircle2,
  Clock,
  CloudOff,
  Flag,
  ListChecks,
  MapPin,
  Phone,
  Power,
  RadioTower,
  Share2,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
  Zap
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { reverseGeocode } from "@/lib/geocode";
import { getOrCreateDeviceId, normalizePhone, sha256 } from "@/lib/hash";
import { uploadReportPhoto } from "@/lib/photo";
import {
  attachReportPhoto,
  fetchReports,
  flagReport,
  flushQueuedReports,
  getFlaggedReportIds,
  markReportFlagged,
  submitReport
} from "@/lib/report-service";
import { hasSupabaseConfig } from "@/lib/supabase";
import {
  clusterReports,
  formatAgo,
  hasRecentLocalReport,
  statusLabel
} from "@/lib/report-utils";
import { useLumelaStore } from "@/lib/store";

const PowerMap = dynamic(() => import("@/components/PowerMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full min-h-[420px] place-items-center gap-3 rounded-2xl bg-[#eef1e7] text-ink/50">
      <MapPin aria-hidden="true" size={22} className="animate-pulse" strokeWidth={2.25} />
      <p className="text-sm font-semibold">Loading map</p>
    </div>
  )
});

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location unavailable"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });
  });
}

export default function LumelaDashboard() {
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isSynced, setIsSynced] = useState(true);
  const [locationLabel, setLocationLabel] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [flaggedIds, setFlaggedIds] = useState([]);
  const [isFlagging, setIsFlagging] = useState(false);
  const hasWarnedSyncRef = useRef(false);
  const photoInputRef = useRef(null);
  const reports = useLumelaStore((state) => state.reports);
  const setReports = useLumelaStore((state) => state.setReports);
  const selectedCluster = useLumelaStore((state) => state.selectedCluster);
  const setSelectedCluster = useLumelaStore((state) => state.setSelectedCluster);
  const setUserLocation = useLumelaStore((state) => state.setUserLocation);

  const clusters = useMemo(() => clusterReports(reports), [reports]);
  const featuredCluster = selectedCluster || clusters[0];
  const verifiedCount = clusters.filter((cluster) => cluster.verified).length;
  // The newest report contributing to the cluster is what's actually being
  // displayed as "the current status" -- that's what a flag or photo
  // attaches to, since a cluster itself isn't a single row.
  const featuredReportId = featuredCluster?.reports?.[0]?.id;
  const featuredPhotoUrl = featuredCluster?.reports?.find((report) => report.photo_url)
    ?.photo_url;
  const isFeaturedFlagged = featuredReportId ? flaggedIds.includes(featuredReportId) : false;

  useEffect(() => {
    setFlaggedIds(getFlaggedReportIds());
  }, []);

  // Revokes the *previous* preview URL whenever it's replaced, and the
  // final one on unmount -- one place for the blob URL's lifecycle
  // instead of duplicating revocation in every handler that changes it.
  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  useEffect(() => {
    if (!featuredCluster) {
      setLocationLabel(null);
      return;
    }

    let cancelled = false;
    setLocationLabel(null);

    reverseGeocode(featuredCluster.lat, featuredCluster.lng).then((label) => {
      if (!cancelled) {
        setLocationLabel(label);
      }
    });

    return () => {
      cancelled = true;
    };
    // Depend on the coordinates, not the cluster object: clusterReports()
    // recomputes a new object every poll even when the place hasn't
    // moved, and re-running this on every poll would burn unnecessary
    // Nominatim lookups (cache-backed, but still pointless work).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredCluster?.lat, featuredCluster?.lng]);

  const refreshReports = useCallback(async () => {
    const { reports: fetched, synced } = await fetchReports();
    setReports(fetched);
    setIsSynced(synced);

    if (!synced && !hasWarnedSyncRef.current) {
      hasWarnedSyncRef.current = true;
      toast.error(
        hasSupabaseConfig
          ? "Can't reach shared reports — showing your own only"
          : "This deployment has no backend configured — reports aren't being shared"
      );
    } else if (synced) {
      hasWarnedSyncRef.current = false;
    }
  }, [setReports]);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const load = async () => {
      await flushQueuedReports();
      await refreshReports();
    };

    const handleOnline = async () => {
      setIsOnline(true);
      await flushQueuedReports();
      await refreshReports();
    };

    const handleOffline = () => setIsOnline(false);

    let interval = null;

    const startPolling = () => {
      if (interval) {
        return;
      }

      load();
      interval = window.setInterval(load, 60000);
    };

    const stopPolling = () => {
      if (interval) {
        window.clearInterval(interval);
        interval = null;
      }
    };

    // A backgrounded tab still burns Supabase read quota every 60s for
    // nothing the user can see -- pause polling while hidden.
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    if (!document.hidden) {
      startPolling();
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshReports]);

  async function handleReport(status) {
    setIsSubmitting(true);

    try {
      const position = await getPosition();
      const normalizedPhone = normalizePhone(phone);
      const identity = normalizedPhone || getOrCreateDeviceId();
      const phoneHash = await sha256(identity);
      const report = {
        id: crypto.randomUUID(),
        status,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        phone_hash: phoneHash,
        photo_url: null,
        weight: 1,
        created_at: new Date().toISOString()
      };

      if (hasRecentLocalReport(reports, report)) {
        toast.error("Already reported nearby");
        return;
      }

      setUserLocation({ lat: report.lat, lng: report.lng });
      const result = await submitReport(report);
      await refreshReports();

      if (result.duplicate) {
        toast.error("Already reported nearby");
        return;
      }

      if (result.rejected) {
        toast.error("Report couldn't be verified — try again");
        return;
      }

      // Photos require actually reaching the server at submit time -- a
      // queued/offline report has no accepted row yet to attach one to,
      // so skip silently rather than trying to also queue the upload.
      if (!result.queued && photoFile) {
        try {
          const photoUrl = await uploadReportPhoto(report.id, photoFile);
          await attachReportPhoto(report.id, photoUrl, report.phone_hash);
          await refreshReports();
        } catch {
          // The report itself already succeeded -- a photo is a bonus,
          // not something worth surfacing an error for.
        }
      }

      clearPhoto();
      toast.success(result.queued ? "Saved offline" : "Report submitted");
    } catch (error) {
      toast.error(error.message || "Report failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function shareStatus() {
    const cluster = featuredCluster;

    if (!cluster) {
      toast.error("No area selected");
      return;
    }

    const place = locationLabel || `${cluster.lat.toFixed(4)}, ${cluster.lng.toFixed(4)}`;
    const message = `Lumela: ${statusLabel(cluster.status)} near ${place}, updated ${formatAgo(cluster.latestAt)} by ${cluster.peopleCount} people.`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  }

  function handlePhotoSelect(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleFlag() {
    if (!featuredReportId || isFeaturedFlagged || isFlagging) {
      return;
    }

    setIsFlagging(true);

    try {
      const reporterHash = await sha256(getOrCreateDeviceId());
      const result = await flagReport(featuredReportId, reporterHash);

      if (result.error) {
        toast.error("Couldn't flag this report — try again");
        return;
      }

      markReportFlagged(featuredReportId);
      setFlaggedIds(getFlaggedReportIds());

      if (result.hidden) {
        toast.success("Report hidden after multiple flags");
        await refreshReports();
      } else {
        toast.success("Thanks — we'll review this");
      }
    } finally {
      setIsFlagging(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            borderRadius: "14px",
            border: "1px solid rgba(16,17,20,0.08)",
            boxShadow: "0 20px 40px -12px rgba(16,17,20,0.22)",
            color: "#101114",
            fontWeight: 600
          }
        }}
      />

      <section className="mx-auto grid min-h-screen w-full max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[380px_minmax(0,1fr)] lg:px-6 lg:py-6">
        <div className="flex min-w-0 flex-col gap-5">
          <header className="min-w-0 rounded-2xl border border-ink/[0.06] bg-white p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">
                  <span className="relative flex h-1.5 w-1.5">
                    {isOnline && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-powerOn/60" />
                    )}
                    <span
                      className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                        isOnline ? "bg-powerOn" : "bg-ink/30"
                      }`}
                    />
                  </span>
                  Live network
                </p>
                <h1 className="mt-1.5 text-3xl font-extrabold leading-none tracking-tight text-ink sm:text-4xl">
                  Lumela<span className="text-sun">.</span>
                </h1>
              </div>
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ink text-sun shadow-lift">
                <Zap aria-hidden="true" size={28} strokeWidth={2.5} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2.5">
              <div className="min-w-0 rounded-xl border border-ink/[0.06] bg-[#f8faf7] p-3">
                <ListChecks aria-hidden="true" size={15} className="text-ink/35" strokeWidth={2.25} />
                <p className="mt-1.5 text-xl font-extrabold tabular-nums">{reports.length}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Reports
                </p>
              </div>
              <div className="min-w-0 rounded-xl border border-ink/[0.06] bg-[#f8faf7] p-3">
                <ShieldCheck aria-hidden="true" size={15} className="text-ink/35" strokeWidth={2.25} />
                <p className="mt-1.5 text-xl font-extrabold tabular-nums">{verifiedCount}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Verified
                </p>
              </div>
              <div className="min-w-0 rounded-xl border border-ink/[0.06] bg-[#f8faf7] p-3">
                {isOnline && isSynced ? (
                  <Wifi aria-hidden="true" size={15} className="text-ink/35" strokeWidth={2.25} />
                ) : isOnline ? (
                  <CloudOff aria-hidden="true" size={15} className="text-powerOff/70" strokeWidth={2.25} />
                ) : (
                  <WifiOff aria-hidden="true" size={15} className="text-ink/35" strokeWidth={2.25} />
                )}
                <p
                  className={`mt-1.5 truncate text-xl font-extrabold ${
                    isOnline && !isSynced ? "text-powerOff" : ""
                  }`}
                  title={
                    isOnline && !isSynced
                      ? "Can't reach shared reports right now — showing your own only"
                      : undefined
                  }
                >
                  {isOnline && isSynced ? "Live" : isOnline ? "Local" : "Saved"}
                </p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Signal
                </p>
              </div>
            </div>
          </header>

          <section className="min-w-0 rounded-2xl border border-ink/[0.06] bg-white p-4 shadow-panel">
            <label className="block text-sm font-semibold text-ink/60" htmlFor="phone">
              Phone number <span className="font-normal text-ink/35">(optional)</span>
            </label>
            <div className="relative mt-2">
              <Phone
                aria-hidden="true"
                size={18}
                strokeWidth={2.25}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/30"
              />
              <input
                id="phone"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Optional +256..."
                className="h-12 w-full rounded-xl border border-ink/10 bg-[#f8faf7] pl-11 pr-4 text-base font-semibold text-ink outline-none ring-sun/40 transition placeholder:font-normal placeholder:text-ink/35 focus:border-ink/20 focus:bg-white focus:ring-4"
              />
            </div>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelect}
              className="hidden"
            />

            {photoPreview ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-ink/10 bg-[#f8faf7] p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Selected report photo"
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink/70">
                  Photo added
                </p>
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink/40 transition hover:bg-ink/[0.06] hover:text-ink/70"
                  aria-label="Remove photo"
                >
                  <X aria-hidden="true" size={18} strokeWidth={2.25} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-ink/15 bg-[#f8faf7] px-4 py-2.5 text-sm font-semibold text-ink/50 transition hover:border-ink/25 hover:text-ink/70"
              >
                <Camera aria-hidden="true" size={17} strokeWidth={2.25} />
                Add a photo <span className="font-normal text-ink/35">(optional)</span>
              </button>
            )}

            <div className="mt-4 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleReport("on")}
                className="group flex min-h-28 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl bg-powerOn px-2 text-center text-white shadow-panel transition hover:shadow-lift active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:px-4"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15 transition group-hover:bg-white/25">
                  <Power aria-hidden="true" size={22} strokeWidth={2.75} />
                </span>
                <span className="text-base font-bold leading-tight sm:text-lg">Power on</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleReport("off")}
                className="group flex min-h-28 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl bg-powerOff px-2 text-center text-white shadow-panel transition hover:shadow-lift active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:px-4"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15 transition group-hover:bg-white/25">
                  <Power aria-hidden="true" size={22} strokeWidth={2.75} />
                </span>
                <span className="text-base font-bold leading-tight sm:text-lg">Power off</span>
              </button>
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-ink/[0.06] bg-white p-4 shadow-panel">
            {featuredCluster ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        featuredCluster.verified
                          ? "bg-powerOn/10 text-powerOn"
                          : "bg-ink/[0.06] text-ink/55"
                      }`}
                    >
                      {featuredCluster.verified ? (
                        <CheckCircle2 aria-hidden="true" size={14} strokeWidth={2.5} />
                      ) : (
                        <RadioTower aria-hidden="true" size={14} strokeWidth={2.5} />
                      )}
                      {featuredCluster.verified ? "Verified" : "Unverified"}
                    </span>
                    <h2 className="mt-2.5 text-2xl font-extrabold tracking-tight">
                      {statusLabel(featuredCluster.status)}
                    </h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={handleFlag}
                      disabled={isFeaturedFlagged || isFlagging}
                      title={isFeaturedFlagged ? "Already flagged" : "Flag as inaccurate"}
                      aria-label={isFeaturedFlagged ? "Already flagged" : "Flag as inaccurate"}
                      className={`grid h-12 w-12 place-items-center rounded-xl border transition active:scale-95 disabled:cursor-not-allowed ${
                        isFeaturedFlagged
                          ? "border-ink/[0.06] bg-ink/[0.04] text-ink/25"
                          : "border-ink/10 text-ink/40 hover:border-ink/20 hover:text-ink/70"
                      }`}
                    >
                      <Flag aria-hidden="true" size={18} strokeWidth={2.25} />
                    </button>
                    <button
                      type="button"
                      onClick={shareStatus}
                      className="grid h-12 w-12 place-items-center rounded-xl bg-ink text-white transition hover:bg-ink/85 active:scale-95"
                      title="Share to WhatsApp"
                      aria-label="Share to WhatsApp"
                    >
                      <Share2 aria-hidden="true" size={20} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 text-sm font-medium text-ink/60">
                  <p className="flex items-center gap-2">
                    <Clock aria-hidden="true" size={16} className="shrink-0 text-ink/35" />
                    Last updated {formatAgo(featuredCluster.latestAt)} by{" "}
                    {featuredCluster.peopleCount} people
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin aria-hidden="true" size={16} className="shrink-0 text-ink/35" />
                    <span className="truncate">
                      {locationLabel ||
                        `${featuredCluster.lat.toFixed(4)}, ${featuredCluster.lng.toFixed(4)}`}
                    </span>
                  </p>
                </div>

                {featuredPhotoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={featuredPhotoUrl}
                    alt="Reported power status"
                    className="mt-4 h-40 w-full rounded-xl object-cover"
                  />
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-ink/[0.06] text-ink/35">
                  <RadioTower aria-hidden="true" size={20} strokeWidth={2.25} />
                </div>
                <h2 className="mt-3 text-lg font-bold">No reports yet</h2>
                <p className="mt-1 text-sm font-medium text-ink/50">
                  First report sets the map.
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="min-h-[520px] min-w-0 overflow-hidden rounded-2xl border border-ink/[0.06] bg-white p-2 shadow-panel lg:min-h-0">
          <PowerMap clusters={clusters} />
        </section>
      </section>
    </main>
  );
}
