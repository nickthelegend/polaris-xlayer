import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function POST(req: NextRequest) {
    try {
        const { wallet_address, email } = await req.json();

        if (!wallet_address) {
            return NextResponse.json({ error: 'Missing wallet address' }, { status: 400 });
        }

        const db = await getDb();
        
        // Upsert user
        const user = await db.collection('merchant_users').findOneAndUpdate(
            { wallet_address },
            { 
                $set: { 
                    wallet_address,
                    email,
                    updated_at: new Date()
                },
                $setOnInsert: {
                    created_at: new Date()
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return NextResponse.json({ user });
    } catch (error) {
        // This used to return error.message and, in development, error.stack.
        // The driver's message carries the cluster hostname and the stack names
        // our file layout, and neither tells the caller anything they can act
        // on. The detail stays in the server log, where it is useful.
        console.error('[POST /api/auth/sync] upsert failed', error);
        return NextResponse.json(
            { error: 'Could not sign you in right now. This is on our side -- try again in a moment.' },
            { status: 500 }
        );
    }
}
