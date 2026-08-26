'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { BrowserProvider } from 'ethers';

/**
 * The app's wallet connection.
 *
 * This replaced a Privy integration that could never connect: Privy needs a
 * hosted app ID, and without one the provider throws at construction, so every
 * "Connect Wallet" button in the app was inert. A payments product whose connect
 * button does nothing is worse than one with no button at all.
 *
 * So this talks to EIP-1193 directly. No hosted dependency, no app ID, nothing
 * to sign up for -- it works against MetaMask, Rabby, Frame, or anything else
 * that injects a provider, and it is the same object the store and dashboard
 * use to send real transactions.
 */

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);
const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;

/** Shown to the wallet if the user does not have Sepolia configured yet. */
const CHAIN_PARAMS = {
    chainId: CHAIN_HEX,
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

type Eip1193 = {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on?: (event: string, handler: (...args: any[]) => void) => void;
    removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

type WalletState = {
    /** Checksummed address, or empty when disconnected. */
    address: string;
    chainId: number | null;
    connecting: boolean;
    /** False until the mount-time check for an existing session has finished. */
    ready: boolean;
    /** Whether any injected wallet exists in this browser at all. */
    installed: boolean;
    error: string;
    connect: () => Promise<void>;
    disconnect: () => void;
    /** Ethers provider over the injected wallet, or null when disconnected. */
    getProvider: () => BrowserProvider | null;
    /** Prompt the wallet to move to the configured chain. */
    switchChain: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

function injected(): Eip1193 | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function WalletProvider({ children }: { children: ReactNode }) {
    const [address, setAddress] = useState('');
    const [chainId, setChainId] = useState<number | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [ready, setReady] = useState(false);
    const [installed, setInstalled] = useState(false);
    const [error, setError] = useState('');

    // Restore a session the user already granted, and subscribe to the wallet.
    //
    // The subtlety is that the wallet may not exist yet when React mounts:
    // extensions inject on their own schedule, and an app that checks once and
    // gives up tells a user with MetaMask installed that they have no wallet.
    // So this waits for the provider to appear -- via the `ethereum#initialized`
    // event wallets fire, with a short poll as the backstop for those that
    // don't -- and only then reads state and attaches listeners.
    useEffect(() => {
        let live = true;
        let detach: (() => void) | undefined;

        const onAccounts = (accounts: string[]) => {
            setAddress(accounts?.[0] ?? '');
            // Losing the account is a disconnect, not an error state to clear later.
            if (!accounts?.[0]) setError('');
        };
        const onChain = (hex: string) => setChainId(Number.parseInt(hex, 16));

        const attach = async (eth: Eip1193) => {
            if (!live) return;
            setInstalled(true);
            try {
                const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
                const hex = (await eth.request({ method: 'eth_chainId' })) as string;
                if (!live) return;
                // eth_accounts never prompts -- it returns [] when the site is
                // not authorised -- so a returning visitor sees their wallet
                // without a popup and a first-time visitor sees nothing.
                if (accounts?.[0]) setAddress(accounts[0]);
                setChainId(Number.parseInt(hex, 16));
            } catch {
                // A wallet that refuses to answer is the same as no wallet here.
            } finally {
                if (live) setReady(true);
            }

            eth.on?.('accountsChanged', onAccounts);
            eth.on?.('chainChanged', onChain);
            detach = () => {
                eth.removeListener?.('accountsChanged', onAccounts);
                eth.removeListener?.('chainChanged', onChain);
            };
        };

        const now = injected();
        if (now) {
            void attach(now);
            return () => {
                live = false;
                detach?.();
            };
        }

        // No provider yet. Give a late-injecting extension a moment before
        // concluding the browser has no wallet.
        const settle = () => {
            const late = injected();
            if (late) void attach(late);
            else if (live) setReady(true);
        };

        const onInit = () => {
            clearInterval(poll);
            clearTimeout(giveUp);
            settle();
        };
        window.addEventListener('ethereum#initialized', onInit, { once: true });

        const poll = setInterval(() => {
            if (injected()) onInit();
        }, 100);
        const giveUp = setTimeout(onInit, 2_000);

        return () => {
            live = false;
            clearInterval(poll);
            clearTimeout(giveUp);
            window.removeEventListener('ethereum#initialized', onInit);
            detach?.();
        };
    }, []);

    const switchChain = useCallback(async () => {
        const eth = injected();
        if (!eth) return;
        try {
            await eth.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: CHAIN_HEX }],
            });
        } catch (err) {
            // 4902 means the wallet has never heard of this chain. Adding it is
            // the fix, and it is the common case for a first-time Sepolia user.
            if ((err as { code?: number }).code === 4902) {
                await eth.request({ method: 'wallet_addEthereumChain', params: [CHAIN_PARAMS] });
            } else {
                throw err;
            }
        }
        setChainId(CHAIN_ID);
    }, []);

    const connect = useCallback(async () => {
        const eth = injected();
        if (!eth) {
            setError('No wallet detected. Install MetaMask or another browser wallet.');
            return;
        }
        setConnecting(true);
        setError('');
        try {
            const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
            if (!accounts?.[0]) throw new Error('The wallet returned no accounts.');
            setAddress(accounts[0]);

            const hex = (await eth.request({ method: 'eth_chainId' })) as string;
            const current = Number.parseInt(hex, 16);
            setChainId(current);
            if (current !== CHAIN_ID) await switchChain();
        } catch (err) {
            const e = err as { code?: number; message?: string };
            // 4001 is the user closing the popup. That is a decision, not a fault,
            // and surfacing it as a red error reads as though something broke.
            setError(e.code === 4001 ? '' : e.message ?? 'Could not connect the wallet.');
        } finally {
            setConnecting(false);
        }
    }, [switchChain]);

    /**
     * EIP-1193 has no revoke, so this clears the app's own view. The wallet
     * still lists the site as connected until the user removes it there, which
     * is why the button says "Disconnect" and not "Revoke access".
     */
    const disconnect = useCallback(() => {
        setAddress('');
        setError('');
    }, []);

    const getProvider = useCallback(() => {
        const eth = injected();
        return eth ? new BrowserProvider(eth as never) : null;
    }, []);

    const value = useMemo<WalletState>(
        () => ({
            address,
            chainId,
            connecting,
            ready,
            installed,
            error,
            connect,
            disconnect,
            getProvider,
            switchChain,
        }),
        [address, chainId, connecting, ready, installed, error, connect, disconnect, getProvider, switchChain]
    );

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
    return ctx;
}

export const WALLET_CHAIN_ID = CHAIN_ID;

/** True when connected but pointed at the wrong network. */
export function useWrongChain(): boolean {
    const { address, chainId } = useWallet();
    return Boolean(address) && chainId !== null && chainId !== CHAIN_ID;
}
