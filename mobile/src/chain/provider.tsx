import React, { createContext, useContext, useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

import { initClient } from "./client";
import { loadOrCreateWallet } from "./wallet";
import { usePolarisState, type PolarisState } from "./usePolaris";

type Ctx = PolarisState & {
  refresh: () => Promise<void>;
  /** The device wallet's address, once it has loaded. */
  address: PublicKey | null;
};

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
  const [address, setAddress] = useState<PublicKey | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  /*
   * The signer is read from the device keystore before anything touches the
   * chain. It is generated there on first launch, so no key is carried in this
   * repository — see `wallet.ts`.
   */
  useEffect(() => {
    let cancelled = false;
    loadOrCreateWallet()
      .then((wallet) => {
        if (cancelled) return;
        initClient(wallet);
        setAddress(wallet.publicKey);
      })
      .catch((e: any) => {
        if (!cancelled) setWalletError(e?.message ?? "Could not open the device keystore.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const state = usePolarisState(address !== null);

  const value: Ctx = walletError
    ? { status: "error", data: null, error: walletError, refresh: state.refresh, address: null }
    : { ...state, address };

  return <PolarisContext.Provider value={value}>{children}</PolarisContext.Provider>;
}

export function usePolaris(): Ctx {
  const ctx = useContext(PolarisContext);
  if (!ctx) throw new Error("usePolaris must be used inside <PolarisProvider>");
  return ctx;
}
