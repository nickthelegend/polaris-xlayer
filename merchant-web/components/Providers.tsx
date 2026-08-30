'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { ReactNode } from 'react';
import { sepolia } from 'viem/chains';

// Use environment variable or fallback to a demo ID (which likely won't work for auth but allows render)
// Ideally, the user MUST provide this in .env.local
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export default function Providers({ children }: { children: ReactNode }) {
    if (!PRIVY_APP_ID) {
        console.warn('WARNING: NEXT_PUBLIC_PRIVY_APP_ID is missing in environment variables.');
    }

    return (
        <PrivyProvider
            appId={PRIVY_APP_ID}
            config={{
                loginMethods: ['email', 'wallet'],
                appearance: {
                    theme: 'dark',
                    accentColor: '#A6F24A', // neon-lime
                    showWalletLoginFirst: true,
                },
                defaultChain: sepolia,
                supportedChains: [sepolia],
                embeddedWallets: {
                    ethereum: {
                        createOnLogin: 'users-without-wallets',
                    },
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
