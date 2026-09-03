require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../../.env" });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        // The installed OpenZeppelin requires ^0.8.24 (EIP712, Strings,
        // Bytes), so this package stopped compiling at all with only 0.8.20
        // and 0.8.23 configured. 0.8.24 is what packages/contracts already
        // uses, which keeps one compiler across the repository.
        compilers: [
            { version: "0.8.20", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
            { version: "0.8.23", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
            { version: "0.8.24", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } }
        ],
    },
    networks: {
        hardhat: {
            chainId: 1337,
        },
        // Polaris runs on X Layer. This package had every chain it has ever
        // been on except the one the product is deployed to, which is why
        // merchant-web was still pointed at Sepolia addresses.
        xlayerTestnet: {
            url: process.env.XLAYER_TESTNET_RPC_URL || "https://testrpc.xlayer.tech",
            chainId: 1952,
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : process.env.PRIVATE_KEY
                  ? [process.env.PRIVATE_KEY]
                  : [],
        },
        ganache: {
            url: "http://127.0.0.1:7545",
            // This had a private key written into it. It only ever unlocked a
            // local ganache account, but a key committed to a public repository
            // is a key that gets copied into somewhere that matters — and it
            // taught anyone reading the file that this is how keys are handled
            // here. Every other network below reads the environment; so does
            // this one now.
            accounts: process.env.GANACHE_PRIVATE_KEY ? [process.env.GANACHE_PRIVATE_KEY] : [],
        },
        ctcTestnet: {
            url: "https://rpc.cc3-testnet.creditcoin.network",
            chainId: 102031,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
        uscTestnetV2: {
            url: "https://rpc.usc-testnet2.creditcoin.network",
            chainId: 102036,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
        sepolia: {
            url: "https://1rpc.io/sepolia",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
        baseSepolia: {
            url: String("https://base-sepolia.api.onfinality.io/public"),
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 84532,
        },
        fuji: {
            url: "https://api.avax-test.network/ext/bc/C/rpc",
            chainId: 43113,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
        monadTestnet: {
            url: String("https://testnet-rpc.monad.xyz/"),
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 20143,
        },
        cronosTestnet: {
            url: String("https://evm-t3.cronos.org"),
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 338,
        }
    }
};
