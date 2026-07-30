"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, Clock, MapPin, Power, RadioTower, Share2, Zap } from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { getOrCreateDeviceId, normalizePhone, sha256 } from "@/lib/hash";
import {
  fetchReports,
  flushQueuedReports,
  submitReport
} from "@/lib/report-service";
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
    <div className="grid h-full min-h-[420px] place-items-center rounded-lg bg-[#e8eddf] text-sm font-black uppercase text-ink/60">
      Loading map
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
  const reports = useLumelaStore((state) => state.reports);
  const setReports = useLumelaStore((state) => state.setReports);
  const selectedCluster = useLumelaStore((state) => state.selectedCluster);
  const setSelectedCluster = useLumelaStore((state) => state.setSelectedCluster);
  const setUserLocation = useLumelaStore((state) => state.setUserLocation);

  const clusters = useMemo(() => clusterReports(reports), [reports]);
  const featuredCluster = selectedCluster || clusters[0];
  const verifiedCount = clusters.filter((cluster) => cluster.verified).length;

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const load = async () => {
      await flushQueuedReports();
      setReports(await fetchReports());
    };

    const handleOnline = async () => {
      setIsOnline(true);
      await flushQueuedReports();
      setReports(await fetchReports());
    };

    const handleOffline = () => setIsOnline(false);

    load();
    const interval = window.setInterval(load, 60000);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setReports]);

  async function refreshReports() {
    setReports(await fetchReports());
  }

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

    const message = `Lumela.ug: ${statusLabel(cluster.status)} near Kampala, updated ${formatAgo(cluster.latestAt)} by ${cluster.peopleCount} people.`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen">
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            borderRadius: "8px",
            border: "1px solid rgba(16,17,20,0.12)",
            color: "#101114",
            fontWeight: 700
          }
        }}
      />

      <section className="mx-auto grid min-h-screen w-full max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[380px_1fr] lg:px-6">
        <div className="flex flex-col gap-4">
          <header className="rounded-lg border border-ink/10 bg-white p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-ink/55">
                  Kampala
                </p>
                <h1 className="mt-1 text-4xl font-black leading-none text-ink">
                  Lumela.ug
                </h1>
              </div>
              <div className="grid h-14 w-14 place-items-center rounded-lg bg-ink text-sun">
                <Zap aria-hidden="true" size={31} strokeWidth={2.5} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-ink/10 bg-[#f8faf7] p-3">
                <p className="text-xs font-bold uppercase text-ink/55">Reports</p>
                <p className="mt-1 text-2xl font-black">{reports.length}</p>
              </div>
              <div className="rounded-lg border border-ink/10 bg-[#f8faf7] p-3">
                <p className="text-xs font-bold uppercase text-ink/55">Verified</p>
                <p className="mt-1 text-2xl font-black">{verifiedCount}</p>
              </div>
              <div className="rounded-lg border border-ink/10 bg-[#f8faf7] p-3">
                <p className="text-xs font-bold uppercase text-ink/55">Signal</p>
                <p className="mt-1 text-xl font-black">{isOnline ? "Live" : "Saved"}</p>
              </div>
            </div>
          </header>

          <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-panel">
            <label className="block text-sm font-bold text-ink/65" htmlFor="phone">
              Phone number
            </label>
            <input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+256..."
              className="mt-2 h-12 w-full rounded-lg border border-ink/15 bg-white px-4 text-lg font-bold outline-none ring-sun/40 transition focus:border-ink focus:ring-4"
            />

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleReport("on")}
                className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border-2 border-ink bg-powerOn px-4 text-center text-xl font-black text-white shadow-panel transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              >
                <Power aria-hidden="true" size={30} strokeWidth={3} />
                POWER ON
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleReport("off")}
                className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border-2 border-ink bg-powerOff px-4 text-center text-xl font-black text-white shadow-panel transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              >
                <Power aria-hidden="true" size={30} strokeWidth={3} />
                POWER OFF
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-panel">
            {featuredCluster ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold uppercase text-ink/55">
                      {featuredCluster.verified ? (
                        <CheckCircle2 aria-hidden="true" size={16} />
                      ) : (
                        <RadioTower aria-hidden="true" size={16} />
                      )}
                      {featuredCluster.verified ? "Verified" : "Unverified"}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">
                      {statusLabel(featuredCluster.status)}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={shareStatus}
                    className="grid h-12 w-12 place-items-center rounded-lg border border-ink/15 bg-ink text-white transition active:scale-95"
                    title="Share to WhatsApp"
                    aria-label="Share to WhatsApp"
                  >
                    <Share2 aria-hidden="true" size={21} />
                  </button>
                </div>

                <div className="mt-4 grid gap-2 text-sm font-bold text-ink/70">
                  <p className="flex items-center gap-2">
                    <Clock aria-hidden="true" size={17} />
                    Last updated: {formatAgo(featuredCluster.latestAt)} by{" "}
                    {featuredCluster.peopleCount} people
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin aria-hidden="true" size={17} />
                    {featuredCluster.lat.toFixed(4)}, {featuredCluster.lng.toFixed(4)}
                  </p>
                </div>
              </>
            ) : (
              <div className="py-5 text-center">
                <h2 className="text-2xl font-black">No reports yet</h2>
                <p className="mt-2 text-sm font-bold text-ink/60">
                  First report sets the map.
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="min-h-[520px] overflow-hidden rounded-lg border border-ink/10 bg-white p-2 shadow-panel lg:min-h-0">
          <PowerMap clusters={clusters} />
        </section>
      </section>
    </main>
  );
}
