import { accountOf, graph, memberOf } from "@/lib/whatsapp/server";

/**
 * A photo, voice note or file a customer sent, fetched from Meta with the
 * business's token and handed to the conversations page. Members only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const businessId = new URL(request.url).searchParams.get("business_id") || "";
    const who = await memberOf(businessId);
    if ("error" in who) return new Response(who.error, { status: who.status });
    const account = await accountOf(businessId);
    if (!account || !/^\d+$/.test(id)) return new Response("not found", { status: 404 });

    const meta = await graph(id, account.token);
    const url = meta.body?.url as string | undefined;
    if (!meta.ok || !url) return new Response("not found", { status: 404 });
    const file = await fetch(url, { headers: { Authorization: `Bearer ${account.token}` }, signal: AbortSignal.timeout(20000) });
    if (!file.ok) return new Response("not found", { status: 404 });
    return new Response(file.body, {
        headers: {
            "Content-Type": meta.body?.mime_type || file.headers.get("content-type") || "application/octet-stream",
            "Cache-Control": "private, max-age=86400",
        },
    });
}
