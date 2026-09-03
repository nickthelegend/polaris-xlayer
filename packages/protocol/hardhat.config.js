require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

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
        ganache: {
            url: "http://127.0.0.1:7545",
            accounts: ["0xdb8cfa2db2a866e6fea3d4388da2278f8ef7367180d5921b96661d946b244c86"],
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
