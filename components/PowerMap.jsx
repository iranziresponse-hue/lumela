"use client";

import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { KAMPALA_BOUNDS, KAMPALA_CENTER } from "@/lib/constants";
import { clustersToGeoJson } from "@/lib/report-utils";
import { useLumelaStore } from "@/lib/store";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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
    if (!containerRef.current || mapRef.current || !mapboxToken) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [KAMPALA_CENTER.lng, KAMPALA_CENTER.lat],
      zoom: 11.4,
      maxBounds: KAMPALA_BOUNDS,
      attributionControl: false
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

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
      userMarkerRef.current = new mapboxgl.Marker({ color: "#101114" })
        .setLngLat(lngLat)
        .addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLngLat(lngLat);
    }

    mapRef.current.easeTo({ center: lngLat, zoom: 13, duration: 800 });
  }, [userLocation]);

  if (!mapboxToken) {
    return (
      <div className="relative h-full min-h-[420px] overflow-hidden rounded-lg border border-ink/15 bg-[#e8eddf]">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,17,20,0.08)_1px,transparent_1px),linear-gradient(rgba(16,17,20,0.08)_1px,transparent_1px)] bg-[size:44px_44px]" />
        <div className="absolute left-[48%] top-[42%] h-5 w-5 rounded-full border-2 border-ink bg-powerOn shadow-panel" />
        <div className="absolute left-[56%] top-[51%] h-5 w-5 rounded-full border-2 border-ink bg-powerOff shadow-panel" />
        <div className="absolute left-[42%] top-[58%] h-3.5 w-3.5 rounded-full border border-ink bg-[#7c828d] shadow-panel" />
        <div className="absolute bottom-4 left-4 rounded bg-ink px-3 py-2 text-sm font-bold text-white">
          Add Mapbox token
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full min-h-[420px] rounded-lg" />;
}
