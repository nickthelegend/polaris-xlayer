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
    } catch (error: any) {
        console.error(' [AUTH_SYNC_FATAL]:', error);
        return NextResponse.json({
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }, { status: 500 });
    }
}
