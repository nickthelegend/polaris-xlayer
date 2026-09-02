import { defineChain } from "viem";

/**
 * X Layer, as the app's own chain definition.
 *
 * viem/wagmi ship an `xLayer` chain but not the current testnet: OKX
 * relaunched it under a new id and the old one is deprecated with an empty RPC
 * list. Both are defined here from values read off the live RPC with
 * `eth_chainId`, because the official docs still publish 195.
 */
export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/x-layer-testnet" },
  },
  testnet: true,
});

export const xLayerMainnet = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/x-layer" },
  },
});

/** The chain this deployment talks to. */
export const ACTIVE_CHAIN = xLayerTestnet;

/**
 * Params for `wallet_addEthereumChain`, for a wallet that has never seen
 * X Layer. A bare `wallet_switchEthereumChain` fails on those with 4902.
 */
export const ADD_CHAIN_PARAMS = {
  chainId: "0x7A0", // 1952
  chainName: xLayerTestnet.name,
  nativeCurrency: xLayerTestnet.nativeCurrency,
  rpcUrls: [...xLayerTestnet.rpcUrls.default.http],
  blockExplorerUrls: [xLayerTestnet.blockExplorers.default.url],
} as const;
