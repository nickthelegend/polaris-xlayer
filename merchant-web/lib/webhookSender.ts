import { getDb } from './mongodb';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';

export async function sendWebhook(webhookId: string, event: string, payload: any) {
    const db = await getDb();

    // 1. Get Webhook Details
    const webhook = await db.collection('webhooks').findOne({ _id: new ObjectId(webhookId) });

    if (!webhook || !webhook.is_active) return;

    // 2. Prepare Payload
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
        event,
        created_at: timestamp,
        data: payload
    });

    // 3. Sign Payload (HMAC-SHA256)
    const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

    const headers = {
        'Content-Type': 'application/json',
        'X-Polaris-Signature': `t=${timestamp},v1=${signature}`,
        'User-Agent': 'Polaris-Webhook-Service/1.0'
    };

    let responseStatus = 0;
    let responseBody = '';

    try {
        const res = await fetch(webhook.url, {
            method: 'POST',
            headers,
            body
        });
        responseStatus = res.status;
        responseBody = await res.text();
    } catch (e: any) {
        responseStatus = 500;
        responseBody = e.message;
    }

    // 4. Log the result
    await db.collection('webhook_logs').insertOne({
        webhook_id: new ObjectId(webhookId),
        event,
        payload: JSON.parse(body),
        response_status: responseStatus,
        response_body: responseBody.substring(0, 1000),
        created_at: new Date()
    });

    return { success: responseStatus >= 200 && responseStatus < 300, status: responseStatus };
}
