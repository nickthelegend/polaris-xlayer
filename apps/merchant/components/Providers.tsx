'use client';

import { ReactNode } from 'react';

import { WalletProvider } from './WalletProvider';

/**
 * App-wide providers.
 *
 * This used to mount PrivyProvider, which needs a hosted app ID that this
 * project does not have -- so it was guarded behind an `isConfigured` check and
 * in practice never mounted, leaving every wallet-gated screen permanently
 * signed out. WalletProvider talks to the injected wallet directly, so there is
 * nothing to configure and nothing to degrade.
 */
export default function Providers({ children }: { children: ReactNode }) {
    return <WalletProvider>{children}</WalletProvider>;
}
