import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

export async function GET() {
    try {
        const wallet = "0xDemoMerchant" + crypto.randomBytes(4).toString('hex');
        const db = await getDb();

        // 1. Create User
        const newUser = {
            wallet_address: wallet,
            created_at: new Date(),
            updated_at: new Date()
        };
        await db.collection('merchant_users').insertOne(newUser);

        // 2. Create App
        const client_id = `prod_${crypto.randomBytes(12).toString('hex')}`;
        const client_secret = `sk_${crypto.randomBytes(24).toString('hex')}`;

        const newApp = {
            user_id: wallet,
            wallet_address: wallet,
            name: 'Polaris Demo Shop',
            category: 'E-commerce',
            client_id,
            client_secret,
            network: 'sepolia',
            status: 'active',
            escrow_contract: '0x0000000000000000000000000000000000000000',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collection('merchant_apps').insertOne(newApp);

        return NextResponse.json({
            wallet,
            app_id: result.insertedId,
            client_id,
            client_secret
        });

    } catch (e: any) {
        console.error('Seed Demo Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
