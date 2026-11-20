// Sends queued WhatsApp messages (new orders' confirmation, shipping events)
// every minute (src/app/api/cron/whatsapp-outbox/route.ts).
export default async () => {
    const res = await fetch(`${process.env.URL}/api/cron/whatsapp-outbox`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`whatsapp-outbox: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
};

export const config = { schedule: "* * * * *" };
