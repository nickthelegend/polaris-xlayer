import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

/**
 * Demo seeding. Gated behind an explicit flag.
 *
 * This was an unauthenticated GET that minted a merchant app with a real
 * client_secret. Anyone who hit the URL got working credentials.
 */
export async function GET() {
    if (process.env.ALLOW_DEMO_SEED !== "true") {
    return NextResponse.json(
      { error: "Demo seeding is disabled. Set ALLOW_DEMO_SEED=true to enable it." },
      { status: 403 }
    );
  }

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

    } catch (e) {
        // The driver's message names the cluster host and the failing
        // collection. That belongs in the log, not in a response body.
        console.error('[POST /api/seed-demo] seed failed', e);
        return NextResponse.json(
            { error: 'Could not seed the demo merchant. This is on our side -- try again in a moment.' },
            { status: 500 }
        );
    }
}
