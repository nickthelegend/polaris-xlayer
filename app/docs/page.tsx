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

export default function Docs() {
    const categories = [
        { title: "Introduction", items: ["What is Polaris?", "Architecture", "Monad Integration"] },
        { title: "Payments", items: ["Merchant SDK", "Stablecoin Support", "Settlement Logic"] },
        { title: "Credit", items: ["BNPL Protocol", "Risk Models", "Liquidity Pools"] },
        { title: "Smart Contracts", items: ["Solidity", "EVM Implementation", "Audits"] },
    ];

    return (
        <div className="min-h-screen bg-background-dark text-white font-display">
            <header className="fixed top-0 z-[60] w-full border-b border-solid border-slate-200/10 dark:border-border-dark/50 bg-background-dark/40 backdrop-blur-xl px-6 lg:px-40 py-4">
                <div className="flex items-center justify-between max-w-[1400px] mx-auto">
                    <a href="/" className="flex items-center gap-2">
                        <Logo />
                        <h2 className="text-lg font-bold tracking-tight">Polaris Docs</h2>
                    </a>
                    <nav className="hidden md:flex items-center gap-8 text-xs font-medium text-slate-400">
                        <a href="/" className="hover:text-primary transition-colors">Home</a>
                        <a href="/about" className="hover:text-primary transition-colors">About</a>
                        <a href="/privacy" className="hover:text-primary transition-colors">Privacy</a>
                    </nav>
                </div>
            </header>

            <div className="pt-24 flex min-h-screen">
                {/* Sidebar */}
                <aside className="hidden lg:block w-72 border-r border-white/5 p-10 fixed h-full overflow-y-auto">
                    <div className="space-y-10">
                        {categories.map((cat, i) => (
                            <div key={i}>
                                <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-4">{cat.title}</h4>
                                <ul className="space-y-3">
                                    {cat.items.map((item, j) => (
                                        <li key={j}>
                                            <a href="#" className="text-sm text-slate-400 hover:text-primary transition-colors">{item}</a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* Content */}
                <main className="flex-1 lg:ml-72 p-10 lg:p-20 overflow-y-auto">
                    <motion.div {...fadeInUp} className="max-w-3xl">
                        <h1 className="text-4xl lg:text-6xl font-black mb-6">Documentation</h1>
                        <p className="text-slate-400 text-lg leading-relaxed mb-12">
                            Welcome to the Polaris Network technical documentation. Here you'll find everything you
                            need to integrate decentralized payments and credit rails into your applications.
                        </p>

                        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
                            {[
                                { title: "Quickstart", desc: "Get up and running in minutes.", icon: "bolt" },
                                { title: "API Reference", desc: "Detailed endpoint documentation.", icon: "api" },
                                { title: "SDKs", desc: "Libraries for JavaScript, Rust, and Solidity.", icon: "terminal" },
                                { title: "Community", desc: "Join our developer discord.", icon: "forum" }
                            ].map((card, i) => (
                                <div key={i} className="p-8 rounded-2xl bg-card-dark border border-white/5 hover:border-primary/20 transition-all cursor-pointer group">
                                    <span className="material-symbols-outlined text-primary text-3xl mb-4 group-hover:scale-110 transition-transform">{card.icon}</span>
                                    <h3 className="text-xl font-bold mb-2">{card.title}</h3>
                                    <p className="text-xs text-slate-500">{card.desc}</p>
                                </div>
                            ))}
                        </section>

                        <article className="prose prose-invert max-w-none text-slate-400">
                            <h2 className="text-white text-3xl font-bold mb-6">High Performance Infrastructure</h2>
                            <p className="mb-6">
                                Polaris is built from the ground up to leverage Monad's parallel execution model.
                                Our infrastructure is designed for extreme throughput and predictable transaction costs.
                            </p>
                            <div className="bg-slate-900 rounded-xl p-6 font-mono text-sm border border-white/5 mb-8">
                                <span className="text-primary font-bold">// Initialize Polaris SDK</span><br />
                                const polaris = new PolarisNetwork(&#123;<br />
                                &nbsp;&nbsp;network: 'mainnet',<br />
                                &nbsp;&nbsp;apiKey: process.env.POLARIS_KEY<br />
                                &#125;);
                            </div>
                        </article>
                    </motion.div>
                </main>
            </div>
        </div>
    );
}
