"use client";

import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";

const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
};

const Logo = ({ className = "" }: { className?: string }) => (
    <div className={`relative w-8 h-8 ${className}`}>
        <Image
            src="/polaris.png"
            alt="Polaris Logo"
            fill
            className="object-contain"
            priority
        />
    </div>
);

export default function About() {
    return (
        <div className="min-h-screen bg-background-dark text-white font-display">
            <header className="fixed top-0 z-[60] w-full border-b border-solid border-slate-200/10 dark:border-border-dark/50 bg-background-dark/40 backdrop-blur-xl px-6 lg:px-40 py-4">
                <div className="flex items-center justify-between max-w-[1400px] mx-auto">
                    <a href="/" className="flex items-center gap-2">
                        <Logo />
                        <h2 className="text-lg font-bold tracking-tight">Polaris</h2>
                    </a>
                    <nav className="hidden md:flex items-center gap-8 text-xs font-medium text-slate-400">
                        <a href="/" className="hover:text-primary transition-colors">Home</a>
                        <a href="/docs" className="hover:text-primary transition-colors">Docs</a>
                        <a href="/privacy" className="hover:text-primary transition-colors">Privacy</a>
                    </nav>
                </div>
            </header>

            <main className="pt-32 pb-20 px-6 lg:px-40 max-w-[1400px] mx-auto">
                <motion.div {...fadeInUp} className="mb-20">
                    <h1 className="text-4xl lg:text-7xl font-black mb-8 leading-tight">
                        Building the <span className="text-primary">Future</span> of <br /> Decentralized Finance.
                    </h1>
                    <p className="text-slate-400 text-lg lg:text-xl leading-relaxed max-w-3xl">
                        Polaris is an institutional-grade fintech layer built on the Monad blockchain.
                        We are dedicated to creating secure, non-custodial payment and credit infrastructure
                        that bridges the gap between traditional commerce and the decentralized world.
                    </p>
                </motion.div>

                <section className="grid grid-cols-1 lg:grid-cols-2 gap-20 mb-32">
                    <motion.div {...fadeInUp} transition={{ delay: 0.1 }}>
                        <h2 className="text-2xl lg:text-4xl font-bold mb-6">Our Mission</h2>
                        <p className="text-slate-400 leading-relaxed mb-6">
                            Our mission is to empower global commerce by providing scalable, permissionless, and
                            formally verified financial rails. We believe in the power of decentralization to
                            bring financial services to the unbanked and to eliminate intermediaries in global trade.
                        </p>
                        <div className="p-8 rounded-2xl bg-card-dark border border-white/5">
                            <h4 className="font-bold text-primary mb-2">Institutional Grade</h4>
                            <p className="text-xs text-slate-500">
                                We use Solidity and optimized EVM byte-code to ensure our smart contracts meet the highest
                                security standards for institutional adoption on Monad.
                            </p>
                        </div>
                    </motion.div>

                    <motion.div {...fadeInUp} transition={{ delay: 0.2 }}>
                        <h2 className="text-2xl lg:text-4xl font-bold mb-6">The Team</h2>
                        <p className="text-slate-400 leading-relaxed">
                            We are a group of veteran software engineers, financial researchers, and
                            blockchain pioneers. With deep expertise in high-performance EVM development, we were
                            recognized as winners of the Cardano Emurgo Build 2023 for our technical
                            excellence in DeFi infrastructure.
                        </p>
                    </motion.div>
                </section>

                <section className="py-20 border-t border-white/5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-12 text-center">
                        {[
                            { label: "Founded", value: "2023" },
                            { label: "Community", value: "10k+" },
                            { label: "Transactions", value: "1M+" },
                            { label: "TVR", value: "$50M+" }
                        ].map((stat, i) => (
                            <motion.div key={i} {...fadeInUp} transition={{ delay: 0.1 * i }}>
                                <p className="text-primary text-3xl font-black mb-2">{stat.value}</p>
                                <p className="text-[10px] uppercase tracking-widest text-slate-500">{stat.label}</p>
                            </motion.div>
                        ))}
                    </div>
                </section>
            </main>

            <footer className="border-t border-white/5 px-6 lg:px-40 py-10 bg-card-dark">
                <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                        <Logo />
                        <span className="font-bold">Polaris</span>
                    </div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                        © 2024 Polaris Finance. Built on Monad.
                    </p>
                </div>
            </footer>
        </div>
    );
}
