'use client';

import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { X } from 'lucide-react';

// Mock USDC on Sepolia
const STABLECOIN_ADDRESS = "0x1083D49aAB56502D4f4E24fFf52ce622D9B6eCd0";

interface Props {
    walletAddress: string;
    onClose: () => void;
}

export default function CreateAppModal({ walletAddress, onClose }: Props) {
    const { mutate } = useSWRConfig();
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('idle'); // idle, deploying, saving, done
    const [error, setError] = useState('');

    const handleCreate = async () => {
        if (!name) return;
        setLoading(true);
        setStatus('deploying');
        setError('');

        try {
            // Updated Flow: Just create the DB record first. Deployment can happen later or now.
            // Let's do it simply: Create App in DB -> Users can "Deploy Escrow" from dashboard.
            // This is safer and faster for UX.

            const res = await fetch('/api/apps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet_address: walletAddress,
                    name: name,
                    category: 'General'
                })
            });

            const json = await res.json();
            if (json.error) throw new Error(json.error);

            setStatus('done');
            mutate(`/api/apps?wallet=${walletAddress}`);
            setTimeout(onClose, 500);

        } catch (e: any) {
            console.error(e);
            setError(e.message);
            setStatus('idle');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-[#0A0A0A] border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-white/30 hover:text-white">
                    <X className="w-4 h-4" />
                </button>

                <h3 className="text-lg font-bold mb-4">Create New Application</h3>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs p-3 rounded mb-4">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label className="text-xs uppercase text-white/40 font-bold block mb-2">App Name</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded px-4 py-2 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all font-mono text-sm"
                            placeholder="e.g. My Awesome Store"
                            autoFocus
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-8">
                    <button onClick={onClose} className="text-xs font-bold uppercase hover:text-white text-white/50">Cancel</button>
                    <button
                        onClick={handleCreate}
                        disabled={loading || !name}
                        className="bg-white text-black hover:bg-white/90 px-6 py-2 rounded font-bold text-xs uppercase tracking-wider disabled:opacity-50"
                    >
                        {status === 'deploying' ? 'Creating...' : status === 'done' ? 'Success!' : 'Create App'}
                    </button>
                </div>
            </div>
        </div>
    );
}
