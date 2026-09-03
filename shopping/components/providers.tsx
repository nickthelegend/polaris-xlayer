"use client"

import type React from "react"
import { PrivyProvider } from "@privy-io/react-auth"
import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <PrivyProvider
            appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmkr3rc4i00iujs0cgnug0qzj"}
            config={{
                appearance: {
                    theme: "dark",
                    accentColor: "#FFFFFF",
                },
                embeddedWallets: {
                    ethereum: {
                        createOnLogin: "users-without-wallets",
                    }
                },
                // Polaris runs on X Layer. This said X Layer, which is a chain the
                // contracts this storefront settles against are not deployed on.
                defaultChain: {
                    id: 1952,
                    name: "X Layer Testnet",
                    network: "xlayer-testnet",
                    nativeCurrency: {
                        name: "OKB",
                        symbol: "OKB",
                        decimals: 18,
                    },
                    rpcUrls: {
                        default: {
                            http: ["https://testrpc.xlayer.tech"],
                        },
                        public: {
                            http: ["https://testrpc.xlayer.tech"],
                        },
                    },
                    blockExplorers: {
                        default: { name: "OKLink", url: "https://www.oklink.com/x-layer-testnet" },
                    },
                },
                supportedChains: [
                    {
                    id: 1952,
                    name: "X Layer Testnet",
                    network: "xlayer-testnet",
                    nativeCurrency: {
                        name: "OKB",
                        symbol: "OKB",
                        decimals: 18,
                    },
                    rpcUrls: {
                        default: {
                            http: ["https://testrpc.xlayer.tech"],
                        },
                        public: {
                            http: ["https://testrpc.xlayer.tech"],
                        },
                    },
                    blockExplorers: {
                        default: { name: "OKLink", url: "https://www.oklink.com/x-layer-testnet" },
                    },
                },
                ]
            }}
        >
            {children}
            <ToastContainer
                position="top-right"
                autoClose={5000}
                hideProgressBar={false}
                newestOnTop={false}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss
                draggable
                pauseOnHover
                theme="dark"
            />
        </PrivyProvider>
    )
}
