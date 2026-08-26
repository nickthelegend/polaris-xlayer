"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Copy, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Connect, and everything that follows from being connected.
 *
 * Talks to wagmi's injected connector directly rather than opening a RainbowKit
 * modal -- see components/providers.tsx for why that modal could not list the
 * user's own wallet.
 */
export function ConnectWalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [mounted, setMounted] = useState(false);

  // The wallet is a client-only fact, so rendering it during SSR guarantees a
  // hydration mismatch.
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const injected = connectors[0];
  const isSepolia = chain?.id === SEPOLIA_CHAIN_ID;

  const copyAddress = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address);
    toast.success("Address copied");
  };

  const switchToSepolia = () => {
    switchChain(
      { chainId: SEPOLIA_CHAIN_ID },
      {
        onError: () => {
          // The wallet has never seen Sepolia. Adding it is the fix.
          void (window as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum
            ?.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0xAA36A7",
                  chainName: "Sepolia",
                  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                  blockExplorerUrls: ["https://sepolia.etherscan.io"],
                },
              ],
            })
            .catch(() => toast.error("Could not add Sepolia to your wallet"));
        },
      }
    );
  };

  if (!isConnected) {
    return (
      <Button
        onClick={() => {
          if (!injected) {
            toast.error("No browser wallet detected. Install MetaMask to continue.");
            return;
          }
          connect({ connector: injected });
        }}
        disabled={isPending}
        variant="outline"
        className="bg-primary/10 border-primary/20 text-primary font-mono text-[10px] tracking-widest uppercase hover:bg-primary/20 rounded-sm px-4 h-9 disabled:opacity-60"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" />
            CONNECTING
          </span>
        ) : (
          "CONNECT_WALLET"
        )}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      {/* asChild forwards the trigger's props to this child, so the child has
          to be something the keyboard can reach. A div is not: it takes no
          tab stop, which left disconnect, copy-address and switch-network
          mouse-only. A button carries the tab stop and the Enter/Space
          handling that Radix expects. */}
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Wallet menu"
          className="flex flex-col items-end gap-1 cursor-pointer group"
        >
          <span className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-1.5 rounded-sm font-mono text-[10px] font-black tracking-tight transition-all active:scale-95 shadow-[0_0_15px_rgba(166,242,74,0.2)]">
            <span className="size-1.5 bg-primary-foreground rounded-full animate-pulse" />
            {address!.slice(0, 8)}...{address!.slice(-6)}
          </span>
          {!isSepolia && (
            <span className="text-[7px] text-amber-400 font-bold uppercase tracking-widest animate-pulse flex items-center gap-1">
              <ShieldAlert className="size-2" />
              WRONG_NETWORK
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="bg-zinc-950 border-white/10 text-white font-mono min-w-[280px] p-0 overflow-hidden shadow-2xl"
      >
        <div className="bg-white/5 px-4 py-4 border-b border-white/10 flex flex-col gap-2 relative">
          <button
            onClick={copyAddress}
            aria-label="Copy address"
            className="absolute top-4 right-4 text-white/70 hover:text-primary transition-colors"
          >
            <Copy className="size-3" />
          </button>
          <span className="text-[10px] text-white/60 uppercase tracking-widest font-bold">
            Connected
          </span>
          <span className="text-[10px] font-bold break-all text-primary/80 pr-6">{address}</span>
        </div>

        <div className="p-3 flex flex-col gap-2">
          <div className="bg-white/5 p-2 rounded-sm border border-white/5 flex justify-between items-center">
            <span className="text-[11px] text-white/65 uppercase">Network</span>
            <span
              className={`text-[11px] font-black ${isSepolia ? "text-primary" : "text-amber-400"}`}
            >
              {chain?.name ?? "Unknown"}
            </span>
          </div>

          {/* Only offered when it is the fix for something. */}
          {!isSepolia && (
            <DropdownMenuItem
              onClick={switchToSepolia}
              className="flex items-center justify-center gap-2 py-3 px-3 cursor-pointer border text-[10px] uppercase font-black tracking-widest transition-all text-primary hover:text-black hover:bg-primary border-primary/30"
            >
              <ShieldAlert className="size-3" />
              SWITCH_TO_SEPOLIA
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            onClick={() => disconnect()}
            className="flex items-center justify-center gap-2 py-3 px-3 cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 text-[10px] uppercase font-black tracking-widest transition-all"
          >
            <LogOut className="size-3" />
            DISCONNECT
          </DropdownMenuItem>
        </div>

        <div className="bg-white/5 px-4 py-2 border-t border-white/10">
          <span className="text-[11px] text-white/70 uppercase tracking-widest">
            PolarisPay // Sepolia
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
