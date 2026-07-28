"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Settings, ShieldAlert, Megaphone, Activity, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { TESTABLE_EVENTS, sendTestPixelEvents, disableMetaPixel } from "@/lib/meta-pixel";

import { logAuditAction } from "@/lib/audit";

export default function PlatformSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Settings State
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [maintenanceMessage, setMaintenanceMessage] = useState("");
    
    const [announcementActive, setAnnouncementActive] = useState(false);
    const [announcementMessage, setAnnouncementMessage] = useState("");
    const [announcementType, setAnnouncementType] = useState("info");
    
    const [defaultTrialDays, setDefaultTrialDays] = useState(30);

    const [metaPixelEnabled, setMetaPixelEnabled] = useState(false);
    const [metaPixelId, setMetaPixelId] = useState("");
    const [testEvents, setTestEvents] = useState<string[]>([...TESTABLE_EVENTS]);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    const toggleTestEvent = (event: string) => {
        setTestResult(null);
        setTestEvents(prev =>
            prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
        );
    };

    const handleSendTestEvents = () => {
        const result = sendTestPixelEvents(metaPixelId, testEvents);
        setTestResult(
            result.success
                ? { ok: true, message: `Sent ${result.sent.length} test event(s): ${result.sent.join(", ")}. Open Events Manager > Test Events to confirm.` }
                : { ok: false, message: result.error || "Failed to send test events." }
        );
    };

    // The pixel is only meant to run on the public marketing pages. The test
    // button loads it here on demand, so drop it again when leaving this screen.
    useEffect(() => () => disableMetaPixel(), []);
    const [instapayNumber, setInstapayNumber] = useState("");
    const [instapayName, setInstapayName] = useState("");
    const [ewalletNumber, setEwalletNumber] = useState("");
    const [ewalletName, setEwalletName] = useState("");

    const fetchSettings = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("platform_settings")
            .select("*")
            .eq("id", "global")
            .single();

        if (!error && data) {
            setMaintenanceMode(data.maintenance_mode);
            setMaintenanceMessage(data.maintenance_message);
            setAnnouncementActive(data.announcement_active);
            setAnnouncementMessage(data.announcement_message);
            setAnnouncementType(data.announcement_type);
            setDefaultTrialDays(data.default_trial_days || 30);
            setMetaPixelEnabled(data.meta_pixel_enabled || false);
            setMetaPixelId(data.meta_pixel_id || "");
            setInstapayNumber(data.instapay_number || "");
            setInstapayName(data.instapay_name || "");
            setEwalletNumber(data.ewallet_number || "");
            setEwalletName(data.ewallet_name || "");
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        const { error } = await supabase
            .from("platform_settings")
            .update({
                maintenance_mode: maintenanceMode,
                maintenance_message: maintenanceMessage,
                announcement_active: announcementActive,
                announcement_message: announcementMessage,
                announcement_type: announcementType,
                default_trial_days: defaultTrialDays,
                instapay_number: instapayNumber,
                instapay_name: instapayName,
                ewallet_number: ewalletNumber,
                ewallet_name: ewalletName,
                meta_pixel_enabled: metaPixelEnabled,
                meta_pixel_id: metaPixelId.trim()
            })
            .eq("id", "global");

        setSaving(false);
        if (error) {
            console.error("Error saving settings:", error);
            alert("Failed to save settings: " + error.message);
        } else {
            await logAuditAction("SETTINGS_UPDATED", "Platform", "global", {
                maintenance_mode: maintenanceMode,
                announcement_active: announcementActive,
                default_trial_days: defaultTrialDays,
                meta_pixel_enabled: metaPixelEnabled
            });
            alert("Settings saved successfully!");
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
                <p className="text-muted-foreground">Manage global configurations, maintenance modes, and announcements.</p>
            </div>

            <div className="grid gap-6">
                {/* General Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5 text-primary" />
                            General Configurations
                        </CardTitle>
                        <CardDescription>Default values for new tenants and global platform variables.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2 max-w-sm">
                            <Label htmlFor="trialDays">Default Free Trial Days</Label>
                            <Input 
                                id="trialDays" 
                                type="number" 
                                value={defaultTrialDays} 
                                onChange={e => setDefaultTrialDays(parseInt(e.target.value))} 
                            />
                            <p className="text-xs text-muted-foreground">Number of days a newly registered business gets for free.</p>
                        </div>
                        
                        <div className="border-t pt-4">
                            <h4 className="font-semibold mb-4">InstaPay Payment Details</h4>
                            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
                                <div className="space-y-2">
                                    <Label htmlFor="instapayNumber">InstaPay Number / Address</Label>
                                    <Input 
                                        id="instapayNumber" 
                                        value={instapayNumber} 
                                        onChange={e => setInstapayNumber(e.target.value)} 
                                        placeholder="01xxxxxxxxx"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="instapayName">InstaPay Account Name</Label>
                                    <Input 
                                        id="instapayName" 
                                        value={instapayName} 
                                        onChange={e => setInstapayName(e.target.value)} 
                                        placeholder="e.g. Abdallah Sherif"
                                    />
                                </div>
                            </div>
                            
                            <h4 className="font-semibold mb-4 mt-6">E-Wallet Payment Details</h4>
                            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
                                <div className="space-y-2">
                                    <Label htmlFor="ewalletNumber">Wallet Number</Label>
                                    <Input 
                                        id="ewalletNumber" 
                                        value={ewalletNumber} 
                                        onChange={e => setEwalletNumber(e.target.value)} 
                                        placeholder="01xxxxxxxxx"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ewalletName">Wallet Account Name</Label>
                                    <Input 
                                        id="ewalletName" 
                                        value={ewalletName} 
                                        onChange={e => setEwalletName(e.target.value)} 
                                        placeholder="e.g. Abdallah Sherif"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">These details will be shown to clients when they want to pay for their subscription.</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Meta Pixel */}
                <Card className={metaPixelEnabled ? "border-blue-500 shadow-sm" : ""}>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-blue-600">
                                    <Activity className="h-5 w-5" />
                                    Meta Pixel
                                </CardTitle>
                                <CardDescription>
                                    Track marketing events (page views, CTA clicks, sign-ups) on the landing and register pages.
                                </CardDescription>
                            </div>
                            <Switch
                                checked={metaPixelEnabled}
                                onCheckedChange={setMetaPixelEnabled}
                            />
                        </div>
                    </CardHeader>
                    {metaPixelEnabled && (
                        <CardContent className="space-y-4">
                            <div className="space-y-2 max-w-sm">
                                <Label htmlFor="metaPixelId">Pixel ID</Label>
                                <Input
                                    id="metaPixelId"
                                    value={metaPixelId}
                                    onChange={e => setMetaPixelId(e.target.value)}
                                    placeholder="e.g. 1234567890123456"
                                    inputMode="numeric"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Found in Meta Events Manager under Data Sources. The pixel stays off until an ID is saved here.
                                </p>
                            </div>

                            <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-2">
                                <p className="font-semibold">Events being sent</p>
                                <ul className="text-muted-foreground space-y-1 text-xs">
                                    <li><span className="font-mono font-medium">PageView</span> — landing, register and login pages</li>
                                    <li><span className="font-mono font-medium">ViewContent</span> — visitor scrolls to the pricing section</li>
                                    <li><span className="font-mono font-medium">Lead</span> — visitor clicks a "start free trial" CTA</li>
                                    <li><span className="font-mono font-medium">CompleteRegistration</span> — visitor finishes signing up</li>
                                </ul>
                                <p className="text-xs text-muted-foreground pt-1">
                                    Dashboard pages are never tracked, so tenant data stays out of Meta.
                                </p>
                            </div>

                            {/* Test Events */}
                            <div className="rounded-md border border-dashed p-4 space-y-4">
                                <div>
                                    <p className="font-semibold text-sm">Send test events</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Fire sample events to check the connection before real traffic arrives.
                                        Uses the Pixel ID typed above, so you can validate a new one before saving.
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {TESTABLE_EVENTS.map(event => {
                                        const selected = testEvents.includes(event);
                                        return (
                                            <button
                                                key={event}
                                                type="button"
                                                onClick={() => toggleTestEvent(event)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-mono border transition-colors ${
                                                    selected
                                                        ? "bg-blue-600 text-white border-blue-600"
                                                        : "bg-background text-muted-foreground border-input hover:bg-muted"
                                                }`}
                                            >
                                                {event}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleSendTestEvents}
                                        disabled={!metaPixelId.trim() || testEvents.length === 0}
                                    >
                                        <Send className="mr-2 h-4 w-4" />
                                        Send Test Event{testEvents.length > 1 ? "s" : ""}
                                    </Button>
                                    <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                                        These are real pixel events — they are tagged <span className="font-mono">test_event: true</span> but still appear in your pixel data.
                                    </p>
                                </div>

                                {testResult && (
                                    <div className={`flex items-start gap-2 text-xs rounded-md p-3 ${
                                        testResult.ok
                                            ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                                            : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                                    }`}>
                                        {testResult.ok
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                                            : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                                        <span>{testResult.message}</span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    )}
                </Card>

                {/* Maintenance Mode */}
                <Card className={maintenanceMode ? "border-red-500 shadow-sm" : ""}>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-red-600">
                                    <ShieldAlert className="h-5 w-5" />
                                    Maintenance Mode
                                </CardTitle>
                                <CardDescription>Block access to all tenants while updating the system.</CardDescription>
                            </div>
                            <Switch 
                                checked={maintenanceMode} 
                                onCheckedChange={setMaintenanceMode} 
                            />
                        </div>
                    </CardHeader>
                    {maintenanceMode && (
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="maintenanceMsg">Maintenance Message</Label>
                                <Textarea 
                                    id="maintenanceMsg" 
                                    value={maintenanceMessage} 
                                    onChange={e => setMaintenanceMessage(e.target.value)} 
                                    placeholder="We are upgrading our servers..."
                                    className="h-24"
                                />
                                <p className="text-xs text-muted-foreground">This message will be shown to users trying to access the app.</p>
                            </div>
                        </CardContent>
                    )}
                </Card>

                {/* Global Announcements */}
                <Card className={announcementActive ? "border-primary shadow-sm" : ""}>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-primary">
                                    <Megaphone className="h-5 w-5" />
                                    Global Announcement
                                </CardTitle>
                                <CardDescription>Show a banner at the top of every tenant's dashboard.</CardDescription>
                            </div>
                            <Switch 
                                checked={announcementActive} 
                                onCheckedChange={setAnnouncementActive} 
                            />
                        </div>
                    </CardHeader>
                    {announcementActive && (
                        <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-[1fr_200px] gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="announceMsg">Banner Message</Label>
                                    <Input 
                                        id="announceMsg" 
                                        value={announcementMessage} 
                                        onChange={e => setAnnouncementMessage(e.target.value)} 
                                        placeholder="System maintenance tonight at 12 AM EST."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Banner Type</Label>
                                    <Select value={announcementType} onValueChange={setAnnouncementType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="info">Info (Blue)</SelectItem>
                                            <SelectItem value="warning">Warning (Yellow)</SelectItem>
                                            <SelectItem value="error">Error (Red)</SelectItem>
                                            <SelectItem value="success">Success (Green)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    )}
                </Card>

                <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={saving} size="lg">
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save All Settings
                    </Button>
                </div>
            </div>
        </div>
    );
}
