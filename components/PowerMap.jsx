"use client";

import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { KAMPALA_BOUNDS, KAMPALA_CENTER } from "@/lib/constants";
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
      center: [KAMPALA_CENTER.lng, KAMPALA_CENTER.lat],
      zoom: 11.4,
      maxBounds: KAMPALA_BOUNDS,
      attributionControl: false
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: false
      }),
      "top-right"
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
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

  return <div ref={containerRef} className="h-full min-h-[420px] rounded-xl" />;
}
