import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import type { PublicKey } from "@solana/web3.js";

import { clearClient, initClient } from "./client";
import { CLUSTER } from "./config";
import { createDeviceSigner } from "./signing/deviceSigner";
import { MWA_AVAILABLE, createMwaSigner } from "./signing/mwaSigner";
import { chainIdFor, whyNoMwa } from "./signing/pure.ts";
import type { ChainSigner, SignerKind } from "./signing/types.ts";
import { usePolarisState, type LiveChange, type PolarisState } from "./usePolaris";

type Ctx = PolarisState & {
  refresh: () => Promise<void>;
  /** The signing account's address, once one is available. */
  address: PublicKey | null;
  /** Which signer is active: the device key, or a wallet app. */
  signerKind: SignerKind | null;
  /** How to name the signer in the UI. */
  signerLabel: string | null;
  /** True while a wallet app is being connected or disconnected. */
  connecting: boolean;
  /** Why a wallet app is not on offer here, or null if it is. */
  walletUnavailable: string | null;
  /** What the chain just changed on its own, or null. */
  liveChange: LiveChange | null;
  /** Hand signing to a wallet app. Must be user-initiated. */
  connectWallet: () => Promise<void>;
  /** Give it back to the device key. */
  disconnectWallet: () => Promise<void>;
};

const PolarisContext = createContext<Ctx | null>(null);

const CHAIN_ID = chainIdFor(CLUSTER);

/**
 * One fetch, shared by every tab.
 *
 * The four screens are four views of one borrower's position. Fetching per
 * screen means the credit line on one tab can disagree with the loans on the
 * next — and a money app that contradicts itself between two taps is worse
 * than one that is briefly stale.
 */
export function PolarisProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<ChainSigner | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  /*
   * Boot with the device signer, always.
   *
   * Connecting a wallet app cannot happen here: Mobile Wallet Adapter needs a
   * foreground activity and brings another app to the front, so it has to be
   * something the user asks for rather than something that happens during
   * launch. The device key gets the app to a usable state; `connectWallet`
   * replaces it in place.
   */
  useEffect(() => {
    let cancelled = false;
    createDeviceSigner()
      .then((created) => {
        if (cancelled) return;
        initClient(created);
        setSigner(created);
      })
      .catch((e: any) => {
        if (!cancelled) setWalletError(e?.message ?? "Could not open the device keystore.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const swap = useCallback(async (next: ChainSigner) => {
    // The client caches a provider built around the old signer, so it has to
    // go before the new one is installed — otherwise Anchor keeps signing with
    // the account the user just replaced.
    clearClient();
    initClient(next);
    setSigner(next);
  }, []);

  const connectWallet = useCallback(async () => {
    if (connecting || !CHAIN_ID) return;
    setConnecting(true);
    setWalletError(null);
    try {
      await swap(await createMwaSigner(CHAIN_ID));
    } catch (e: any) {
      setWalletError(e?.message ?? "Could not reach a wallet app.");
    } finally {
      setConnecting(false);
    }
  }, [connecting, swap]);

  const disconnectWallet = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await signer?.disconnect().catch(() => {});
      await swap(await createDeviceSigner());
    } catch (e: any) {
      setWalletError(e?.message ?? "Could not disconnect.");
    } finally {
      setConnecting(false);
    }
  }, [connecting, signer, swap]);

  const state = usePolarisState(signer !== null);

  /*
   * A wallet-connection failure is surfaced without throwing away the position
   * already on screen. `PolarisState` is a discriminated union, so this picks
   * one arm of it rather than spreading an `error` onto the loading arm.
   */
  const base: PolarisState = walletError
    ? { status: "error", data: state.data, error: walletError }
    : state;

  const value: Ctx = {
    ...base,
    refresh: state.refresh,
    liveChange: state.liveChange,
    address: signer?.publicKey ?? null,
    signerKind: signer?.kind ?? null,
    signerLabel: signer?.label ?? null,
    connecting,
    walletUnavailable: whyNoMwa({
      os: Platform.OS,
      mwaAvailable: MWA_AVAILABLE,
      chainId: CHAIN_ID,
    }),
    connectWallet,
    disconnectWallet,
  };

  return <PolarisContext.Provider value={value}>{children}</PolarisContext.Provider>;
}

export function usePolaris(): Ctx {
  const ctx = useContext(PolarisContext);
  if (!ctx) throw new Error("usePolaris must be used inside <PolarisProvider>");
  return ctx;
}
