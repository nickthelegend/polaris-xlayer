import { NextRequest, NextResponse } from 'next/server';
import { sendWebhook } from '@/lib/webhookSender';

export async function POST(req: NextRequest) {
  try {

    const { webhookId } = await req.json();

    if (!webhookId) return NextResponse.json({ error: 'Missing webhook ID' }, { status: 400 });

    const result = await sendWebhook(webhookId, 'test.event', {
        message: 'This is a test webhook from Polaris Console',
        id: `test_${Math.random().toString(36).substring(7)}`,
        timestamp: new Date().toISOString()
    });

    return NextResponse.json(result);
  } catch (err) {
    // POLARIS_GUARDED: a throw must never become an empty 500 —
    // clients call res.json() on the reply and die on a blank body.
    console.error("[api] unhandled", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
