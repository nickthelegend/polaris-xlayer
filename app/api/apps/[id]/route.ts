import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {

    const { id } = await params;
    const walletAddress = req.headers.get('x-wallet-address');

    if (!id || !walletAddress) return NextResponse.json({ error: 'Missing ID or wallet address' }, { status: 400 });

    const db = await getDb();

    // Verify ownership and get app
    // In our simplified MongoDB schema, we link merchant_apps using user_id: walletAddress
    const app = await db.collection('merchant_apps').findOne({ 
        _id: new ObjectId(id),
        user_id: walletAddress 
    });

    if (!app) {
        return NextResponse.json({ error: 'App not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ app });
  } catch (err) {
    // POLARIS_GUARDED: a throw must never become an empty 500 —
    // clients call res.json() on the reply and die on a blank body.
    console.error("[api] unhandled", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {

    const { id } = await params;
    const walletAddress = req.headers.get('x-wallet-address');
    const body = await req.json();

    if (!id || !walletAddress) return NextResponse.json({ error: 'Missing ID or wallet address' }, { status: 400 });

    const db = await getDb();

    // Update with ownership verification
    const result = await db.collection('merchant_apps').findOneAndUpdate(
        { 
            _id: new ObjectId(id),
            user_id: walletAddress 
        },
        { $set: { ...body, updated_at: new Date() } },
        { returnDocument: 'after' }
    );

    if (!result) {
        return NextResponse.json({ error: 'App not found or update failed' }, { status: 404 });
    }

    return NextResponse.json({ app: result });
  } catch (err) {
    // POLARIS_GUARDED: a throw must never become an empty 500 —
    // clients call res.json() on the reply and die on a blank body.
    console.error("[api] unhandled", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
