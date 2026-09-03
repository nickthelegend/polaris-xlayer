import Link from "next/link"

/**
 * The 404 that belongs to this shop.
 *
 * Next's default is an unstyled white page with a thin border, which on a black
 * storefront reads as the site having crashed rather than a link being wrong.
 */
export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-32 text-center">
      <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">Error_404</p>
      <h1 className="mt-4 text-3xl font-black uppercase tracking-tighter">Module_Not_Found</h1>
      <p className="mt-4 text-sm text-white/40 max-w-sm mx-auto">
        Nothing at this address. The catalogue is where everything lives.
      </p>
      <div className="mt-8 flex flex-wrap gap-3 justify-center">
        <Link
          href="/"
          className="bg-white text-black px-6 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-80 transition-all"
        >
          Browse_Modules
        </Link>
        <Link
          href="/orders"
          className="border border-white/15 px-6 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:border-white/40 transition-all"
        >
          Your_Orders
        </Link>
      </div>
    </div>
  )
}
