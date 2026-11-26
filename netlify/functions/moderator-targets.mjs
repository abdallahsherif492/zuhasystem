// Scores moderators' finished shifts every three hours and books any deduction
// (src/app/api/cron/moderator-targets/route.ts). Every three hours: each run reads
// days of orders and messages, and a shift is final half an hour after its day anyway.
export default async () => {
    const res = await fetch(`${process.env.URL}/api/cron/moderator-targets`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`moderator-targets: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500));
};

export const config = { schedule: "5 */3 * * *" };
