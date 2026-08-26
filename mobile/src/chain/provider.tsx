import React, { createContext, useContext } from "react";

import { usePolarisState, type PolarisState } from "./usePolaris";

type Ctx = PolarisState & { refresh: () => Promise<void> };

const PolarisContext = createContext<Ctx | null>(null);

/**
 * One fetch, shared by every tab.
 *
 * The four screens are four views of one borrower's position. Fetching per
 * screen means the credit line on one tab can disagree with the loans on the
 * next — and a money app that contradicts itself between two taps is worse
 * than one that is briefly stale.
 */
export function PolarisProvider({ children }: { children: React.ReactNode }) {
  const state = usePolarisState();
  return <PolarisContext.Provider value={state}>{children}</PolarisContext.Provider>;
}

export function usePolaris(): Ctx {
  const ctx = useContext(PolarisContext);
  if (!ctx) throw new Error("usePolaris must be used inside <PolarisProvider>");
  return ctx;
}
