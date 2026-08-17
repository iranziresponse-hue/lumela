"use client";

import { create } from "zustand";
import { DEFAULT_MAP_CENTER } from "@/lib/constants";

export const useLumelaStore = create((set) => ({
  reports: [],
  selectedCluster: null,
  userLocation: null,
  mapReady: false,
  center: DEFAULT_MAP_CENTER,
  setReports: (reports) => set({ reports }),
  setSelectedCluster: (selectedCluster) => set({ selectedCluster }),
  setUserLocation: (userLocation) => set({ userLocation }),
  setMapReady: (mapReady) => set({ mapReady }),
  setCenter: (center) => set({ center })
}));
