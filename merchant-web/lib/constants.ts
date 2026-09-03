/**
 * Where this app's contracts actually live.
 *
 * These were X Layer addresses, on a chain Polaris has not run on since the
 * port — so every read returned nothing and every write went to a contract that
 * is not there. `packages/protocol` had no X Layer network configured at all
 * and its deploy script had drifted from its own constructors, which is why it
 * had never been deployed here. Both are fixed; the stack below is deployed on
 * X Layer testnet and generated from
 * `packages/protocol/deployments/xlayerTestnet.json`.
 */
export const CONTRACTS = {
    MASTER: {
        POOL_MANAGER: "0x6f6a896fF8BF702767889427A76327DFD19E9322",
        LOAN_ENGINE: "0x8219Ae1133Ffc29DC6E1eA14499175dA2A50ac26",
        SCORE_MANAGER: "0xe9CBebA225620Fc27a50c8BAF895A19732501a60",
        CREDIT_ORACLE: "0xA01f61e320F60565ae333Be1eE6035Fa9Be40458",
        PROTOCOL_FUNDS: "0x7362ac5c50A9c2D474779cECD4627615182b20d8",
        MERCHANT_ROUTER: "0xeB4236e77f192d8368af8df8aC17B9cBeEbb4025",
        CREDIT_VAULT: "0x006EE3CD409c56322C7071BC28aF54A7E9307ae6",
        LIQUIDITY_VAULT: "0x011775A3686552e0a0536B0540Fff9042dBd53D6",
        INSURANCE_POOL: "0xBF7BCe8Eed0f596d9f16ea750206821a59c316f3",
        USDC: "0x35b28346088C9A7BD31D68CFc95263A3A830E260",
        USDT: "0x43920BeB09F74f64691E52DDA91bDe5Ba7168657",
    },
};

export const NETWORKS = {
    XLAYER_TESTNET: {
        chainId: 1952,
        name: "X Layer Testnet",
        rpc: "https://testrpc.xlayer.tech",
        explorer: "https://www.oklink.com/x-layer-testnet",
    },
    LOCAL_HARDHAT: {
        chainId: 31337,
        name: "Hardhat Local",
        rpc: "http://127.0.0.1:8545",
        explorer: "https://www.oklink.com/x-layer-testnet",
    },
};

/** The chain this app talks to. */
export const ACTIVE_NETWORK = NETWORKS.XLAYER_TESTNET;
