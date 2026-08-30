"use client"

import { useParams, useRouter } from "next/navigation";
import { PRODUCTS } from "@/lib/products";
import { useCart } from "@/lib/cart-context";
import { ArrowLeft, Zap, Shield, Cpu } from "lucide-react";
import Link from "next/link";

export default function ProductDetail() {
    const { id } = useParams();
    const router = useRouter();
    const { addToCart } = useCart();

    const product = PRODUCTS.find(p => p.id === id);

    if (!product) return <div>Product not found</div>;

    return (
        <div className="max-w-6xl mx-auto px-6 py-12">
            <button onClick={() => router.back()} className="flex items-center gap-2 text-white/40 hover:text-white mb-12 transition-all uppercase text-[10px] font-bold tracking-widest group">
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" /> Back_To_Catalog
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                <div className="aspect-square relative rounded-lg overflow-hidden border border-white/10">
                    <img
                        src={product.image}
                        className="object-cover w-full h-full"
                        alt={product.name}
                    />
                </div>

                <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-2">
                        <span className="text-white/40 text-[10px] font-bold uppercase tracking-[0.3em]">{product.category}</span>
                        <h1 className="text-4xl font-black uppercase tracking-tighter">{product.name}</h1>
                    </div>

                    <div className="text-2xl font-black">${product.price}</div>

                    <p className="text-white/60 leading-relaxed text-sm">
                        {product.description}
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/5 border border-white/10 p-4 rounded flex flex-col gap-2">
                            <Cpu className="w-4 h-4 text-white/40" />
                            <span className="text-[10px] font-bold uppercase">Native Sync</span>
                        </div>
                        <div className="bg-white/5 border border-white/10 p-4 rounded flex flex-col gap-2">
                            <Shield className="w-4 h-4 text-white/40" />
                            <span className="text-[10px] font-bold uppercase">2yr Warranty</span>
                        </div>
                    </div>

                    <button
                        onClick={() => addToCart(product)}
                        className="w-full bg-white text-black py-4 rounded text-xs font-bold uppercase tracking-[0.2em] hover:bg-[#eaeaea] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                    >
                        Deploy_To_Inventory
                    </button>

                    <Link href="/checkout" className="text-center text-[10px] text-white/40 uppercase font-bold tracking-widest hover:text-white transition-all underline underline-offset-4 decoration-white/10">
                        Proceed to Instant Checkout
                    </Link>
                </div>
            </div>
        </div>
    );
}
