import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const db = await getDb();
        const webhooks = await db.collection('webhooks').find({ app_id: id }).toArray();
        return NextResponse.json({ webhooks });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();
    const { url, events } = body;

    const secret = `whsec_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

    try {
        const db = await getDb();
        const result = await db.collection('webhooks').insertOne({
            app_id: id,
            url,
            events: events || ['payment.settled'],
            secret,
            is_active: true,
            created_at: new Date(),
        });

        const webhook = await db.collection('webhooks').findOne({ _id: result.insertedId });
        return NextResponse.json({ webhook });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
