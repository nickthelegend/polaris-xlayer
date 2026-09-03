'use client';

import { PayWithPolaris } from '@/components/sdk/PayWithPolaris';
import { ShoppingBag, Star, Package } from 'lucide-react';
import Image from 'next/image';

export default function Shop() {
    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-primary/30 selection:text-white">
            <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ShoppingBag className="w-5 h-5 text-teal-600" />
                        <span className="font-bold tracking-tight text-lg">Acme Store</span>
                    </div>
                    <nav className="flex gap-6 text-sm font-medium text-gray-500">
                        <a href="#" className="hover:text-black transition-colors">Products</a>
                        <a href="#" className="hover:text-black transition-colors">About</a>
                        <a href="#" className="hover:text-black transition-colors">Contact</a>
                    </nav>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
                    {/* Product Image */}
                    <div className="bg-gray-100 rounded-2xl aspect-square relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-tr from-gray-200 to-transparent opacity-50" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Package className="w-32 h-32 text-gray-300 transform group-hover:scale-110 transition-transform duration-500" />
                        </div>
                        <div className="absolute bottom-6 left-6 bg-white/90 backdrop-blur px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest text-gray-500">
                            New Arrival
                        </div>
                    </div>

                    {/* Product Details */}
                    <div className="space-y-8 py-4">
                        <div>
                            <div className="flex items-center gap-1 text-yellow-400 mb-2">
                                <Star className="w-4 h-4 fill-current" />
                                <Star className="w-4 h-4 fill-current" />
                                <Star className="w-4 h-4 fill-current" />
                                <Star className="w-4 h-4 fill-current" />
                                <Star className="w-4 h-4 fill-current" />
                                <span className="text-gray-400 text-xs ml-2 font-medium">(24 Reviews)</span>
                            </div>
                            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 mb-2">Quantum Sneakers</h1>
                            <p className="text-lg text-gray-500">The most comfortable shoes in the multiverse.</p>
                        </div>

                        <div className="flex items-end gap-4">
                            <span className="text-3xl font-bold font-mono">$50.00</span>
                            <span className="text-sm text-gray-400 line-through mb-1.5">$75.00</span>
                            <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded mb-1.5">-33%</span>
                        </div>

                        <div className="prose prose-sm text-gray-500">
                            <p>
                                Experience zero-gravity technology with our latest Quantum series.
                                Designed for interstellar travel and everyday comfort.
                                Features include breathable mesh, memory foam insoles, and tachyon-resistant soles.
                            </p>
                        </div>

                        <div className="pt-8 border-t border-gray-100">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4">Secure Checkout</h3>

                            {/* Polaris Integration */}
                            <PayWithPolaris
                                apiKey="DEMO_KEY"
                                apiSecret="DEMO_SECRET"
                                amount={50}
                                details="Quantum Sneakers - Size 10"
                                onSuccess={(tx) => alert(`Payment Successful! TX: ${tx}`)}
                                onError={(msg) => alert(`Error: ${msg}`)}
                            />

                            <p className="text-xs text-center text-gray-400 mt-4">
                                Testing Mode: This will process on X Layer (USDC)
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
