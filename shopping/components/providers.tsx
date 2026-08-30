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
                defaultChain: {
                    id: 11155111,
                    name: "Ethereum Sepolia",
                    network: "sepolia",
                    nativeCurrency: {
                        name: "ETH",
                        symbol: "ETH",
                        decimals: 18,
                    },
                    rpcUrls: {
                        default: {
                            http: ["https://eth-sepolia.g.alchemy.com/v2/3qRB0TMQQv3hyKgav_6lF"],
                        },
                        public: {
                            http: ["https://eth-sepolia.g.alchemy.com/v2/3qRB0TMQQv3hyKgav_6lF"],
                        },
                    },
                },
                supportedChains: [
                    {
                        id: 11155111,
                        name: "Ethereum Sepolia",
                        network: "sepolia",
                        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                        rpcUrls: {
                            default: { http: ["https://eth-sepolia.g.alchemy.com/v2/3qRB0TMQQv3hyKgav_6lF"] },
                            public: { http: ["https://eth-sepolia.g.alchemy.com/v2/3qRB0TMQQv3hyKgav_6lF"] },
                        },
                        blockExplorers: {
                            default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
                        },
                    }
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
