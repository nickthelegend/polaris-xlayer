require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../../.env" });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

// The demo has three people in it. On a public network they have to be three
// actual accounts, or every balance assertion double-counts.
const ACTORS = ["ACTOR_SHOPPER_KEY", "ACTOR_MERCHANT_KEY", "ACTOR_LIQUIDATOR_KEY"]
  .map((k) => process.env[k])
  .filter(Boolean);
const ALL_KEYS = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY, ...ACTORS] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // PolarisEngine.openLoan carries enough locals to blow the stack under
      // the legacy pipeline. viaIR also produces smaller runtime code, which
      // matters on an L2 where deployment is priced by calldata bytes.
      viaIR: true,
      // Sepolia has cancun opcodes available.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    // X Layer, OKX's L2. It runs the OP Stack — OKX migrated it off Polygon
    // CDK in December 2025 — with ZK validity proofs rather than Cannon fault
    // proofs. Confirmed on chain, not from docs: the OP predeploys at
    // 0x42..15/16/0F all have code and optimism_syncStatus answers.
    //
    // Chain ids likewise confirmed by eth_chainId against the live RPCs. The
    // docs still say testnet is 195; the old 195 testnet is deprecated with an
    // empty RPC list and the live one answers 1952.
    xlayerTestnet: {
      url: process.env.XLAYER_TESTNET_RPC_URL || "https://testrpc.xlayer.tech",
      chainId: 1952,
      accounts: ALL_KEYS,
    },
    xlayer: {
      url: process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech",
      chainId: 196,
      accounts: ALL_KEYS,
    },
  },
  /*
   * Verify on Sourcify, not only OKLink.
   *
   * OKLink's verify endpoint needs an API key, and there is not one in this
   * repository — which left every contract reading "Contract source code
   * unverified" on the explorer, so the strongest part of this project was
   * the one part a reviewer could not read. Sourcify supports X Layer testnet
   * (1952) and mainnet (196), takes no key, and publishes a full-matched
   * source bundle anyone can fetch. The OKLink config stays below so a single
   * OKLINK_API_KEY switches it on as well.
   */
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify.dev/server",
    browserUrl: "https://repo.sourcify.dev",
  },

  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      xlayer: process.env.OKLINK_API_KEY || "",
      xlayerTestnet: process.env.OKLINK_API_KEY || "",
    },
    customChains: [
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api-sepolia.etherscan.io/api",
          browserURL: "https://sepolia.etherscan.io",
        },
      },
      {
        network: "xlayer",
        chainId: 196,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER",
          browserURL: "https://www.oklink.com/xlayer",
        },
      },
      {
        network: "xlayerTestnet",
        chainId: 1952,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET",
          browserURL: "https://www.oklink.com/xlayer-test",
        },
      },
    ],
  },
};
