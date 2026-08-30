'use client';

import { usePrivy } from '@privy-io/react-auth';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wallet, LogOut, LayoutDashboard, LayoutGrid, Zap } from 'lucide-react';

export default function Header() {
    const { login, logout, authenticated, user } = usePrivy();
    const pathname = usePathname();

    if (pathname === '/shop') return null;

    return (
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                <div className="flex items-center gap-10">
                    <Link href="/" className="flex items-center gap-3 group">
                        {/* One mark across the estate. Was /logo.png, a chrome-bevelled
                            italic "Polaris" wordmark belonging to the ATV company and
                            inherited with the template. This is the product's own star
                            -- the same file polarispay.app serves, byte for byte. */}
                        <Image
                            src="/star.png"
                            alt=""
                            width={22}
                            height={24}
                            className="h-6 w-auto"
                        />
                        <span className="text-[17px] font-medium tracking-[-0.03em] text-white">
                            Polaris Pay
                        </span>
                    </Link>

                    <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-white/50">
                        <Link href="/dashboard" className="hover:text-primary transition-colors flex items-center gap-2">
                            <LayoutDashboard className="w-4 h-4" />
                            Console
                        </Link>
                        <Link href="/shop" className="hover:text-primary transition-colors flex items-center gap-2">
                            <LayoutGrid className="w-4 h-4" />
                            Live Demo
                        </Link>
                    </nav>
                </div>

                <div className="flex items-center gap-4">
                    {authenticated ? (
                        <div className="flex items-center gap-4">
                            <div className="hidden lg:flex flex-col items-end">
                                <span className="text-[10px] text-white/30 font-mono uppercase tracking-widest">
                                    {user?.wallet?.address?.slice(0, 6)}...{user?.wallet?.address?.slice(-4)}
                                </span>
                            </div>
                            <button
                                onClick={() => logout()}
                                className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400 transition-all group"
                                title="Disconnect"
                            >
                                <LogOut className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => login()}
                            className="flex items-center gap-2 bg-primary text-black font-bold px-6 py-2.5 rounded-xl hover:scale-105 transition-all active:scale-95 shadow-[0_4px_20px_rgba(166,242,74,0.2)]"
                        >
                            <Wallet className="w-4 h-4" />
                            Connect Wallet
                        </button>
                    )
                    }
                </div>
            </div>
        </header>
    );
}
