'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Wallet, LogOut, LayoutDashboard, Store, AlertTriangle, Loader2 } from 'lucide-react';

import { useWallet, useWrongChain } from './WalletProvider';

export default function Header() {
    const { address, connect, disconnect, connecting, ready, installed, switchChain } = useWallet();
    const wrongChain = useWrongChain();

    return (
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                <div className="flex items-center gap-10">
                    <Link href="/" className="flex items-center gap-3 group">
                        <Image
                            src="/logo.png"
                            alt="Polaris Logo"
                            width={140}
                            height={40}
                            className="h-9 w-auto hover:brightness-110 transition-all"
                        />
                    </Link>

                    <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-white/55">
                        <Link href="/dashboard" className="hover:text-primary transition-colors flex items-center gap-2">
                            <LayoutDashboard className="w-4 h-4" />
                            Console
                        </Link>
                        <Link href="/store" className="hover:text-primary transition-colors flex items-center gap-2">
                            <Store className="w-4 h-4" />
                            Store
                        </Link>
                    </nav>
                </div>

                <div className="flex items-center gap-3">
                    {/* Connected to the wrong network is the one failure worth
                        interrupting for: every read returns zero and every write
                        reverts, which otherwise looks like the app is broken. */}
                    {wrongChain && (
                        <button
                            onClick={() => switchChain()}
                            className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm font-semibold hover:bg-amber-500/20 transition-all"
                        >
                            <AlertTriangle className="w-4 h-4" />
                            Switch to Sepolia
                        </button>
                    )}

                    {address ? (
                        <div className="flex items-center gap-3">
                            <span className="hidden lg:block text-[11px] text-white/60 font-mono uppercase tracking-widest">
                                {address.slice(0, 6)}…{address.slice(-4)}
                            </span>
                            <button
                                onClick={disconnect}
                                className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400 transition-all"
                                aria-label="Disconnect wallet"
                                title="Disconnect"
                            >
                                <LogOut className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={connect}
                            disabled={connecting || !ready}
                            className="flex items-center gap-2 bg-primary text-black font-bold px-6 py-2.5 rounded-xl hover:scale-105 transition-all active:scale-95 disabled:opacity-60 disabled:hover:scale-100 shadow-[0_4px_20px_rgba(166,242,74,0.2)]"
                            title={installed ? undefined : 'No browser wallet detected'}
                        >
                            {connecting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Wallet className="w-4 h-4" />
                            )}
                            {connecting ? 'Connecting…' : 'Connect Wallet'}
                        </button>
                    )}
                </div>
            </div>
        </header>
    );
}
