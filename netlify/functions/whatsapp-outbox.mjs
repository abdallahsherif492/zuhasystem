// The hourly safety net for queued WhatsApp messages
// (src/app/api/cron/whatsapp-outbox/route.ts). Messages normally go out the
// moment they are queued: the database calls the route itself (20261126).
export default async () => {
    const res = await fetch(`${process.env.URL}/api/cron/whatsapp-outbox`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`whatsapp-outbox: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
};

export const config = { schedule: "@hourly" };
