"use client"

import { useEffect, useState } from "react"
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi"

import { ACTIVE_CHAIN, ADD_CHAIN_PARAMS } from "@/lib/chains"

/**
 * One place the storefront asks about the wallet.
 *
 * The pages used Privy's `authenticated` / `login` / `user.wallet.address`.
 * Replacing that inline in each page would scatter wagmi across the UI; this
 * keeps the same three ideas — are we connected, connect, who is it — so the
 * pages read the way they did.
 */
export function useWallet() {
  const { address, isConnected, chain } = useAccount()

  /*
   * Whether a wallet is connected is a client-only fact.
   *
   * wagmi reconnects from storage after hydration, so the server renders the
   * disconnected header and the client renders the connected one — which React
   * reports as "Hydration failed because the server rendered HTML didn't match
   * the client". Holding the wallet-dependent parts back until mount makes the
   * first client render match the server's by construction.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

  return {
    /** True only once the client has mounted and wagmi has settled. */
    mounted,
    address: mounted ? address : undefined,
    connected: mounted && isConnected,
    connecting: isPending,
    chain,
    login: () => {
      const injected = connectors[0]
      if (injected) connect({ connector: injected })
    },
    logout: () => disconnect(),
    short: mounted && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null,

    /**
     * Whether the wallet is pointed at the chain the contracts are on.
     *
     * A wallet connected to Ethereum will read every balance as zero and fail
     * every write, and nothing on screen would have said why — the shop would
     * simply look broken.
     */
    wrongNetwork: mounted && isConnected && chain?.id !== ACTIVE_CHAIN.id,
    switchToXLayer: () => {
      switchChain(
        { chainId: ACTIVE_CHAIN.id },
        {
          onError: () => {
            // 4902: the wallet has never heard of X Layer. Adding it is the fix.
            void (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum
              ?.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] })
              .catch(() => undefined)
          },
        },
      )
    },
  }
}
