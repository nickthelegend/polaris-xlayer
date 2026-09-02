require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../../.env" });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // StocklineEngine.openLoan carries enough locals to blow the stack under
      // the legacy pipeline. viaIR also produces smaller runtime code, which
      // matters on a zkEVM where deployment is priced by bytes.
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
    // X Layer, OKX's zkEVM. Chain ids confirmed by eth_chainId against the
    // live RPCs, not from docs: the old X1 testnet was 195 and is gone; the
    // current testnet answers 1952.
    xlayerTestnet: {
      url: process.env.XLAYER_TESTNET_RPC_URL || "https://testrpc.xlayer.tech",
      chainId: 1952,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    xlayer: {
      url: process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech",
      chainId: 196,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
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
