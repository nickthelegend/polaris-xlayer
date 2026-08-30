import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {

    const { id } = await params;
    const walletAddress = req.headers.get('x-wallet-address');

    if (!id || !walletAddress) {
        return NextResponse.json({ error: 'Missing app ID or wallet address' }, { status: 400 });
    }

    const db = await getDb();

    // Verify the app belongs to this wallet
    const app = await db.collection('merchant_apps').findOne({
        _id: new ObjectId(id),
        user_id: walletAddress,
    });

    if (!app) {
        return NextResponse.json({ error: 'App not found or unauthorized' }, { status: 404 });
    }

    // Query bills for this app
    const bills = await db
        .collection('merchant_bills')
        .find({ app_id: new ObjectId(id) })
        .sort({ created_at: -1 })
        .toArray();

    const transactions = bills.map((bill) => ({
        _id: bill._id,
        amount: bill.amount,
        asset: bill.asset,
        status: bill.status,
        payment_mode: bill.payment_mode || null,
        loan_id: bill.loan_id || null,
        tx_hash: bill.tx_hash || null,
        created_at: bill.created_at,
        paid_at: bill.paid_at || null,
    }));

    return NextResponse.json({ transactions });
  } catch (err) {
    // POLARIS_GUARDED: a throw must never become an empty 500 —
    // clients call res.json() on the reply and die on a blank body.
    console.error("[api] unhandled", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
