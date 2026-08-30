import { usePrivy } from '@privy-io/react-auth';
import { useEffect } from 'react';

export function useUserSync() {
    const { user, authenticated } = usePrivy();

    useEffect(() => {
        async function syncUser() {
            if (authenticated && user?.wallet?.address) {
                try {
                    await fetch('/api/auth/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            wallet_address: user.wallet.address,
                            email: user.email?.address || null,
                        }),
                    });
                } catch (err) {
                    console.error('Failed to sync user', err);
                }
            }
        }

        syncUser();
    }, [authenticated, user]);
}
