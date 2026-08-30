import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
  The product's real faces, from mobile/src/theme/typography.ts: Space Grotesk
  for everything a person reads, JetBrains Mono for anything a machine produced
  — addresses, signatures, program ids, order references.
*/
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const url = "https://polarispay.app";
const description =
  "A payments layer with credit built in, on Solana. Pay in full, subscribe, or split into four against an undercollateralized credit line underwritten from your wallet's own history.";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: "Polaris Pay — Credit, built into the payment",
    template: "%s — Polaris Pay",
  },
  description,
  applicationName: "Polaris Pay",
  keywords: [
    "Solana",
    "payments",
    "credit",
    "BNPL",
    "pay in four",
    "Solana Pay",
    "USDC",
    "stablecoin credit",
  ],
  openGraph: {
    type: "website",
    url,
    siteName: "Polaris Pay",
    title: "Polaris Pay — Credit, built into the payment",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Polaris Pay — Credit, built into the payment",
    description,
  },
  icons: {
    icon: "/star.png",
    shortcut: "/star.png",
    apple: "/star.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/*
          Opt into the JS-driven reveal, before first paint.

          `globals.css` only hides `[data-anim]` under `html.anim`, so this one
          line is what arms the whole animation system. If it never runs — JS
          off, a script error, a crawler — the page renders fully visible
          instead of blank. The second condition is the one that actually bit
          during development: GSAP is driven by requestAnimationFrame, which
          never fires in a hidden document, so a page loaded in a background
          tab would sit invisible until focused. Skipping the guard there means
          the content is simply there, and the animation is the enhancement it
          was always supposed to be.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('armed')}",
          }}
        />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
