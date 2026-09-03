'use client';

import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { xLayerTestnet } from 'viem/chains';

/**
 * The merchant dashboard's wallet.
 *
 * This mounted a PrivyProvider whose app id came from
 * NEXT_PUBLIC_PRIVY_APP_ID. There is no such id in this repository, and Privy
 * does not degrade — it throws "Cannot initialize the Privy provider with an
 * invalid Privy app ID" during render, so every route in the app answered
 * HTTP 500. The app typechecked and built perfectly and could not serve a
 * single page.
 *
 * The injected connector needs no third-party account, works with whatever
 * wallet the merchant already has, and is what the rest of this project uses.
 */
export default function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient());
    const [config] = useState(() =>
        createConfig({
            chains: [xLayerTestnet],
            connectors: [injected()],
            transports: { [xLayerTestnet.id]: http() },
        })
    );

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
    );
}
