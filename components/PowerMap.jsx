"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Search } from "lucide-react";
import toast from "react-hot-toast";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/lib/constants";
import { searchPlace } from "@/lib/geocode";
import { clustersToGeoJson } from "@/lib/report-utils";
import { useLumelaStore } from "@/lib/store";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// Required under webpack (Next.js): maplibre-gl v6 split its tile-parsing
// worker into a module that imports a sibling file. Pointing setWorkerUrl
// at the package's dist file via `new URL(..., import.meta.url)` makes
// webpack copy only that one file, not the sibling it imports, so the
// worker 404s on load and vector tiles never render. `scripts/copy-
// maplibre-worker.mjs` (run on postinstall) copies both files as-is into
// public/maplibre/, which sidesteps webpack's asset pipeline entirely.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export default function PowerMap({ clusters }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const clustersRef = useRef(clusters);
  const userMarkerRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const setSelectedCluster = useLumelaStore((state) => state.setSelectedCluster);
  const setMapReady = useLumelaStore((state) => state.setMapReady);
  const userLocation = useLumelaStore((state) => state.userLocation);
  const geojson = useMemo(() => clustersToGeoJson(clusters), [clusters]);

  useEffect(() => {
    clustersRef.current = clusters;
  }, [clusters]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat],
      zoom: DEFAULT_MAP_ZOOM,
      attributionControl: false
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: false
    });
    map.addControl(geolocate, "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      // No fixed city to center on: try to recenter on wherever the user
      // actually is. Falls back to sitting at the neutral world view if
      // permission is denied or geolocation is unavailable -- the control
      // handles that itself, no error path needed here.
      geolocate.trigger();

      map.addSource("reports", {
        type: "geojson",
        data: clustersToGeoJson(clustersRef.current)
      });

      map.addLayer({
        id: "reports-halo",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": ["case", ["get", "verified"], 18, 11],
          "circle-color": [
            "case",
            ["get", "verified"],
            ["case", ["==", ["get", "status"], "on"], "#15a46f", "#d83838"],
            "#f8faf7"
          ],
          "circle-opacity": 0.35,
          "circle-blur": 0.25
        }
      });

      map.addLayer({
        id: "reports-circles",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": ["case", ["get", "verified"], 12, 7],
          "circle-color": [
            "case",
            ["get", "verified"],
            ["case", ["==", ["get", "status"], "on"], "#15a46f", "#d83838"],
            "#7c828d"
          ],
          "circle-stroke-color": "#101114",
          "circle-stroke-width": ["case", ["get", "verified"], 2, 1],
          "circle-opacity": 0.95
        }
      });

      map.on("mouseenter", "reports-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "reports-circles", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "reports-circles", (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        const cluster = clustersRef.current.find(
          (item) => item.id === feature.properties.id
        );

        if (cluster) {
          setSelectedCluster(cluster);
        }
      });

      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [setMapReady, setSelectedCluster]);

  useEffect(() => {
    const source = mapRef.current?.getSource("reports");

    if (source) {
      source.setData(geojson);
    }
  }, [geojson]);

  useEffect(() => {
    if (!mapRef.current || !userLocation) {
      return;
    }

    const lngLat = [userLocation.lng, userLocation.lat];

    if (!userMarkerRef.current) {
      userMarkerRef.current = new maplibregl.Marker({ color: "#101114" })
        .setLngLat(lngLat)
        .addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLngLat(lngLat);
    }

    mapRef.current.easeTo({ center: lngLat, zoom: 13, duration: 800 });
  }, [userLocation]);

  // Explicit-submit only -- Nominatim's usage policy strictly forbids
  // autocomplete/fire-on-keystroke search, so this must never run from an
  // onChange handler, only a form submit (button click or Enter).
  async function handleSearchSubmit(event) {
    event.preventDefault();

    if (isSearching || !searchQuery.trim() || !mapRef.current) {
      return;
    }

    setIsSearching(true);

    try {
      const result = await searchPlace(searchQuery);

      if (!result) {
        toast.error("Place not found");
        return;
      }

      mapRef.current.flyTo({ center: [result.lng, result.lat], zoom: 14 });
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="relative h-full min-h-[420px]">
      <div ref={containerRef} className="h-full min-h-[420px] rounded-xl" />
      <form
        onSubmit={handleSearchSubmit}
        className="absolute left-3 top-3 z-10 flex h-10 items-center gap-1 rounded-xl border border-ink/[0.06] bg-white pl-3 pr-1 shadow-panel"
      >
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search a place..."
          aria-label="Search a place"
          className="h-full w-32 min-w-0 bg-transparent text-sm font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink/35 sm:w-48"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink/40 transition hover:bg-ink/[0.06] hover:text-ink/70 disabled:cursor-wait"
          aria-label="Search"
        >
          <Search aria-hidden="true" size={15} strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
}
