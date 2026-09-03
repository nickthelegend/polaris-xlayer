'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

/**
 * One place this app asks about the wallet.
 *
 * Keeps the three ideas the pages already used — are we connected, connect,
 * who is it — so replacing Privy did not mean rewriting every screen.
 *
 * `mounted` matters: wagmi reconnects from storage after hydration, so a
 * server render of the disconnected header against a connected client render
 * is a hydration mismatch. Holding wallet-dependent UI back until mount makes
 * the first client render match the server's by construction.
 */
export function useWallet() {
    const { address, isConnected } = useAccount();
    const { connect, connectors, isPending } = useConnect();
    const { disconnect } = useDisconnect();

    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    return {
        ready: mounted,
        authenticated: mounted && isConnected,
        connecting: isPending,
        address: mounted ? address : undefined,
        login: () => {
            const injected = connectors[0];
            if (injected) connect({ connector: injected });
        },
        logout: () => disconnect(),
    };
}
