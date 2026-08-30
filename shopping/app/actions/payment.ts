"use server"

export async function initiatePolarisPayment(amount: number, description: string) {
    const clientId = process.env.POLARIS_CLIENT_ID;
    const clientSecret = process.env.POLARIS_CLIENT_SECRET;
    const apiUrl = process.env.MERCHANT_API_URL || "http://localhost:3001/api/bills/create";

    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': clientId || '',
                'x-client-secret': clientSecret || ''
            },
            body: JSON.stringify({
                amount,
                description,
                metadata: {
                    source: "Syndicate_Equip_Store",
                    order_date: new Date().toISOString()
                }
            })
        });

        const data = await res.json();

        if (data.error) {
            return { error: data.error };
        }

        return { checkoutUrl: data.checkoutUrl };
    } catch (e: any) {
        console.error("Payment initiation failed:", e);
        return { error: "Connection to Polaris Hub failed." };
    }
}
