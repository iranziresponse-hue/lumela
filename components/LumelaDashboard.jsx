"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  Clock,
  CloudOff,
  ListChecks,
  MapPin,
  Phone,
  Power,
  RadioTower,
  Share2,
  ShieldCheck,
  Wifi,
  WifiOff,
  Zap
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { getOrCreateDeviceId, normalizePhone, sha256 } from "@/lib/hash";
import {
  fetchReports,
  flushQueuedReports,
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
  const hasWarnedSyncRef = useRef(false);
  const reports = useLumelaStore((state) => state.reports);
  const setReports = useLumelaStore((state) => state.setReports);
  const selectedCluster = useLumelaStore((state) => state.selectedCluster);
  const setSelectedCluster = useLumelaStore((state) => state.setSelectedCluster);
  const setUserLocation = useLumelaStore((state) => state.setUserLocation);

  const clusters = useMemo(() => clusterReports(reports), [reports]);
  const featuredCluster = selectedCluster || clusters[0];
  const verifiedCount = clusters.filter((cluster) => cluster.verified).length;

  const refreshReports = useCallback(async () => {
    const { reports: fetched, synced } = await fetchReports();
    setReports(fetched);
    setIsSynced(synced);

    if (!synced && hasSupabaseConfig && !hasWarnedSyncRef.current) {
      hasWarnedSyncRef.current = true;
      toast.error("Can't reach shared reports — showing your own only");
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

    const message = `Lumela: ${statusLabel(cluster.status)} near ${cluster.lat.toFixed(4)}, ${cluster.lng.toFixed(4)}, updated ${formatAgo(cluster.latestAt)} by ${cluster.peopleCount} people.`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
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
                  <button
                    type="button"
                    onClick={shareStatus}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink text-white transition hover:bg-ink/85 active:scale-95"
                    title="Share to WhatsApp"
                    aria-label="Share to WhatsApp"
                  >
                    <Share2 aria-hidden="true" size={20} strokeWidth={2.25} />
                  </button>
                </div>

                <div className="mt-4 grid gap-2 text-sm font-medium text-ink/60">
                  <p className="flex items-center gap-2">
                    <Clock aria-hidden="true" size={16} className="shrink-0 text-ink/35" />
                    Last updated {formatAgo(featuredCluster.latestAt)} by{" "}
                    {featuredCluster.peopleCount} people
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin aria-hidden="true" size={16} className="shrink-0 text-ink/35" />
                    {featuredCluster.lat.toFixed(4)}, {featuredCluster.lng.toFixed(4)}
                  </p>
                </div>
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
