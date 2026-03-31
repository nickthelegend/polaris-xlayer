"use client"

import { useCart } from "@/lib/cart-context";
import { Trash2, ArrowRight, Minus, Plus, Box } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CartPage() {
    const { items, removeFromCart, total } = useCart();
    const router = useRouter();

    return (
        <div className="max-w-4xl mx-auto px-6 py-12">
            <header className="mb-16">
                <h1 className="text-3xl font-black uppercase tracking-tighter mb-2">Your_Inventory</h1>
                <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold">Items ready for deployment.</p>
            </header>

            {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-6 border border-dashed border-white/10 rounded-lg">
                    <Box className="w-12 h-12 text-white/10" />
                    <p className="text-white/40 font-bold uppercase tracking-widest text-[10px]">Your inventory is empty</p>
                    <Link href="/" className="bg-white/5 border border-white/10 px-8 py-3 rounded text-[10px] uppercase font-bold tracking-widest hover:bg-white/10 transition-all">
                        Browse_Modules
                    </Link>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    <div className="divide-y divide-white/10 border-t border-b border-white/10">
                        {items.map(item => (
                            <div key={item.id} className="py-6 flex gap-6 items-center">
                                <div className="w-20 h-20 rounded bg-white/5 border border-white/10 overflow-hidden flex-shrink-0">
                                    <img src={item.image} className="w-full h-full object-cover" alt={item.name} />
                                </div>

                                <div className="flex-grow flex flex-col gap-1">
                                    <h3 className="font-bold text-sm uppercase">{item.name}</h3>
                                    <span className="text-[10px] text-white/40 uppercase font-black">${item.price} per unit</span>
                                </div>

                                <div className="flex items-center gap-4">
                                    <span className="text-xs font-bold text-white/60">Qty: {item.quantity}</span>
                                    <button onClick={() => removeFromCart(item.id)} className="p-2 text-white/20 hover:text-red-500 transition-all">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-col md:flex-row justify-between items-start gap-8 mt-4">
                        <div className="flex flex-col gap-2">
                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Total Valuation</span>
                            <span className="text-3xl font-black">${total.toFixed(2)}</span>
                        </div>

                        <button
                            onClick={() => router.push('/checkout')}
                            className="w-full md:w-auto bg-white text-black px-12 py-4 rounded font-black uppercase text-xs tracking-[0.2em] hover:bg-[#eaeaea] active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
                        >
                            Initialize_Checkout <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
