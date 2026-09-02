import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stockline — spend the stock, don't sell the stock",
  description: "Pay a merchant in stablecoin against tokenized equity, on X Layer, without closing the position.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav>
          <a href="/">Checkout</a>
          <a href="/positions">Positions</a>
          <a href="/admin">Book &amp; price</a>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "rgb(245 249 255 / .35)" }} className="mono">
            X Layer testnet · 1952
          </span>
        </nav>
        {children}
      </body>
    </html>
  );
}
