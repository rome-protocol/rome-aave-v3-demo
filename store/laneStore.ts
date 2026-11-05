import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Lane } from "@/lib/lane/activeLane";

// The visitor's stated preference when BOTH wallets hold a session. Set by the
// connect click (the one place the visitor expresses intent), cleared when that
// lane disconnects. Never written from the observed active lane — see
// lib/lane/activeLane.ts for why.
interface LaneState {
  preferred: Lane | null;
  setPreferred: (lane: Lane | null) => void;
}

export const useLaneStore = create<LaneState>()(
  persist(
    (set) => ({
      preferred: null,
      setPreferred: (lane) => set({ preferred: lane }),
    }),
    { name: "aave-demo.preferred-lane", storage: createJSONStorage(() => localStorage) },
  ),
);
