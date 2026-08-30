'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Code2, ShieldCheck, Zap, ShoppingBag } from 'lucide-react';

export default function Home() {
    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 selection:text-white font-display overflow-x-hidden grid-bg">

            {/* Hero Section */}
            <section className="relative pt-32 pb-40 px-6 glow-bg">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <div className="max-w-4xl mx-auto text-center relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-[0.2em] mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <Zap className="w-3 h-3" />
                        Polaris Protocol v1.0
                    </div>

                    <div className="flex justify-center mb-10 animate-in fade-in slide-in-from-bottom-6 duration-1000">
                        {/* The hero lockup: the star set beside the name, rather than
                            the borrowed chrome wordmark this template shipped with. */}
                        <div className="flex items-center gap-5">
                            <Image
                                src="/star.png"
                                alt=""
                                width={66}
                                height={72}
                                className="h-14 w-auto sm:h-[72px]"
                                priority
                            />
                            <span className="text-5xl sm:text-6xl font-medium tracking-[-0.04em] text-white">
                                Polaris Pay
                            </span>
                        </div>
                    </div>

                    <p className="text-lg text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-100 font-medium">
                        The complete payment stack for web3 developers. Integrate decentralized payments,
                        generate bills, and settle on-chain instantly on Ethereum Sepolia.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-200">
                        <Link
                            href="/dashboard"
                            className="bg-primary text-black font-black px-10 py-5 rounded-xl hover:scale-105 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto justify-center uppercase tracking-tighter shadow-[0_8px_30px_rgba(166,242,74,0.3)]"
                        >
                            Developer Portal <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link
                            href="/shop"
                            className="bg-white/5 border border-white/10 text-white font-bold px-10 py-5 rounded-xl hover:bg-white/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto justify-center uppercase tracking-tighter"
                        >
                            <ShoppingBag className="w-4 h-4" /> Live Demo
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section className="border-t border-white/5 py-24 bg-black/20">
                <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8">
                    <FeatureCard
                        icon={<Code2 className="w-6 h-6 text-primary" />}
                        title="Dev-First SDK"
                        description="Drop-in React components. Type-safe APIs. Built for the modern stack."
                    />
                    <FeatureCard
                        icon={<ShieldCheck className="w-6 h-6 text-primary" />}
                        title="Non-Custodial"
                        description="Funds settle directly to your smart contract. You own the private keys."
                    />
                    <FeatureCard
                        icon={<Zap className="w-6 h-6 text-primary" />}
                        title="Instant Sync"
                        description="Powered by Ethereum Sepolia for secure and transparent settlements."
                    />
                </div>
            </section>

            {/* Code Snippet */}
            <section className="py-24 px-6 relative">
                <div className="absolute inset-0 bg-primary/2 h-full w-full pointer-events-none" />
                <div className="max-w-4xl mx-auto relative z-10">
                    <div className="text-center mb-12">
                        <h2 className="text-4xl font-black uppercase italic tracking-tighter mb-4">Integration is Simple</h2>
                        <p className="text-white/40 font-medium">Just import the component and pass your API credentials.</p>
                    </div>

                    <div className="bg-[#0d1117] border border-primary/20 rounded-2xl p-6 md:p-10 shadow-3xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 px-4 py-2 bg-primary/10 text-primary text-[10px] uppercase tracking-widest font-bold rounded-bl-xl border-b border-l border-primary/20">
                            React / Next.js
                        </div>
                        <pre className="font-mono text-sm md:text-base text-primary/80 overflow-x-auto">
                            <code>
                                {`import { PayWithPolaris } from '@polaris/sdk';

export function Checkout() {
  return (
    <PayWithPolaris
      apiKey="pk_live_..."
      amount={49.99}
      details="Subscription"
    />
  );
}`}
                            </code>
                        </pre>
                    </div>
                </div>
            </section>

            <footer className="border-t border-white/5 py-12 text-center text-white/20 text-[10px] uppercase tracking-[0.3em] font-bold">
                <p>&copy; 2026 Polaris Protocol // Built on Ethereum Sepolia</p>
            </footer>
        </div>
    );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
    return (
        <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-primary/30 transition-all group hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary/10 transition-all">
                {icon}
            </div>
            <h3 className="text-xl font-black uppercase italic mb-3 group-hover:text-primary transition-colors">{title}</h3>
            <p className="text-white/40 leading-relaxed text-sm font-medium">{description}</p>
        </div>
    );
}
