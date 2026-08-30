'use client';

import { useParams, useRouter } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import useSWR from 'swr';
import { useState, useEffect } from 'react';
import {
    ArrowLeft,
    ShieldCheck,
    Zap,
    Copy,
    ExternalLink,
    Terminal,
    Cpu,
    Code2,
    CheckCircle2,
    AlertCircle,
    Loader2,
    RefreshCw,
    Globe,
    Receipt,
    Wallet
} from 'lucide-react';
import { ethers } from 'ethers';
import PolarisMerchantEscrow from '@/lib/artifacts/contracts/PolarisMerchantEscrow.sol/PolarisMerchantEscrow.json';
import WebhookManager from '@/components/WebhookManager';
import { CONTRACTS } from '@/lib/constants';

const MERCHANT_ROUTER_ABI = [
    "function merchantWithdraw(address token, uint256 amount, uint64 destChainId) external",
    "function merchantBalances(address merchant, address token) view returns (uint256)"
];

// Mock USDC on Sepolia
const DEFAULT_STABLECOIN = "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0";

export default function AppDetails() {
    const { id } = useParams();
    const router = useRouter();
    const { user, authenticated, login } = usePrivy();
    const { wallets } = useWallets();
    const wallet = wallets[0];

    const [deploying, setDeploying] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [error, setError] = useState('');
    const [logs, setLogs] = useState<any[]>([]);
    const [refreshingLogs, setRefreshingLogs] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [balance, setBalance] = useState('0.00');
    const [routerWithdrawing, setRouterWithdrawing] = useState(false);
    const [routerBalance, setRouterBalance] = useState('0.00');
    const [currentChainId, setCurrentChainId] = useState<number | null>(null);

    // Track current chain
    useEffect(() => {
        const checkChain = async () => {
            if (!wallet) return;
            try {
                const provider = await wallet.getEthereumProvider();
                const chainId = await provider.request({ method: 'eth_chainId' });
                setCurrentChainId(parseInt(chainId as string, 16));
            } catch (e) { }
        };
        checkChain();
        // Listen for chain changes
        if (wallet) {
            wallet.getEthereumProvider().then((provider: any) => {
                provider.on?.('chainChanged', (chainId: string) => {
                    setCurrentChainId(parseInt(chainId, 16));
                });
            }).catch(() => { });
        }
    }, [wallet]);

    const switchToSepolia = async () => {
        if (!wallet) return;
        try {
            await wallet.switchChain(11155111);
            setCurrentChainId(11155111);
        } catch (e: any) {
            setError('Failed to switch network. Please switch manually in your wallet.');
        }
    };

    const isOnSepolia = currentChainId === 11155111;

    const { data, error: fetchError, mutate } = useSWR(
        authenticated && user?.wallet?.address ? `/api/apps/${id}` : null,
        async (url) => {
            const res = await fetch(url, {
                headers: { 'x-wallet-address': user?.wallet?.address || '' }
            });
            return res.json();
        }
    );

    const { data: txData, mutate: mutateTx } = useSWR(
        authenticated && user?.wallet?.address ? `/api/apps/${id}/transactions` : null,
        async (url) => {
            const res = await fetch(url, {
                headers: { 'x-wallet-address': user?.wallet?.address || '' }
            });
            return res.json();
        }
    );

    const app = data?.app;
    const transactions: any[] = txData?.transactions || [];

    const fetchBalance = async () => {
        if (!app?.escrow_contract) return;
        try {
            const provider = new ethers.JsonRpcProvider('https://1rpc.io/sepolia');
            const abi = ["function balanceOf(address) view returns (uint256)"];
            const usdc = new ethers.Contract(DEFAULT_STABLECOIN, abi, provider);
            const bal = await usdc.balanceOf(app.escrow_contract);
            setBalance(ethers.formatUnits(bal, 6));
        } catch (e) {
            console.error('Failed to fetch balance:', e);
        }
    };

    const fetchLogs = async () => {
        if (!app?.escrow_contract) return;
        setRefreshingLogs(true);
        try {
            const provider = new ethers.JsonRpcProvider('https://1rpc.io/sepolia');
            const contract = new ethers.Contract(app.escrow_contract, PolarisMerchantEscrow.abi, provider);

            const filter = contract.filters.PaymentSettled();
            const events = await contract.queryFilter(filter, -10000); // Last 10k blocks

            const formatted = events.map((e: any) => ({
                payer: e.args[0],
                amount: ethers.formatUnits(e.args[1], 18),
                orderId: e.args[2],
                details: e.args[3],
                timestamp: new Date(Number(e.args[4]) * 1000).toLocaleString()
            }));

            setLogs(formatted.reverse());
        } catch (e) {
            console.error('Failed to fetch logs:', e);
        } finally {
            setRefreshingLogs(false);
        }
    };

    useEffect(() => {
        if (app?.escrow_contract) {
            fetchLogs();
            fetchBalance();
            const int = setInterval(() => {
                fetchLogs();
                fetchBalance();
            }, 10000);
            return () => clearInterval(int);
        }
    }, [app?.escrow_contract]);

    const fetchRouterBalance = async () => {
        if (!user?.wallet?.address) return;
        try {
            // Use direct Sepolia RPC — no wallet provider needed for reads
            const provider = new ethers.JsonRpcProvider('https://1rpc.io/sepolia');
            const router = new ethers.Contract(CONTRACTS.MASTER.MERCHANT_ROUTER, MERCHANT_ROUTER_ABI, provider);

            let totalBal = BigInt(0);

            // Check balance on merchant's Privy wallet
            try {
                const walletBal = await router.merchantBalances(user.wallet.address, DEFAULT_STABLECOIN);
                totalBal += walletBal;
            } catch {}

            // Check balance on escrow contract address
            if (app?.escrow_contract && app.escrow_contract !== '0x0000000000000000000000000000000000000000') {
                try {
                    const escrowBal = await router.merchantBalances(app.escrow_contract, DEFAULT_STABLECOIN);
                    totalBal += escrowBal;
                } catch {}
            }

            // Also check the wallet_address stored on the app record
            if (app?.wallet_address && app.wallet_address.toLowerCase() !== (user.wallet.address || '').toLowerCase()) {
                try {
                    const appWalletBal = await router.merchantBalances(app.wallet_address, DEFAULT_STABLECOIN);
                    totalBal += appWalletBal;
                } catch {}
            }

            setRouterBalance(ethers.formatUnits(totalBal, 6));
        } catch (e) {
            console.error('Failed to fetch router balance:', e);
        }
    };

    useEffect(() => {
        if (user?.wallet?.address && app) {
            fetchRouterBalance();
            const int = setInterval(fetchRouterBalance, 15000);
            return () => clearInterval(int);
        }
    }, [user?.wallet?.address, app]);

    const handleRouterWithdraw = async () => {
        if (!wallet) return;
        setRouterWithdrawing(true);
        setError('');
        try {
            const externalProvider = await wallet.getEthereumProvider();
            const provider = new ethers.BrowserProvider(externalProvider);
            const signer = await provider.getSigner();
            const router = new ethers.Contract(CONTRACTS.MASTER.MERCHANT_ROUTER, MERCHANT_ROUTER_ABI, signer);

            const signerAddress = await signer.getAddress();
            
            // 1. Check signer balance
            const signerBal = await router.merchantBalances(signerAddress, DEFAULT_STABLECOIN);
            
            // 2. Check escrow balance
            let escrowBal = BigInt(0);
            if (app?.escrow_contract) {
                escrowBal = await router.merchantBalances(app.escrow_contract, DEFAULT_STABLECOIN);
            }

            if (signerBal === BigInt(0) && escrowBal === BigInt(0)) {
                setError('No funds available for withdrawal in MerchantRouter');
                return;
            }

            setStatusText('Initiating withdrawal sequence...');

            // Withdraw from Signer if balance exists
            if (signerBal > BigInt(0)) {
                console.log('Withdrawing from Signer address...');
                const tx = await router.merchantWithdraw(DEFAULT_STABLECOIN, signerBal, 11155111);
                await tx.wait();
                console.log('Signer withdrawal complete');
            }

            // Withdraw from Escrow if balance exists
            if (escrowBal > BigInt(0) && app?.escrow_contract) {
                // Escrow balance is credited on-chain to the escrow contract address.
                // It can only be withdrawn by the escrow contract itself.
                // For now, show it as available but note it requires escrow support.
                console.log('Escrow has', ethers.formatUnits(escrowBal, 6), 'USDC on MerchantRouter (auto-settled)');
                setStatusText('Escrow funds settled on-chain (' + ethers.formatUnits(escrowBal, 6) + ' USDC)');
            }

            fetchRouterBalance();
            setStatusText('Withdrawal successful!');
            setTimeout(() => setStatusText(''), 3000);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Router withdrawal failed');
        } finally {
            setRouterWithdrawing(false);
        }
    };

    const handleWithdraw = async () => {
        if (!wallet || !app?.escrow_contract) return;
        setWithdrawing(true);
        setError('');
        try {
            const externalProvider = await wallet.getEthereumProvider();
            const provider = new ethers.BrowserProvider(externalProvider);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(app.escrow_contract, PolarisMerchantEscrow.abi, signer);

            const tx = await contract.withdraw();
            setStatusText('Withdrawing funds...');
            await tx.wait();

            fetchBalance();
            setStatusText('Withdrawal successful!');
            setTimeout(() => setStatusText(''), 3000);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Withdrawal failed');
        } finally {
            setWithdrawing(false);
        }
    };

    const handleDeployEscrow = async () => {
        if (!wallet) return;
        setDeploying(true);
        setStatusText('Switching to Sepolia...');
        setError('');

        try {
            // Force switch to Sepolia before deploying
            await wallet.switchChain(11155111);

            const externalProvider = await wallet.getEthereumProvider();
            const provider = new ethers.BrowserProvider(externalProvider);
            const signer = await provider.getSigner();

            // Verify we're on Sepolia
            const network = await provider.getNetwork();
            if (Number(network.chainId) !== 11155111) {
                throw new Error('Please switch to Sepolia network in your wallet');
            }

            setStatusText('Deploying Escrow Contract on Sepolia...');
            const factory = new ethers.ContractFactory(
                PolarisMerchantEscrow.abi,
                PolarisMerchantEscrow.bytecode,
                signer
            );

            const contract = await factory.deploy(DEFAULT_STABLECOIN);
            setStatusText(`Waiting for confirmation...`);
            await contract.waitForDeployment();
            const address = await contract.getAddress();

            setStatusText('Saving to database...');
            const res = await fetch(`/api/apps/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-wallet-address': user?.wallet?.address || ''
                },
                body: JSON.stringify({ escrow_contract: address })
            });

            if (!res.ok) throw new Error('Failed to update app record');

            mutate();
            setStatusText('Success!');
            setTimeout(() => setStatusText(''), 3000);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Deployment failed');
        } finally {
            setDeploying(false);
        }
    };

    const handleCopy = (text: string) => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(text);
        setStatusText('Copied to clipboard!');
        setTimeout(() => setStatusText(''), 2000);
    };

    if (!authenticated) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-display grid-bg">
                <div className="text-center relative z-10">
                    <Zap className="w-12 h-12 text-primary mx-auto mb-6 animate-pulse neon-glow" />
                    <h2 className="text-xl font-bold mb-4 uppercase tracking-tighter">Session Required</h2>
                    <button
                        onClick={login}
                        className="bg-primary text-black px-10 py-4 rounded-xl font-black uppercase text-sm tracking-widest hover:scale-105 transition-all shadow-[0_8px_30px_rgba(166,242,74,0.3)]"
                    >
                        Connect Terminal
                    </button>
                </div>
            </div>
        );
    }

    if (fetchError) return <div className="p-8 text-red-500 font-mono">Error loading app. Please check your connection.</div>;
    if (!app) return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
            <div className="flex items-center gap-3 text-white/40">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm uppercase tracking-widest font-bold">Initialising Configuration...</span>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-background text-foreground font-display p-8 selection:bg-primary/20 selection:text-white grid-bg">
            <div className="max-w-4xl mx-auto mb-8 flex items-center justify-between">
                <button
                    onClick={() => router.push('/dashboard')}
                    className="flex items-center gap-2 text-white/40 hover:text-white text-sm group transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" /> Dashboard
                </button>
                {statusText && (
                    <div className="bg-primary text-black px-4 py-1.5 rounded-full font-black text-[10px] uppercase tracking-wider animate-in fade-in slide-in-from-top-2 shadow-[0_0_15px_rgba(166,242,74,0.4)]">
                        {statusText}
                    </div>
                )}
            </div>

            <header className="max-w-4xl mx-auto mb-12">
                <div className="flex items-end justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <Zap className="w-7 h-7 text-primary neon-glow" />
                            <h1 className="text-3xl font-black uppercase italic tracking-tighter">{app.name}</h1>
                            <div className="ml-4 px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] text-white/40 font-bold uppercase tracking-widest flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(166,242,74,0.5)]" />
                                Linked: {user?.wallet?.address.slice(0, 6)}...{user?.wallet?.address.slice(-4)}
                            </div>
                        </div>
                        <p className="text-white/40 text-xs uppercase tracking-widest font-medium">{app.category || 'General Application'}</p>
                    </div>
                    <div className="text-right">
                        <span className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full border ${app.escrow_contract ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-yellow-500/30 text-yellow-500 bg-yellow-500/10'}`}>
                            {app.escrow_contract ? 'Environment: Live' : 'Status: Configuration Required'}
                        </span>
                    </div>
                </div>
            </header>

            {/* Sepolia Network Banner */}
            {currentChainId !== null && !isOnSepolia && (
                <div className="max-w-4xl mx-auto mb-6">
                    <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-3">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-red-400" />
                            <div>
                                <p className="text-sm font-bold text-red-400">Wrong Network</p>
                                <p className="text-[10px] text-red-400/60">You are on chain {currentChainId}. Polaris requires Sepolia (11155111).</p>
                            </div>
                        </div>
                        <button
                            onClick={switchToSepolia}
                            className="bg-primary text-black px-5 py-2 rounded-lg font-black text-[10px] uppercase tracking-tighter hover:scale-105 transition-all shadow-md shadow-primary/20"
                        >
                            Switch to Sepolia
                        </button>
                    </div>
                </div>
            )}

            {currentChainId !== null && isOnSepolia && (
                <div className="max-w-4xl mx-auto mb-6">
                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-5 py-2">
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                        <p className="text-[10px] text-green-400 font-bold uppercase tracking-wider">Connected to Ethereum Sepolia</p>
                    </div>
                </div>
            )}

            <main className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Left Column: API Keys */}
                <div className="md:col-span-2 space-y-8">
                    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-6">
                            <ShieldCheck className="w-5 h-5 text-primary" />
                            <h2 className="text-lg font-bold">API Configuration</h2>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="text-[10px] uppercase text-white/40 font-bold block mb-2">Client ID</label>
                                <div className="flex items-center gap-2 bg-black/40 border border-white/5 rounded px-4 py-3 group">
                                    <code className="text-sm text-white/80 flex-1 truncate">{app.client_id}</code>
                                    <Copy
                                        onClick={() => handleCopy(app.client_id)}
                                        className="w-4 h-4 text-white/20 hover:text-white cursor-pointer transition-colors"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase text-white/40 font-bold block mb-2">Client Secret</label>
                                <div className="flex items-center gap-2 bg-black/40 border border-white/5 rounded px-4 py-3 group">
                                    <code className="text-sm text-white/80 flex-1 blur-sm hover:blur-none transition-all duration-300">
                                        {app.client_secret}
                                    </code>
                                    <Copy
                                        onClick={() => handleCopy(app.client_secret)}
                                        className="w-4 h-4 text-white/20 hover:text-white cursor-pointer transition-colors"
                                    />
                                </div>
                                <p className="text-[10px] text-white/20 mt-2 italic">* Secret is encrypted. Hover to reveal.</p>
                            </div>
                        </div>
                    </section>

                    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-6">
                            <Code2 className="w-5 h-5 text-primary" />
                            <h2 className="text-lg font-bold">Quick Integration</h2>
                        </div>

                        <div className="bg-black/60 rounded-xl overflow-hidden border border-white/5">
                            <div className="bg-white/5 px-4 py-2 border-b border-white/5 flex items-center justify-between">
                                <span className="text-[10px] text-white/40 uppercase font-bold">Javascript SDK</span>
                                <div className="flex gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-red-500/20" />
                                    <div className="w-2 h-2 rounded-full bg-yellow-500/20" />
                                    <div className="w-2 h-2 rounded-full bg-green-500/20" />
                                </div>
                            </div>
                            <pre className="p-6 text-xs text-teal-100/70 overflow-x-auto leading-relaxed">
                                {`// 1. Create a Bill via API
const res = await fetch('https://polaris.link/api/bills/create', {
  method: 'POST',
  headers: {
    'x-client-id': '${app.client_id}',
    'x-client-secret': '${app.client_secret}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    amount: 125.50,
    description: 'Order #1024'
  })
});

const { checkoutUrl } = await res.json();

// 2. Redirect user to authorization
window.location.href = checkoutUrl;`}
                            </pre>
                        </div>
                    </section>

                    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <Terminal className="w-5 h-5 text-primary" />
                                <h2 className="text-lg font-bold">Transaction Stream</h2>
                            </div>
                            {app.escrow_contract && (
                                <button
                                    onClick={fetchLogs}
                                    className={`p-2 hover:bg-white/5 rounded-lg transition-colors ${refreshingLogs ? 'animate-spin' : ''}`}
                                >
                                    <RefreshCw className="w-4 h-4 text-white/30" />
                                </button>
                            )}
                        </div>

                        {!app.escrow_contract ? (
                            <div className="bg-black/20 border border-dashed border-white/10 rounded-xl p-12 text-center">
                                <p className="text-xs text-white/20 uppercase tracking-widest">Connect escrow to view stream</p>
                            </div>
                        ) : logs.length === 0 ? (
                            <div className="bg-black/20 border border-dashed border-white/10 rounded-xl p-12 text-center">
                                <Loader2 className="w-6 h-6 text-white/20 animate-spin mx-auto mb-4" />
                                <p className="text-xs text-white/20 uppercase tracking-widest">Awaiting first settlement...</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {logs.map((log, i) => (
                                    <div key={i} className="bg-black/40 border border-white/5 p-4 rounded-xl flex items-center justify-between gap-4 group hover:border-teal-500/30 transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold text-teal-400">SETTLED</span>
                                                <span className="text-[10px] text-white/30 font-mono">#{log.orderId}</span>
                                            </div>
                                            <div className="text-[10px] text-white/60 truncate">
                                                From: {log.payer.slice(0, 10)}...{log.payer.slice(-8)}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-sm font-bold text-white">+{log.amount} USDC</div>
                                            <div className="text-[9px] text-white/20">{log.timestamp}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <WebhookManager appId={id as string} />

                    {/* Bill Transactions Section */}
                    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <Receipt className="w-5 h-5 text-primary" />
                                <h2 className="text-lg font-bold">Bill Transactions</h2>
                            </div>
                            <button
                                onClick={() => mutateTx()}
                                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                            >
                                <RefreshCw className="w-4 h-4 text-white/30" />
                            </button>
                        </div>

                        {transactions.length === 0 ? (
                            <div className="bg-black/20 border border-dashed border-white/10 rounded-xl p-12 text-center">
                                <p className="text-xs text-white/20 uppercase tracking-widest">No bill transactions yet</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-white/10">
                                            <th className="text-[10px] uppercase text-white/40 font-bold pb-3 pr-4">Amount</th>
                                            <th className="text-[10px] uppercase text-white/40 font-bold pb-3 pr-4">Asset</th>
                                            <th className="text-[10px] uppercase text-white/40 font-bold pb-3 pr-4">Status</th>
                                            <th className="text-[10px] uppercase text-white/40 font-bold pb-3 pr-4">Payment Mode</th>
                                            <th className="text-[10px] uppercase text-white/40 font-bold pb-3">Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map((tx: any) => (
                                            <tr key={tx._id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                                <td className="py-3 pr-4 text-sm font-bold text-white">{tx.amount} {tx.asset}</td>
                                                <td className="py-3 pr-4 text-xs text-white/60">{tx.asset}</td>
                                                <td className="py-3 pr-4">
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                                        tx.status === 'paid'
                                                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                                            : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                                                    }`}>
                                                        {tx.status}
                                                    </span>
                                                </td>
                                                <td className="py-3 pr-4 text-xs text-white/60">{tx.payment_mode || '—'}</td>
                                                <td className="py-3 text-xs text-white/40">
                                                    {tx.paid_at
                                                        ? new Date(tx.paid_at).toLocaleDateString()
                                                        : new Date(tx.created_at).toLocaleDateString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>

                {/* Right Column: Escrow Deployment */}
                <div className="space-y-8">
                    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 blur-3xl -mr-12 -mt-12" />

                        <div className="flex items-center gap-2 mb-4">
                            <Cpu className="w-5 h-5 text-primary" />
                            <h2 className="text-lg font-bold">On-chain Escrow</h2>
                        </div>

                        {app.escrow_contract ? (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400">
                                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                                    <span className="text-xs font-bold uppercase">Contract Deployed</span>
                                </div>
                                <div className="bg-black/40 border border-white/5 rounded p-3">
                                    <label className="text-[9px] uppercase text-white/30 block mb-1">Contract Address</label>
                                    <div className="flex items-center justify-between gap-1">
                                        <code className="text-[10px] text-white/60 truncate">{app.escrow_contract}</code>
                                        <a href={`https://sepolia.etherscan.io/address/${app.escrow_contract}`} target="_blank" className="text-primary hover:text-white">
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>
                                </div>
                                <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex items-center justify-between">
                                    <div>
                                        <div className="text-[9px] uppercase font-bold text-primary/50 mb-1">Escrow Balance</div>
                                        <div className="text-xl font-bold text-white">{balance} USDC</div>
                                    </div>
                                    <button
                                        disabled={withdrawing || parseFloat(balance) === 0}
                                        onClick={handleWithdraw}
                                        className="bg-primary text-black px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-tighter hover:scale-105 disabled:opacity-30 transition-all flex items-center gap-2 shadow-md shadow-primary/10"
                                    >
                                        {withdrawing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Withdraw'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-white/30 leading-relaxed italic">
                                    Your escrow is active on Ethereum Sepolia. Payments will be routed here.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-xs text-white/50 leading-relaxed">
                                    To receive payments, you must deploy a dedicated <span className="text-white">MerchantEscrow</span> contract.
                                    This ensures your funds are segregated and secure.
                                </p>

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] p-3 rounded flex items-start gap-2">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={handleDeployEscrow}
                                    disabled={deploying}
                                    className="w-full bg-primary hover:scale-[1.02] disabled:bg-white/10 disabled:text-white/20 text-black font-black uppercase tracking-tighter py-3 rounded-xl transition-all flex items-center justify-center gap-3 active:scale-[0.98] shadow-lg shadow-primary/20"
                                >
                                    {deploying ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {statusText || 'Processing...'}
                                        </>
                                    ) : (
                                        'Deploy Escrow'
                                    )}
                                </button>
                                <p className="text-[9px] text-white/20 text-center uppercase tracking-widest font-bold">Gas fee: ~0.005 ETH</p>
                            </div>
                        )}
                    </section>

                    <section className="border border-white/5 rounded-2xl p-6 bg-gradient-to-br from-white/[0.02] to-transparent">
                        <div className="flex items-center gap-2 mb-4 opacity-50">
                            <Terminal className="w-4 h-4" />
                            <h3 className="text-xs font-bold uppercase tracking-widest">Network Info</h3>
                        </div>
                        <div className="space-y-3">
                            <div className="flex justify-between text-[11px]">
                                <span className="text-white/30">Network</span>
                                <span className="text-white/60 font-bold">Ethereum Sepolia</span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                                <span className="text-white/30">Currency</span>
                                <span className="text-white/60 font-bold">USDC (Mock)</span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                                <span className="text-white/30">Chain ID</span>
                                <span className="text-white/60 font-bold">11155111</span>
                            </div>
                        </div>
                    </section>

                    {/* MerchantRouter Withdrawal */}
                    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/10 blur-3xl -mr-12 -mt-12" />

                        <div className="flex items-center gap-2 mb-4">
                            <Wallet className="w-5 h-5 text-primary" />
                            <h2 className="text-lg font-bold">Credit Settlement</h2>
                        </div>

                        <p className="text-[10px] text-white/40 mb-4 leading-relaxed">
                            Funds received via BNPL and Split-in-3 payments through the MerchantRouter contract.
                        </p>

                        <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 mb-3">
                            <div className="text-[9px] uppercase font-bold text-primary/50 mb-1">Total Settled</div>
                            <div className="text-2xl font-bold text-white">{routerBalance} <span className="text-sm text-white/40">USDC</span></div>
                            <p className="text-[9px] text-white/20 mt-2">On-chain balance from BNPL &amp; Split-in-3 credit payments</p>
                        </div>

                        {parseFloat(routerBalance) === 0 && (
                            <p className="text-[10px] text-white/20 italic text-center">No funds available for withdrawal</p>
                        )}
                    </section>
                </div>
            </main>
        </div>
    );
}
