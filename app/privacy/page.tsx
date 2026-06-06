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

export default function Privacy() {
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
                        <a href="/about" className="hover:text-primary transition-colors">About</a>
                        <a href="/docs" className="hover:text-primary transition-colors">Docs</a>
                    </nav>
                </div>
            </header>

            <main className="pt-32 pb-20 px-6 lg:px-40 max-w-4xl mx-auto">
                <motion.div {...fadeInUp}>
                    <h1 className="text-4xl lg:text-5xl font-black mb-12">Privacy Policy</h1>

                    <div className="space-y-12 text-slate-400 leading-relaxed">
                        <section>
                            <h3 className="text-xl font-bold text-white mb-4">1. Information We Collect</h3>
                            <p>
                                Polaris is a decentralized network. We do not collect private keys, seed phrases, or
                                personally identifiable matching (PII) beyond what is publicly available on the
                                blockchain. Our services are designed to be privacy-preserving.
                            </p>
                        </section>

                        <section>
                            <h3 className="text-xl font-bold text-white mb-4">2. Blockchain Data</h3>
                            <p>
                                Transactions made using Polaris protocols are recorded on the Monad blockchain.
                                This data is public by design and includes wallet addresses and transaction
                                amounts. We do not have control over this data.
                            </p>
                        </section>

                        <section>
                            <h3 className="text-xl font-bold text-white mb-4">3. Security</h3>
                            <p>
                                We prioritize user security through formal verification of our smart contracts.
                                However, users are responsible for the security of their own private keys.
                                Polaris will never ask for your seed phrase.
                            </p>
                        </section>

                        <section>
                            <h3 className="text-xl font-bold text-white mb-4">4. Cookies</h3>
                            <p>
                                Our landing page may use minimal cookies for analytics to improve user experience.
                                You can opt-out through your browser settings.
                            </p>
                        </section>

                        <section className="pt-10 border-t border-white/5 text-sm">
                            <p>Last Updated: June 2024</p>
                            <p>Contact: privacy@polaris.network</p>
                        </section>
                    </div>
                </motion.div>
            </main>

            <footer className="border-t border-white/5 px-6 lg:px-40 py-10 bg-card-dark">
                <div className="max-w-[1400px] mx-auto flex justify-between items-center text-[10px] text-slate-500 uppercase tracking-widest">
                    <p>© 2024 Polaris Finance</p>
                    <a href="/" className="hover:text-primary transition-colors">Back to Home</a>
                </div>
            </footer>
        </div>
    );
}
