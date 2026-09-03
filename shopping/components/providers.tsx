"use client"

import type React from "react"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { WagmiProvider, createConfig, http } from "wagmi"
import { injected } from "wagmi/connectors"
import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"

import { ACTIVE_CHAIN } from "@/lib/chains"

/**
 * The storefront's wallet.
 *
 * This used to sign in through Privy and then hand checkout off to a separate
 * merchant service on localhost with a client id and secret — three moving
 * parts, none of which a visitor has. The shop pays the Polaris engine
 * directly now, with the shopper's own wallet, so the only thing it needs is a
 * connector.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [config] = useState(() =>
    createConfig({
      chains: [ACTIVE_CHAIN],
      connectors: [injected()],
      transports: { [ACTIVE_CHAIN.id]: http() },
      ssr: true,
    }),
  )

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ToastContainer position="bottom-right" theme="dark" />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
