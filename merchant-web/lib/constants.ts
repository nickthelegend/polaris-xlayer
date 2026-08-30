export const CONTRACTS = {
    MASTER: {
        POOL_MANAGER: "0x130AD70864F8F5A6f83058951B544a7be5Bc2bc0",
        LOAN_ENGINE: "0xdE8B22E09f0BCfEC41900b8ef748Ec0c5FF18BD3",
        SCORE_MANAGER: "0xB068daeb4CeDB6CEe14b7806a2e0F1E2184e512a",
        CREDIT_ORACLE: "0x7716D5ea002e42b3f0cCC75aCCE602832cF46be6",
        PROTOCOL_FUNDS: "0x1B19E402F4082Aa6704ea2444a2383C566806AC6",
        MERCHANT_ROUTER: "0xCa924A3bC86b2EaBDc01a3617CA89c3CD383B19B",
        USDC: "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0",
        USDT: "0xfCaBa68297d86E56e01E8e9CcB88AF06bc093b9E",
        WETH: "0xC14c378c295D9B518f3086d7389b7d3553d6F5DA",
        BNB: "0xf8b85BCf5a9b52F3D95b323a82F3cF90dF8AB0C1",
    },
};

export const NETWORKS = {
    SEPOLIA: {
        chainId: 11155111,
        name: "Ethereum Sepolia",
        rpc: "https://eth-sepolia.g.alchemy.com/v2/3qRB0TMQQv3hyKgav_6lF",
        explorer: "https://sepolia.etherscan.io",
    },
    LOCAL_HARDHAT: {
        chainId: 31337,
        name: "Hardhat Local",
        rpc: "http://127.0.0.1:8545",
        explorer: "https://sepolia.etherscan.io",
    },
};
