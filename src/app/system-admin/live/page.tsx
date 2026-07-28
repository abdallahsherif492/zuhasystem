"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describePath } from "@/lib/session-tracker";
import {
    Activity, Users, Monitor, Smartphone, Tablet, Globe, Loader2,
    Eye, Store, Pause, Play, Search, RefreshCw, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** A session counts as live while it has checked in within this window. */
const LIVE_WINDOW_MS = 45_000;
const REFRESH_MS = 5_000;

interface LiveSession {
    session_id: string;
    user_email: string | null;
    business_id: string | null;
    business_name: string | null;
    page_path: string;
    page_title: string | null;
    page_entered_at: string;
    page_views: number;
    device_type: string | null;
    browser: string | null;
    os: string | null;
    screen_size: string | null;
    viewport: string | null;
    language: string | null;
    timezone: string | null;
    referrer: string | null;
    entry_page: string | null;
    is_idle: boolean;
    started_at: string;
    last_seen_at: string;
}

const secondsSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));

function humanDuration(totalSeconds: number): string {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

const DeviceIcon = ({ type }: { type: string | null }) => {
    if (type === "mobile") return <Smartphone className="h-3.5 w-3.5" />;
    if (type === "tablet") return <Tablet className="h-3.5 w-3.5" />;
    return <Monitor className="h-3.5 w-3.5" />;
};

export default function LiveAnalyticsPage() {
    const [sessions, setSessions] = useState<LiveSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paused, setPaused] = useState(false);
    const [setupIssue, setSetupIssue] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    // Ticks every second so "time on page" counts up without refetching.
    const [now, setNow] = useState(() => Date.now());

    const fetchSessions = useCallback(async () => {
        const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from("live_sessions")
            .select("*")
            .gte("last_seen_at", since)
            .order("last_seen_at", { ascending: false });

        if (error) {
            setError(
                error.message.includes("live_sessions")
                    ? "The live_sessions table is missing — run supabase/migrations/20260729_live_sessions.sql."
                    : error.message
            );
        } else {
            setError(null);
            setSessions((data || []) as LiveSession[]);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSessions();
        // Opportunistic housekeeping so the table cannot grow unbounded even
        // without a scheduled job. Ignored if the function is not installed.
        supabase.rpc("prune_live_sessions").then(() => {}, () => {});

        // Every visitor reports presence through record_live_session. If that
        // function is missing, the page still renders — it just quietly shows
        // nobody but the admins who could write before it existed. Detect it
        // and say so, rather than looking like "no traffic".
        // Null args make the function return before inserting anything, so
        // this checks existence without leaving a phantom session behind.
        supabase
            .rpc("record_live_session", { p_session_id: null, p_page_path: null })
            .then(({ error }) => {
                if (error && /Could not find the function|PGRST202|does not exist/i.test(error.message)) {
                    setSetupIssue(
                        "record_live_session() is missing from the database, so visitor sessions are not being recorded. " +
                        "Run supabase/migrations/20260729_live_sessions_rpc.sql in the Supabase SQL editor."
                    );
                } else {
                    setSetupIssue(null);
                }
            }, () => {});
    }, [fetchSessions]);

    useEffect(() => {
        if (paused) return;
        const poll = setInterval(fetchSessions, REFRESH_MS);
        return () => clearInterval(poll);
    }, [paused, fetchSessions]);

    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, []);

    // Realtime gives near-instant updates; the poll above remains the safety
    // net in case Realtime is not enabled on the project.
    useEffect(() => {
        if (paused) return;
        const channel = supabase
            .channel("live-sessions-admin")
            .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, () => fetchSessions())
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [paused, fetchSessions]);

    const live = useMemo(
        () => sessions.filter((s) => now - new Date(s.last_seen_at).getTime() < LIVE_WINDOW_MS),
        [sessions, now]
    );

    const active = useMemo(() => live.filter((s) => !s.is_idle), [live]);

    const byPage = useMemo(() => {
        const counts = new Map<string, number>();
        live.forEach((s) => counts.set(s.page_path, (counts.get(s.page_path) || 0) + 1));
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [live]);

    const byBusiness = useMemo(() => {
        const counts = new Map<string, number>();
        live.forEach((s) => counts.set(s.business_name || "زائر مجهول", (counts.get(s.business_name || "زائر مجهول") || 0) + 1));
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [live]);

    const byDevice = useMemo(() => {
        const counts = new Map<string, number>();
        live.forEach((s) => counts.set(s.device_type || "unknown", (counts.get(s.device_type || "unknown") || 0) + 1));
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [live]);

    const byBrowser = useMemo(() => {
        const counts = new Map<string, number>();
        live.forEach((s) => counts.set(s.browser || "Unknown", (counts.get(s.browser || "Unknown") || 0) + 1));
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [live]);

    const signedIn = useMemo(() => live.filter((s) => s.user_email).length, [live]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return live;
        return live.filter((s) =>
            [s.user_email, s.business_name, s.page_path, s.browser, s.os, s.device_type]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q))
        );
    }, [live, query]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        Live Analytics
                        {!paused && (
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-green-600">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                                </span>
                                LIVE
                            </span>
                        )}
                    </h1>
                    <p className="text-muted-foreground">
                        Who is on the platform right now — refreshed every {REFRESH_MS / 1000}s, plus instant Realtime updates.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchSessions()}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                    </Button>
                    <Button variant={paused ? "default" : "outline"} size="sm" onClick={() => setPaused((p) => !p)}>
                        {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                        {paused ? "Resume" : "Pause"}
                    </Button>
                </div>
            </div>

            {error && (
                <Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
                    <CardContent className="pt-6 text-sm text-red-800 dark:text-red-300">{error}</CardContent>
                </Card>
            )}

            {setupIssue && (
                <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30">
                    <CardContent className="pt-6 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-900 dark:text-amber-200">
                            <p className="font-semibold">Session recording is not installed</p>
                            <p className="mt-1">{setupIssue}</p>
                            <p className="mt-2 text-xs opacity-80">
                                Until then this page can only show sessions written before the switch — it is not
                                measuring real traffic.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Headline numbers */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-green-500/40">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Online Now
                        </CardTitle>
                        <Activity className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold text-green-600">{live.length}</div>
                        <p className="text-xs text-muted-foreground mt-1">{active.length} actively viewing, {live.length - active.length} backgrounded</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Signed In
                        </CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold">{signedIn}</div>
                        <p className="text-xs text-muted-foreground mt-1">{live.length - signedIn} anonymous visitors</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Businesses Active
                        </CardTitle>
                        <Store className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold">
                            {new Set(live.filter((s) => s.business_id).map((s) => s.business_id)).size}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">distinct tenants using the system</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Pages In Use
                        </CardTitle>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold">{byPage.length}</div>
                        <p className="text-xs text-muted-foreground mt-1">distinct routes open right now</p>
                    </CardContent>
                </Card>
            </div>

            {/* Breakdowns */}
            <div className="grid gap-6 lg:grid-cols-2">
                <Breakdown
                    title="Active Pages"
                    description="Where everyone is right now"
                    icon={<Eye className="h-5 w-5 text-primary" />}
                    rows={byPage.map(([path, count]) => ({
                        label: describePath(path),
                        sub: path,
                        count,
                    }))}
                    total={live.length}
                    empty="Nobody is browsing right now."
                />
                <Breakdown
                    title="By Business"
                    description="Which tenants are working"
                    icon={<Store className="h-5 w-5 text-primary" />}
                    rows={byBusiness.map(([name, count]) => ({ label: name, count }))}
                    total={live.length}
                    empty="No active tenants."
                />
                <Breakdown
                    title="Devices"
                    icon={<Monitor className="h-5 w-5 text-primary" />}
                    rows={byDevice.map(([d, count]) => ({ label: d, count }))}
                    total={live.length}
                    empty="No devices."
                />
                <Breakdown
                    title="Browsers"
                    icon={<Globe className="h-5 w-5 text-primary" />}
                    rows={byBrowser.map(([b, count]) => ({ label: b, count }))}
                    total={live.length}
                    empty="No browsers."
                />
            </div>

            {/* Session detail */}
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <CardTitle>Live Sessions</CardTitle>
                            <CardDescription>Every open tab, with full context. Times update live.</CardDescription>
                        </div>
                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Filter by user, business, page…"
                                className="pl-9"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Visitor</TableHead>
                                    <TableHead>Business</TableHead>
                                    <TableHead>Current Page</TableHead>
                                    <TableHead>On Page</TableHead>
                                    <TableHead>Session</TableHead>
                                    <TableHead>Views</TableHead>
                                    <TableHead>Device</TableHead>
                                    <TableHead>Source</TableHead>
                                    <TableHead className="text-right">Last Ping</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center p-10 text-muted-foreground">
                                            {live.length === 0
                                                ? "No live sessions. Open the app in another tab to see yourself appear here."
                                                : "No sessions match this filter."}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filtered.map((s) => {
                                        const lastPing = secondsSince(s.last_seen_at, now);
                                        return (
                                            <TableRow key={s.session_id} className={cn(s.is_idle && "opacity-60")}>
                                                <TableCell className="font-medium max-w-[200px]">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "h-2 w-2 rounded-full shrink-0",
                                                            s.is_idle ? "bg-amber-400" : "bg-green-500"
                                                        )} />
                                                        <span className="truncate">{s.user_email || "زائر مجهول"}</span>
                                                    </div>
                                                    {s.is_idle && <span className="text-[10px] text-amber-600 ms-4">backgrounded</span>}
                                                </TableCell>
                                                <TableCell className="text-sm">{s.business_name || <span className="text-muted-foreground">—</span>}</TableCell>
                                                <TableCell>
                                                    <div className="text-sm font-medium">{describePath(s.page_path)}</div>
                                                    <div className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">{s.page_path}</div>
                                                </TableCell>
                                                <TableCell className="text-sm tabular-nums">
                                                    {humanDuration(secondsSince(s.page_entered_at, now))}
                                                </TableCell>
                                                <TableCell className="text-sm tabular-nums">
                                                    {humanDuration(secondsSince(s.started_at, now))}
                                                </TableCell>
                                                <TableCell className="text-sm tabular-nums">{s.page_views}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1.5 text-xs">
                                                        <DeviceIcon type={s.device_type} />
                                                        <span>{s.browser} · {s.os}</span>
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                                        {s.viewport} · {s.timezone}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-xs max-w-[160px] truncate">
                                                    {s.referrer
                                                        ? <span title={s.referrer}>{safeHost(s.referrer)}</span>
                                                        : <span className="text-muted-foreground">Direct</span>}
                                                    <div className="text-[10px] text-muted-foreground font-mono truncate">{s.entry_page}</div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Badge variant={lastPing < 20 ? "secondary" : "outline"} className="tabular-nums">
                                                        {lastPing}s ago
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function Breakdown({
    title, description, icon, rows, total, empty,
}: {
    title: string;
    description?: string;
    icon: React.ReactNode;
    rows: { label: string; sub?: string; count: number }[];
    total: number;
    empty: string;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">{icon}{title}</CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-3">
                {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">{empty}</p>
                ) : (
                    rows.slice(0, 8).map((row) => {
                        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                        return (
                            <div key={row.label + (row.sub || "")} className="space-y-1">
                                <div className="flex items-center justify-between text-sm gap-3">
                                    <span className="font-medium truncate">{row.label}</span>
                                    <span className="text-muted-foreground tabular-nums shrink-0">
                                        {row.count} · {pct}%
                                    </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                    <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                                </div>
                                {row.sub && <p className="text-[10px] text-muted-foreground font-mono truncate">{row.sub}</p>}
                            </div>
                        );
                    })
                )}
                {rows.length > 8 && (
                    <p className="text-xs text-muted-foreground pt-1">+{rows.length - 8} more</p>
                )}
            </CardContent>
        </Card>
    );
}
