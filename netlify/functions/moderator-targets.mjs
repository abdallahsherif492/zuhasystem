// Scores moderators' finished shifts every hour and books any deduction
// (src/app/api/cron/moderator-targets/route.ts). Hourly because shifts end at
// different times and some run past midnight.
export default async () => {
    const res = await fetch(`${process.env.URL}/api/cron/moderator-targets`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`moderator-targets: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500));
};

export const config = { schedule: "5 * * * *" };
