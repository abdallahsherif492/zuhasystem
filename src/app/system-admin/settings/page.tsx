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
import { Loader2, Settings, ShieldAlert, Megaphone } from "lucide-react";

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
    
    const [defaultTrialDays, setDefaultTrialDays] = useState(14);
    const [instapayNumber, setInstapayNumber] = useState("");
    const [instapayName, setInstapayName] = useState("");

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
            setDefaultTrialDays(data.default_trial_days || 14);
            setInstapayNumber(data.instapay_number || "");
            setInstapayName(data.instapay_name || "");
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
                instapay_name: instapayName
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
                default_trial_days: defaultTrialDays
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
                            <p className="text-xs text-muted-foreground mt-2">These details will be shown to clients when they want to pay for their subscription.</p>
                        </div>
                    </CardContent>
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
