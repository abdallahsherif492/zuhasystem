// The daily courier sync that vercel.json's `crons` ran on Vercel. Netlify
// ignores vercel.json, so this scheduled function calls the same endpoint with
// the scheduler's secret. `URL` is the site's primary address, set by Netlify.
export default async () => {
    const res = await fetch(`${process.env.URL}/api/cron/auto-sync`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    console.log(`auto-sync: ${res.status}`);
};

export const config = { schedule: "0 3 * * *" };
