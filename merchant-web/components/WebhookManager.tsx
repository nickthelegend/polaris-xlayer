'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
    Globe,
    Plus,
    Trash2,
    Eye,
    EyeOff,
    CheckCircle2,
    AlertCircle,
    Loader2,
    X,
    Zap,
    Play
} from 'lucide-react';

interface Webhook {
    id: string;
    url: string;
    secret: string;
    events: string[];
    is_active: boolean;
}

interface Props {
    appId: string;
}

export default function WebhookManager({ appId }: Props) {
    const { mutate: globalMutate } = useSWRConfig();
    const { data, error, mutate } = useSWR(`/api/apps/${appId}/webhooks`, (url) => fetch(url).then(res => res.json()));
    const [isAdding, setIsAdding] = useState(false);
    const [newUrl, setNewUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState<string | null>(null);
    const [showSecret, setShowSecret] = useState<string | null>(null);

    const webhooks: Webhook[] = data?.webhooks || [];

    const handleAdd = async () => {
        if (!newUrl) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/apps/${appId}/webhooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: newUrl, events: ['payment.settled'] })
            });
            if (res.ok) {
                mutate();
                setNewUrl('');
                setIsAdding(false);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleTest = async (webhookId: string) => {
        setTesting(webhookId);
        try {
            const res = await fetch('/api/webhooks/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ webhookId })
            });
            const result = await res.json();
            if (result.success) {
                alert('Test webhook sent successfully!');
            } else {
                alert(`Failed to send test: ${result.status}`);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setTesting(null);
        }
    };

    return (
        <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold">Webhooks</h2>
                </div>
                {!isAdding && (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="text-[10px] font-bold uppercase tracking-widest text-primary hover:text-white flex items-center gap-1 transition-all"
                    >
                        <Plus className="w-3 h-3" /> Add Endpoint
                    </button>
                )}
            </div>

            {isAdding && (
                <div className="bg-black/40 border border-primary/20 rounded-xl p-4 mb-6 space-y-4 animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">New Webhook Endpoint</span>
                        <button onClick={() => setIsAdding(false)}><X className="w-4 h-4 text-white/20 hover:text-white" /></button>
                    </div>
                    <div>
                        <input
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            placeholder="https://your-api.com/webhooks/polaris"
                            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary transition-colors"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            disabled={loading}
                            onClick={handleAdd}
                            className="bg-primary text-black px-4 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-tighter hover:scale-105 transition-all flex items-center gap-2"
                        >
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create Endpoint'}
                        </button>
                    </div>
                </div>
            )}

            {webhooks.length === 0 ? (
                <div className="bg-black/20 border border-dashed border-white/10 rounded-xl p-8 text-center">
                    <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold">No webhooks configured</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {webhooks.map((wh) => (
                        <div key={wh.id} className="bg-black/40 border border-white/5 p-4 rounded-xl flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 rounded-full ${wh.is_active ? 'bg-green-500' : 'bg-white/20'}`} />
                                        <code className="text-xs text-white/80 truncate font-mono">{wh.url}</code>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleTest(wh.id)}
                                        disabled={!!testing}
                                        className="text-white/20 hover:text-primary transition-colors"
                                        title="Send Test Event"
                                    >
                                        {testing === wh.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> : <Play className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                        onClick={() => setShowSecret(showSecret === wh.id ? null : wh.id)}
                                        className="text-white/20 hover:text-white"
                                    >
                                        {showSecret === wh.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    </button>
                                    <button className="text-white/20 hover:text-red-500 transition-colors">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>

                            {showSecret === wh.id && (
                                <div className="bg-primary/5 border border-primary/10 rounded p-2 flex items-center justify-between">
                                    <code className="text-[10px] text-primary font-mono select-all">
                                        {wh.secret}
                                    </code>
                                    <span className="text-[8px] uppercase font-bold text-primary/50">HMAC Secret</span>
                                </div>
                            )}

                            <div className="flex gap-1.5 flex-wrap">
                                {wh.events.map(ev => (
                                    <span key={ev} className="text-[8px] uppercase font-bold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/40">
                                        {ev}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
