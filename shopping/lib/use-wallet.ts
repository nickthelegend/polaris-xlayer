"use client"

import { useAccount, useConnect, useDisconnect } from "wagmi"

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
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  return {
    address,
    connected: isConnected,
    connecting: isPending,
    chain,
    login: () => {
      const injected = connectors[0]
      if (injected) connect({ connector: injected })
    },
    logout: () => disconnect(),
    short: address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null,
  }
}
