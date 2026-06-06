"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6 }
};

const Logo = () => (
  <div className="flex items-center gap-1 font-black text-2xl tracking-tighter">
    Polaris
  </div>
);

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-primary selection:text-black">
      {/* HERO SECTION - Neon Lime Background */}
      <div className="bg-[#ccff00] text-black w-full rounded-b-[3rem] lg:rounded-b-[4rem] px-6 lg:px-20 pb-20 relative overflow-hidden">
        
        {/* Header */}
        <header className="flex items-center justify-between py-6 max-w-[1400px] mx-auto z-10 relative">
          <Logo />
          <nav className="hidden md:flex items-center gap-8 font-bold text-[10px] tracking-widest uppercase">
            <Link href="#" className="hover:opacity-70 transition-opacity">Whitepaper</Link>
            <Link href="https://docs.polarispay.app" className="hover:opacity-70 transition-opacity">Docs</Link>
            <Link href="https://merchants.polarispay.app" className="hover:opacity-70 transition-opacity">Merchants</Link>
            <Link href="#" className="hover:opacity-70 transition-opacity">Build</Link>
            <Link href="#" className="hover:opacity-70 transition-opacity">Blog</Link>
            <Link href="#" className="hover:opacity-70 transition-opacity">Join Us</Link>
          </nav>
          <a
            href="https://app.polarispay.app"
            className="bg-black text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-full hover:bg-neutral-800 transition-colors"
          >
            Launch App
          </a>
        </header>

        {/* Hero Content */}
        <div className="max-w-[1400px] mx-auto mt-20 lg:mt-32 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center z-10 relative">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="flex flex-col gap-8"
          >
            <h1 className="text-5xl lg:text-7xl font-black leading-[0.9] tracking-tight uppercase">
              Confidential<br />Buy Now,<br />Pay Later.
            </h1>
            <p className="text-sm lg:text-base font-medium max-w-md leading-relaxed">
              Leverage your on-chain assets to instantly access private credit everywhere. Polaris empowers your purchases with full privacy via Fhenix fHEVM.
            </p>
            <div>
              <Link 
                href="https://app.polarispay.app" 
                className="inline-block bg-black text-white font-bold text-xs uppercase tracking-wider px-8 py-4 rounded-full hover:bg-neutral-800 hover:scale-105 transition-all"
              >
                Get Credit
              </Link>
            </div>
            
            <div className="flex items-center gap-12 mt-8 pt-8 border-t border-black/10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1">Privacy Guarantee</p>
                <div className="text-3xl font-black">100%</div>
              </div>
              <div className="w-px h-12 bg-black/10"></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1">Payment Speed</p>
                <div className="text-3xl font-black">&lt;2s</div>
              </div>
            </div>
          </motion.div>

          {/* Hero Dashboard Graphic Mockup */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="bg-[#111] rounded-3xl p-6 shadow-2xl overflow-hidden border border-[#222]"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-full bg-[#ccff00] flex items-center justify-center pt-1 text-black font-black text-xl leading-none">
                ♦
              </div>
              <span className="text-white font-bold text-sm tracking-wide">oblETH Collateral</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#1a1a1a] rounded-xl p-4 col-span-1 h-32 flex flex-col justify-between">
                <span className="text-[#ccff00] text-[8px] font-bold uppercase tracking-widest">Credit Utilization</span>
                <div className="flex items-end gap-1 h-16">
                  {/* Mock Bar Chart */}
                  {[4,5,6,6,7,8,8,9,9,10,11,12,13,15,18,22].map((h, i) => (
                    <div key={i} className="bg-[#ccff00] w-full rounded-sm" style={{ height: `${h * 4}%` }} />
                  ))}
                </div>
              </div>
              
              <div className="grid grid-rows-2 gap-4 col-span-1">
                 <div className="bg-[#1a1a1a] rounded-xl p-4 flex flex-col justify-center">
                    <span className="text-[#ccff00] text-[8px] font-bold uppercase tracking-widest mb-1">Interest Rate</span>
                    <span className="text-white font-bold text-xl">4.2%</span>
                 </div>
                 <div className="bg-[#1a1a1a] rounded-xl p-4 flex flex-col justify-center">
                    <span className="text-[#ccff00] text-[8px] font-bold uppercase tracking-widest mb-1">Credit Manager</span>
                    <span className="text-white font-medium text-xs opacity-80 truncate">0x73e...eDd9</span>
                 </div>
              </div>
              
              <div className="bg-[#1a1a1a] rounded-xl p-4 col-span-1 h-32 flex flex-col">
                <span className="text-[#ccff00] text-[8px] font-bold uppercase tracking-widest mb-auto">Total Debt</span>
                {/* Mock Line Chart SVG Curve */}
                <svg viewBox="0 0 100 50" className="w-full h-16 stroke-[#ccff00] fill-none" preserveAspectRatio="none">
                  <path d="M0,45 C20,40 40,40 60,30 C80,20 90,10 100,5" strokeWidth="1" />
                </svg>
              </div>

              <div className="bg-[#1a1a1a] rounded-xl p-4 col-span-1 flex flex-col justify-center">
                <span className="text-[#ccff00] text-[8px] font-bold uppercase tracking-widest mb-2">Credit Limit</span>
                <div className="h-2 w-full bg-[#333] rounded-full flex overflow-hidden">
                   <div className="h-full bg-[#ccff00] w-[60%]"></div>
                   {/* Dotted lines effect over it */}
                   <div className="absolute h-2 w-[calc(50%-2rem)] flex gap-[2px]">
                     {Array.from({length: 30}).map((_, i) => <div key={i} className="h-full w-[2px] bg-black/50"></div>)}
                   </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-6 lg:px-20 py-24 flex flex-col gap-8">
        
        {/* Partners */}
        <div className="flex flex-wrap justify-center gap-12 lg:gap-24 items-center opacity-60 grayscale pb-10">
          <span className="font-bold text-2xl tracking-tighter">Fhenix fHEVM</span>
          <span className="font-bold text-2xl tracking-tighter flex items-center gap-2">
            <div className="w-4 h-4 bg-white rounded-full"></div>Reclaim
          </span>
          <span className="font-bold text-2xl tracking-tighter">Base</span>
          <span className="font-bold text-2xl tracking-tighter">Ethereum</span>
        </div>

        {/* Introducing Banner */}
        <motion.section 
          {...fadeInUp}
          className="bg-gradient-to-r from-black via-[#050505] to-black border border-white/10 rounded-2xl p-8 lg:p-12 flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden"
        >
          {/* Mock 3D YO logo graphic */}
          <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-gradient-to-r from-[#ccff00]/10 to-transparent blur-3xl z-0"></div>
          
          <div className="flex items-center gap-12 z-10 w-full">
            <div className="hidden lg:flex relative w-32 h-32 items-center justify-center transform -rotate-12">
              <div className="text-[120px] font-black leading-none text-transparent" style={{ WebkitTextStroke: '2px #ccff00', textShadow: "0 0 20px rgba(204,255,0,0.5)"}}>
                O
              </div>
              <div className="absolute translate-x-12 translate-y-4 text-[120px] font-black leading-none text-[#ccff00] drop-shadow-[0_0_30px_rgba(204,255,0,0.4)]">
                O
              </div>
            </div>
            
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-xl lg:text-3xl font-bold text-white uppercase tracking-tight">
                <span className="text-[#ccff00]">Introducing Polaris:</span><br/>
                Confidential Buy Now, Pay Later on Fhenix
              </h2>
            </div>
            
            <Link 
              href="https://app.polarispay.app" 
              className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider px-8 py-4 rounded-full hover:bg-white hover:scale-105 transition-all whitespace-nowrap"
            >
              Get Started
            </Link>
          </div>
        </motion.section>

        {/* Built By Banner */}
        <motion.section 
          {...fadeInUp}
          className="bg-[#85A1FF] text-black rounded-2xl p-8 lg:p-10 flex flex-col md:flex-row items-center justify-between gap-8"
        >
          <div className="max-w-xl">
            <h2 className="text-3xl lg:text-4xl font-black mb-4 tracking-tighter uppercase">Powered By Fhenix fHEVM</h2>
            <p className="font-medium text-sm leading-relaxed opacity-80">
              Secure, confidential on-chain computation enables seamless credit management and private payment tracking across the ecosystem.
            </p>
          </div>
          <div className="font-black text-xl italic opacity-90 flex flex-col items-center">
            {/* Mock chainlink logo */}
            <div className="flex gap-1 mb-1">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center text-white">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              </div>
            </div>
            Fhenix
          </div>
        </motion.section>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Card 1 */}
          <motion.div 
            {...fadeInUp}
            className="bg-[#5EF1A0] text-black rounded-3xl p-8 lg:p-12 flex flex-col justify-between overflow-hidden relative min-h-[440px] md:min-h-[600px] md:row-span-2"
          >
            <div className="z-10 max-w-sm mb-12">
              <h3 className="text-3xl lg:text-5xl font-black uppercase tracking-tight leading-[0.9] mb-4">Confidential<br/>Credit</h3>
              <p className="font-medium text-sm lg:text-base opacity-80 leading-relaxed">
                Deposit your assets into Polaris Vaults. Polaris securely tracks your credit worthiness via fHEVM to unlock private BNPL everywhere.
              </p>
            </div>
            
            {/* Radar graphic mock */}
            <div className="absolute -bottom-20 -right-20 lg:-bottom-10 lg:-left-20 w-[600px] h-[600px] rounded-full border border-black/10 flex items-center justify-center z-0">
               <div className="w-[450px] h-[450px] rounded-full border border-black/10 flex items-center justify-center relative">
                 <div className="absolute top-[10%] left-[20%] w-6 h-6 bg-white rounded-full"></div>
                 <div className="w-[300px] h-[300px] rounded-full border border-black/10 flex items-center justify-center relative">
                    <div className="absolute -top-3 right-[15%] w-10 h-10 bg-[#33A96C] rounded-full"></div>
                    <div className="w-[150px] h-[150px] bg-[#33A96C] rounded-full"></div>
                 </div>
               </div>
            </div>
          </motion.div>

          {/* Card 2 */}
          <motion.div 
            {...fadeInUp}
            className="bg-[#7FF6FF] text-black rounded-3xl p-8 lg:p-12 relative overflow-hidden min-h-[300px]"
          >
            <div className="z-10 max-w-sm mb-8 relative">
              <h3 className="text-3xl lg:text-4xl font-black uppercase tracking-tight leading-[0.9] mb-4">Identity &<br/>Trust</h3>
              <p className="font-medium text-sm opacity-80 leading-relaxed">
                Integrated with Reclaim Protocol for Zero-Knowledge KYC and Sybil resistance to ensure robust, secure peer-to-peer credit pools.
              </p>
            </div>
            {/* Graphics mock */}
            <div className="absolute right-[-10%] bottom-[-20%] w-full h-[60%] border-t border-black/20 flex flex-col justify-end gap-2 pb-6 px-4">
              <div className="w-48 h-16 rounded-full border border-black/20 self-end mr-10 bg-[#00A1A1] flex items-center justify-center relative shadow-inner">
                 {/* checkmark */}
                 <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                   <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                 </svg>
              </div>
               <div className="w-56 h-12 rounded-full border border-black/20 self-center bg-[#00A1A1]/40"></div>
            </div>
          </motion.div>

          {/* Card 3 */}
          <motion.div 
            {...fadeInUp}
            className="bg-[#BB8EF6] text-black rounded-3xl p-8 lg:p-12 relative overflow-hidden min-h-[300px]"
          >
            <div className="z-10 max-w-sm mb-8 relative">
              <h3 className="text-3xl lg:text-4xl font-black uppercase tracking-tight leading-[0.9] mb-4">One-Click<br/>Checkout</h3>
              <p className="font-medium text-sm opacity-80 leading-relaxed">
                Seamless merchant integrations allow you to Buy Now and Pay Later with a single confidential transaction, no matter where you are.
              </p>
            </div>
            {/* Graphics mock: overlapping circles */}
            <div className="absolute right-0 bottom-[-30%] w-[120%] h-[80%] flex items-end opacity-60 mix-blend-multiply">
               {Array.from({length: 8}).map((_,i) => (
                 <div key={i} className="absolute right-0 bottom-0 rounded-full border border-indigo-900/40" 
                      style={{
                        width: `${200 + i*40}px`, 
                        height: `${200 + i*40}px`, 
                        right: `${i * 30 - 100}px`,
                        bottom: `-50px`
                      }}></div>
               ))}
               <div className="absolute right-10 -bottom-10 w-[200px] h-[200px] bg-indigo-600 rounded-full"></div>
            </div>
          </motion.div>

        </div>

        {/* Non-custodial banner */}
        <motion.section 
          {...fadeInUp}
          className="bg-[#212320] text-white rounded-3xl p-8 lg:p-16 flex flex-col lg:flex-row items-center justify-center lg:justify-between gap-12 mt-10 overflow-hidden relative"
        >
          {/* Radial Dot Pattern Graphic */}
          <div className="relative w-64 h-64 flex items-center justify-center">
             <div className="absolute inset-0 flex items-center justify-center">
                {/* Dots */}
                <div className="grid grid-cols-5 gap-6 opacity-30">
                  {Array.from({length: 25}).map((_,i) => <div key={i} className="w-1 h-1 bg-white rounded-full"></div>)}
                </div>
             </div>
             {/* Circular layout */}
             <div className="relative w-48 h-48 border border-white/5 rounded-full flex items-center justify-center animate-[spin_60s_linear_infinite]">
                {[0,45,90,135,180,225,270,315].map((deg) => (
                  <div key={deg} className="absolute w-8 h-8 rounded-full bg-white/5 backdrop-blur-sm border border-white/10"
                       style={{ transform: `rotate(${deg}deg) translateY(-80px)` }}></div>
                ))}
             </div>
             {/* Center YO */}
             <div className="absolute text-5xl font-black text-[#ccff00] tracking-tighter">POLARIS</div>
          </div>

          <div className="max-w-md text-center lg:text-left z-10">
            <h2 className="text-3xl lg:text-4xl font-black text-[#ccff00] uppercase tracking-tight leading-[0.9] mb-4">
              Decentralized &<br/>Trustless
            </h2>
            <p className="font-medium text-sm lg:text-base opacity-80 leading-relaxed text-[#ccff00]/90">
              Maintain full ownership of your collateral. Smart contracts handle LTV calculations, liquidation, and settlement automatically.
            </p>
          </div>
        </motion.section>

        {/* FOR MERCHANTS SECTION */}
        <motion.section 
          {...fadeInUp}
          className="bg-zinc-900 border border-zinc-800 rounded-[3rem] p-8 lg:p-16 mt-16 overflow-hidden relative"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center z-10 relative">
            <div>
              <span className="text-[#ccff00] text-xs font-bold uppercase tracking-[0.3em] mb-4 block">For Businesses</span>
              <h2 className="text-4xl lg:text-6xl font-black text-white uppercase tracking-tight leading-[0.9] mb-8">
                Empower Your<br />Sales with<br />Polaris Merchant.
              </h2>
              <ul className="flex flex-col gap-6 mb-10">
                <li className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/30 flex items-center justify-center text-[#ccff00] text-xs mt-1">✓</div>
                  <div>
                    <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-1">Instant Settlement</h4>
                    <p className="text-white/60 text-xs">No more 30-day waiting. Funds are settled on-chain instantly after customer confirmation.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/30 flex items-center justify-center text-[#ccff00] text-xs mt-1">✓</div>
                  <div>
                    <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-1">Zero Chargebacks</h4>
                    <p className="text-white/60 text-xs">All payments are pre-collateralized on the protocol, eliminating fraud and chargeback risk.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-[#ccff00]/10 border border-[#ccff00]/30 flex items-center justify-center text-[#ccff00] text-xs mt-1">✓</div>
                  <div>
                    <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-1">Global Customer Base</h4>
                    <p className="text-white/60 text-xs">Accept customers using collateral from any chain, from Polygon to Base to Monad.</p>
                  </div>
                </li>
              </ul>
              <Link 
                href="https://merchants.polarispay.app" 
                className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider px-10 py-5 rounded-full hover:bg-white hover:scale-105 transition-all inline-block"
              >
                Go To Merchant Portal
              </Link>
            </div>

            <div className="relative">
              {/* Merchant Dashboard Interface Mockup */}
              <div className="bg-black rounded-2xl border border-white/5 p-6 shadow-2xl relative">
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Store Revenue</span>
                    <div className="flex gap-2">
                       <div className="w-2 h-2 rounded-full bg-red-500"></div>
                       <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                       <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    </div>
                  </div>
                  <div className="text-5xl font-black text-white tracking-tighter mb-8">$142,504<span className="text-[#ccff00] text-sm opacity-60 ml-2">.20</span></div>
                  
                  <div className="space-y-4">
                     {[1,2,3].map((item) => (
                       <div key={item} className="p-4 bg-zinc-900/50 rounded-xl flex items-center justify-between border border-white/5">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded bg-[#ccff00]/10 border border-[#ccff00]/20 flex items-center justify-center text-[#ccff00]">🛒</div>
                             <div>
                                <div className="text-xs font-bold text-white uppercase tracking-wide">Sale #{1028 + item}</div>
                                <div className="text-[10px] text-white/40 font-medium">Pending Settlement</div>
                             </div>
                          </div>
                          <div className="text-right">
                             <div className="text-xs font-bold text-white">$1,250.00</div>
                             <div className="text-[8px] text-[#ccff00] font-bold uppercase">USDC</div>
                          </div>
                       </div>
                     ))}
                  </div>
              </div>
              {/* Decorative elements */}
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#ccff00] rounded-full blur-[100px] opacity-20 pointer-events-none"></div>
              <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-blue-500 rounded-full blur-[120px] opacity-10 pointer-events-none"></div>
            </div>
          </div>
        </motion.section>

        {/* Join Community */}
        <motion.section 
          {...fadeInUp}
          className="py-32 flex flex-col items-center justify-center text-center px-4"
        >
          <h2 className="text-4xl lg:text-6xl font-black uppercase tracking-tight leading-[0.9] mb-12">
            <span className="text-[#ccff00]">Join Our Community</span><br/>
            For The Latest Updates
          </h2>
          <a
            href="https://t.me/polarispay"
            className="bg-[#ccff00] text-black font-bold text-sm uppercase tracking-wider px-10 py-5 rounded-full hover:bg-white hover:scale-105 transition-all flex items-center gap-3"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.54-.36-.63-.2-1.12-.31-1.08-.65.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.28-.01.07.01.19 0 .33z"/></svg>
            Join Telegram
          </a>
        </motion.section>

        {/* Build With YO */}
        <motion.section 
          {...fadeInUp}
          className="bg-[#212320] text-white rounded-3xl overflow-hidden flex flex-col lg:flex-row mb-12"
        >
          <div className="w-full lg:w-1/2 min-h-[300px] border-r border-[#333] relative p-8">
             {/* Mock grid wireframe graphic */}
             <div className="absolute inset-0 bg-[linear-gradient(to_right,#333_1px,transparent_1px),linear-gradient(to_bottom,#333_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-30"></div>
             <div className="absolute inset-0 flex items-center justify-center mix-blend-screen opacity-50">
               <div className="w-48 h-48 border-[2px] border-[#ccff00] rounded-full translate-x-12"></div>
               <div className="w-0 h-0 border-l-[100px] border-l-transparent border-t-[150px] border-t-white/30 border-r-[100px] border-r-transparent -translate-x-12 translate-y-12 backdrop-blur-md"></div>
             </div>
             <div className="absolute w-full h-[1px] bg-[#ccff00]/40 rotate-12 top-1/2 -left-10"></div>
             <div className="absolute w-[1px] h-full bg-[#ccff00]/40 rotate-[30deg] left-1/3 top-0"></div>
          </div>
          <div className="p-12 lg:p-16 lg:w-1/2 flex flex-col justify-center">
            <h2 className="text-3xl lg:text-4xl font-black text-[#ccff00] uppercase tracking-tight leading-[0.9] mb-4">
              Build With Polaris
            </h2>
            <p className="font-medium text-sm lg:text-base opacity-80 mb-8 text-[#ccff00]/90">
              Integrate Polaris into your dApp or storefront to offer instant Web3 BNPL checkout to your customers.
            </p>
            <div>
              <button className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider px-8 py-3 rounded-full hover:bg-white transition-all">
                Get In Touch
              </button>
            </div>
          </div>
        </motion.section>
        
      </main>
      
      {/* Footer footer */}
      <footer className="border-t border-white/5 py-12 px-6 lg:px-20 max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <Logo />
        <div className="flex gap-4 text-[10px] text-white/40 uppercase tracking-widest font-bold">
          <span>© 2026 POLARIS</span>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy Note</Link>
          <Link href="https://docs.polarispay.app" className="hover:text-white transition-colors">Docs</Link>
        </div>
      </footer>
    </div>
  );
}
