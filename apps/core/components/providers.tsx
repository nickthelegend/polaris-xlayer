"use client";

import { PropsWithChildren } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

/**
 * App-wide providers.
 *
 * This used to mount RainbowKit with the literal string "YOUR_PROJECT_ID" as
 * its WalletConnect project ID, which made getDefaultConfig throw at module
 * scope and took down every route. Supplying an empty string instead only moved
 * the failure: the connect modal renders from RainbowKit's own wallet registry,
 * so it showed "Get a Wallet" to users who had MetaMask installed. Pulling in
 * that registry directly is not an option either -- the installed RainbowKit
 * imports a `porto` connector this version of wagmi does not export.
 *
 * So the connect path is plain wagmi against the injected provider. It covers
 * MetaMask, Rabby and Frame, needs no hosted account, and has no version
 * coupling to a wallet-list bundle. Nothing here can fail to mount.
 */

const queryClient = new QueryClient();

const wagmiConfig = createConfig({
  // Sepolia only: it is where the contracts are deployed, and offering other
  // networks on a demo just produces dead ends.
  chains: [sepolia],
  connectors: [injected()],
  ssr: true,
  transports: {
    [sepolia.id]: http(
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
    ),
  },
});

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
          <Toaster position="top-right" theme="dark" />
        </WagmiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
