import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { AppHeader } from "@/components/header"
import { AppFooter } from "@/components/footer"
import { Providers } from "@/components/providers"
import { Suspense } from "react"
import { ErrorBoundary } from "@/components/error-boundary"

export const viewport = {
  width: "device-width",
  initialScale: 1,
}

export const metadata: Metadata = {
  title: "Polaris | Spend the stock, don't sell the stock — on X Layer",
  description:
    "Pay a merchant in stablecoin against tokenized equity you keep. The shares lock, the merchant is paid now, and you still own the position. Collateralized checkout on X Layer.",
  // Fhenix/FHE/Confidential Lending described a different project; nothing here
  // is encrypted or confidential, and claiming it in metadata is a false claim
  // to anyone who finds the page by searching for it.
  keywords: "X Layer, OKX, RWA, tokenized stocks, xStocks, collateralized checkout, USDT0, on-chain credit, BNPL",
  authors: [{ name: "Polaris Team" }],
  creator: "Polaris",
  publisher: "Polaris",
  robots: "index, follow",
  icons: {
    icon: "/logo-image.png",
    apple: "/logo-image.png",
  },
}


export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className={`font-display ${GeistSans.variable} ${GeistMono.variable} antialiased min-h-dvh bg-background`}>
        <Suspense fallback={<div>Loading...</div>}>
          <Providers>
            <ErrorBoundary>
              <div className="mx-auto w-full flex flex-col min-h-screen px-4 md:px-8 lg:px-12">
                <AppHeader />
                <main className="pb-24 flex-grow">{children}</main>
                <AppFooter />
              </div>
            </ErrorBoundary>
          </Providers>
        </Suspense>
        {/* Vercel Web Analytics serves its script only once the feature is
            switched on for the project. Rendering the component regardless
            puts a guaranteed 404 in every visitor's console. Turn it on in
            the project settings, then set NEXT_PUBLIC_VERCEL_ANALYTICS=1. */}
        {process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === "1" && <Analytics />}
      </body>
    </html>
  )
}
