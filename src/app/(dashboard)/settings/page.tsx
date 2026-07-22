"use client";

import { useState, useEffect } from "react";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { IntegrationLogs } from "@/components/settings/integration-logs";

export default function SettingsPage() {
    const { activeBusiness, userRole } = useBusiness();
    const { t } = useLanguage();
    
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    
    // Form state
    const [businessName, setBusinessName] = useState<string>("");
    const [language, setLanguage] = useState<string>("en");
    const [primaryColor, setPrimaryColor] = useState<string>("#0f172a");
    const [secondaryColor, setSecondaryColor] = useState<string>("#000000");
    const [darkMode, setDarkMode] = useState<string>("system");
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [restockHistoryDays, setRestockHistoryDays] = useState<number>(14);
    const [restockCoverageDays, setRestockCoverageDays] = useState<number>(14);

    // Integrations State
    const [integrations, setIntegrations] = useState<any>({
        shipping: {
            telegraph: { enabled: false, username: "", password: "", autoSync: false, autoSyncIntervalMinutes: 15, shippingCompanyId: "" }
        },
        platforms: {
            easyorders: { enabled: false, apiKey: "", webhookToken: "" }
        },
        tools: {
            vrobo: { enabled: false, apiKey: "", merchantId: "", autoSync: false, autoSyncIntervalMinutes: 60 }
        }
    });

    const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);

    useEffect(() => {
        if (activeBusiness) {
            setBusinessName(activeBusiness.name || "");
            setLanguage(activeBusiness.theme_config?.language || "en");
            setPrimaryColor(activeBusiness.theme_config?.primaryColor || "#0f172a");
            setSecondaryColor(activeBusiness.theme_config?.secondaryColor || "#000000");
            setDarkMode(activeBusiness.theme_config?.darkMode || "system");
            setLogoPreview(activeBusiness.logo_url);
            setRestockHistoryDays(activeBusiness.theme_config?.restock_history_days || 14);
            setRestockCoverageDays(activeBusiness.theme_config?.restock_coverage_days || 14);
            
            // Handle legacy EasyOrders settings
            const legacyWebhook = activeBusiness.theme_config?.easyorders_token || "";
            const legacyApiKey = activeBusiness.theme_config?.easyorders_api_key || "";
            
            // Merge existing integrations or setup defaults
            const savedIntegrations = activeBusiness.theme_config?.integrations || {};
            
            setIntegrations({
                shipping: {
                    telegraph: {
                        enabled: savedIntegrations.shipping?.telegraph?.enabled || false,
                        username: savedIntegrations.shipping?.telegraph?.username || "",
                        password: savedIntegrations.shipping?.telegraph?.password || "",
                        autoSync: savedIntegrations.shipping?.telegraph?.autoSync || false,
                        autoSyncIntervalMinutes: savedIntegrations.shipping?.telegraph?.autoSyncIntervalMinutes || 15,
                        shippingCompanyId: savedIntegrations.shipping?.telegraph?.shippingCompanyId || ""
                    }
                },
                platforms: {
                    easyorders: {
                        enabled: savedIntegrations.platforms?.easyorders?.enabled || !!legacyWebhook,
                        apiKey: savedIntegrations.platforms?.easyorders?.apiKey || legacyApiKey,
                        webhookToken: savedIntegrations.platforms?.easyorders?.webhookToken || legacyWebhook
                    }
                },
                tools: {
                    vrobo: {
                        enabled: savedIntegrations.tools?.vrobo?.enabled || false,
                        apiKey: savedIntegrations.tools?.vrobo?.apiKey || "",
                        merchantId: savedIntegrations.tools?.vrobo?.merchantId || "",
                        autoSync: savedIntegrations.tools?.vrobo?.autoSync || false,
                        autoSyncIntervalMinutes: savedIntegrations.tools?.vrobo?.autoSyncIntervalMinutes || 60
                    }
                }
            });
        }
    }, [activeBusiness]);

    useEffect(() => {
        if (activeBusiness) {
            const fetchShippingCompanies = async () => {
                const { data } = await supabase
                    .from("shipping_companies")
                    .select("id, name")
                    .eq("business_id", activeBusiness.id);
                if (data) setShippingCompanies(data);
            };
            fetchShippingCompanies();
        }
    }, [activeBusiness]);

    if (!userRole || (userRole !== "owner" && !userRole.toLowerCase().includes("super"))) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="text-center">
                    <h2 className="text-2xl font-bold tracking-tight text-red-600 mb-2">Access Denied</h2>
                    <p className="text-muted-foreground">You do not have permission to access business settings.</p>
                </div>
            </div>
        );
    }

    if (!activeBusiness) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setLogoFile(file);
            setLogoPreview(URL.createObjectURL(file));
        }
    };

    const handleRemoveLogo = () => {
        setLogoFile(null);
        setLogoPreview(null);
    };

    const handleIntegrationChange = (category: string, service: string, field: string, value: any) => {
        setIntegrations((prev: any) => ({
            ...prev,
            [category]: {
                ...prev[category],
                [service]: {
                    ...prev[category][service],
                    [field]: value
                }
            }
        }));
    };

    const handleSaveTheme = async () => {
        if (!activeBusiness) return;
        setSaving(true);
        setSuccessMessage("");
        
        try {
            let finalLogoUrl = logoPreview; 

            if (logoFile) {
                const fileExt = logoFile.name.split('.').pop();
                const fileName = `${activeBusiness.id}-logo-${Date.now()}.${fileExt}`;
                
                const { error: uploadError } = await supabase.storage
                    .from('business_logos')
                    .upload(fileName, logoFile);
                    
                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase.storage
                    .from('business_logos')
                    .getPublicUrl(fileName);
                    
                finalLogoUrl = publicUrlData.publicUrl;
            }

            const newThemeConfig = {
                ...(activeBusiness.theme_config || {}),
                language,
                primaryColor,
                secondaryColor,
                darkMode,
                // Maintain backwards compatibility if other functions depend on it
                easyorders_token: integrations.platforms.easyorders.webhookToken,
                easyorders_api_key: integrations.platforms.easyorders.apiKey,
                integrations: integrations,
                restock_history_days: restockHistoryDays,
                restock_coverage_days: restockCoverageDays
            };

            const { error: updateError, data: updatedData } = await supabase
                .from('businesses')
                .update({
                    name: businessName,
                    logo_url: finalLogoUrl,
                    theme_config: newThemeConfig
                })
                .eq('id', activeBusiness.id)
                .select();

            if (updateError) throw updateError;
            if (!updatedData || updatedData.length === 0) {
                throw new Error("RLS_BLOCKED");
            }

            setSuccessMessage("Settings saved successfully! Refreshing to apply...");
            
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error: any) {
            console.error("Error saving theme settings:", error);
            if (error?.message === "RLS_BLOCKED") {
                alert("Failed to save settings: You do not have permission to modify this business's settings (Must be the Owner).");
            } else {
                alert("Failed to save settings. Make sure the storage bucket exists.");
            }
        } finally {
            setSaving(false);
        }
    };

    const generateEasyOrdersToken = async () => {
        setSaving(true);
        try {
            const newToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            
            handleIntegrationChange('platforms', 'easyorders', 'webhookToken', newToken);
            handleIntegrationChange('platforms', 'easyorders', 'enabled', true);
            
            // Save immediately
            const newThemeConfig = {
                ...(activeBusiness?.theme_config || {}),
                easyorders_token: newToken,
                integrations: {
                    ...integrations,
                    platforms: {
                        ...integrations.platforms,
                        easyorders: {
                            ...integrations.platforms.easyorders,
                            webhookToken: newToken,
                            enabled: true
                        }
                    }
                }
            };
            
            const { error: updateError, data: updatedData } = await supabase
                .from('businesses')
                .update({ theme_config: newThemeConfig })
                .eq('id', activeBusiness!.id)
                .select();
                
            if (updateError) throw updateError;
            if (!updatedData || updatedData.length === 0) {
                throw new Error("RLS_BLOCKED");
            }
            
            toast.success(t("Token generated successfully"));
        } catch (error: any) {
            console.error("Error generating token:", error);
            if (error?.message === "RLS_BLOCKED") {
                toast.error("Failed to generate token: You do not have permission to modify settings (Must be the Owner).");
            } else {
                toast.error("Failed to generate and save token");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">{t("Settings")}</h2>
            </div>
            <Tabs defaultValue="theme" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="theme">{t("Theme & Appearance")}</TabsTrigger>
                    <TabsTrigger value="shipping">{t("Shipping Companies")}</TabsTrigger>
                    <TabsTrigger value="platforms">{t("Order Platforms")}</TabsTrigger>
                    <TabsTrigger value="tools">{t("Tools")}</TabsTrigger>
                    <TabsTrigger value="inventory">{t("Inventory")}</TabsTrigger>
                    <TabsTrigger value="logs">{t("System Logs")}</TabsTrigger>
                </TabsList>
                
                <TabsContent value="theme" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Theme & Appearance")}</CardTitle>
                            <CardDescription>
                                Customize how the system looks for your business.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            
                            <div className="space-y-2">
                                <Label>{t("Business Logo")}</Label>
                                <div className="flex items-center gap-6">
                                    <div className="relative h-24 w-24 rounded-md border flex items-center justify-center bg-muted overflow-hidden">
                                        {logoPreview ? (
                                            <Image src={logoPreview} alt="Logo" fill className="object-contain p-2" />
                                        ) : (
                                            <span className="text-xs text-muted-foreground">No Logo</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex gap-2">
                                            <Label htmlFor="logo-upload" className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">
                                                <Upload className="h-4 w-4 mr-2" />
                                                {t("Upload Logo")}
                                            </Label>
                                            <input 
                                                id="logo-upload" 
                                                type="file" 
                                                accept="image/*" 
                                                className="hidden" 
                                                onChange={handleLogoChange}
                                            />
                                            {logoPreview && (
                                                <Button variant="outline" size="sm" onClick={handleRemoveLogo}>
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    {t("Remove Logo")}
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Recommended: Square image, max 5MB.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>{t("Business Name")}</Label>
                                    <Input 
                                        type="text" 
                                        value={businessName} 
                                        onChange={(e) => setBusinessName(e.target.value)} 
                                        placeholder={t("Business Name")}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>{t("Language")}</Label>
                                    <Select value={language} onValueChange={setLanguage}>
                                        <SelectTrigger>
                                            <SelectValue placeholder={t("Select Language")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="en">{t("English")}</SelectItem>
                                            <SelectItem value="ar">{t("Arabic")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>{t("Primary Color")}</Label>
                                    <div className="flex gap-3 items-center">
                                        <Input 
                                            type="color" 
                                            value={primaryColor} 
                                            onChange={(e) => setPrimaryColor(e.target.value)} 
                                            className="w-16 h-10 p-1 cursor-pointer"
                                        />
                                        <Input 
                                            type="text" 
                                            value={primaryColor} 
                                            onChange={(e) => setPrimaryColor(e.target.value)} 
                                            className="font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>{t("Secondary Color")}</Label>
                                    <div className="flex gap-3 items-center">
                                        <Input 
                                            type="color" 
                                            value={secondaryColor} 
                                            onChange={(e) => setSecondaryColor(e.target.value)} 
                                            className="w-16 h-10 p-1 cursor-pointer"
                                        />
                                        <Input 
                                            type="text" 
                                            value={secondaryColor} 
                                            onChange={(e) => setSecondaryColor(e.target.value)} 
                                            className="font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>{t("Theme Appearance")}</Label>
                                    <Select value={darkMode} onValueChange={setDarkMode}>
                                        <SelectTrigger>
                                            <SelectValue placeholder={t("Select Theme")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="system">{t("System Default")}</SelectItem>
                                            <SelectItem value="light">{t("Light Mode")}</SelectItem>
                                            <SelectItem value="dark">{t("Dark Mode")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-4 border-t p-6">
                            <p className="text-sm font-medium text-green-600 flex items-center w-full sm:w-auto">
                                {successMessage && <><CheckCircle2 className="w-4 h-4 mr-2" /> {successMessage}</>}
                            </p>
                            <Button onClick={handleSaveTheme} disabled={saving} className="w-full sm:w-auto">
                                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {t("Save Changes")}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                {/* Shipping Companies Tab */}
                <TabsContent value="shipping" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Shipping Companies")}</CardTitle>
                            <CardDescription>
                                {t("Manage integrations with shipping providers.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4 border rounded-md p-4 bg-muted/20">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center">
                                        Telegraph Integration
                                        {integrations.shipping.telegraph.enabled && (
                                            <Badge variant="outline" className="ml-3 bg-green-50 text-green-700 border-green-200">Active</Badge>
                                        )}
                                    </h3>
                                    <Switch 
                                        checked={integrations.shipping.telegraph.enabled} 
                                        onCheckedChange={(c) => handleIntegrationChange('shipping', 'telegraph', 'enabled', c)}
                                    />
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {t("Connect to Telegraph shipping to sync statuses and tracking.")}
                                </p>
                                
                                {integrations.shipping.telegraph.enabled && (
                                    <div className="space-y-4 pt-4 border-t">
                                        <div className="space-y-2">
                                            <Label>{t("Telegraph Username")}</Label>
                                            <Input 
                                                placeholder={t("Enter Username")} 
                                                value={integrations.shipping.telegraph.username}
                                                onChange={(e) => handleIntegrationChange('shipping', 'telegraph', 'username', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>{t("Telegraph Password")}</Label>
                                            <Input 
                                                placeholder={t("Enter Password")} 
                                                value={integrations.shipping.telegraph.password}
                                                onChange={(e) => handleIntegrationChange('shipping', 'telegraph', 'password', e.target.value)}
                                                type="password"
                                            />
                                        </div>

                                        <div className="flex items-center space-x-2 pt-2">
                                            <Switch 
                                                checked={integrations.shipping.telegraph.autoSync} 
                                                onCheckedChange={(c) => handleIntegrationChange('shipping', 'telegraph', 'autoSync', c)}
                                            />
                                            <Label>{t("Enable Auto Sync")}</Label>
                                        </div>
                                        
                                        {integrations.shipping.telegraph.autoSync && (
                                            <div className="space-y-2">
                                                <Label>{t("Auto Sync Interval (Minutes)")}</Label>
                                                <Input 
                                                    type="number"
                                                    min="1"
                                                    max="1440"
                                                    value={integrations.shipping.telegraph.autoSyncIntervalMinutes}
                                                    onChange={(e) => handleIntegrationChange('shipping', 'telegraph', 'autoSyncIntervalMinutes', parseInt(e.target.value) || 15)}
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    {t("How often should the system check for status updates automatically.")}
                                                </p>
                                            </div>
                                        )}
                                        
                                        <div className="space-y-2">
                                            <Label>{t("Linked Shipping Company")}</Label>
                                            <Select
                                                value={integrations.shipping.telegraph.shippingCompanyId}
                                                onValueChange={(val) => handleIntegrationChange('shipping', 'telegraph', 'shippingCompanyId', val)}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder={t("Select a shipping company")} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {shippingCompanies.map(sc => (
                                                        <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">
                                                {t("Select the system shipping company ID that will be applied to orders when auto-sync marks them as shipped.")}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                        <CardFooter className="border-t p-6">
                            <Button onClick={handleSaveTheme} disabled={saving}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                {t("Save Shipping Settings")}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                {/* Order Platforms Tab */}
                <TabsContent value="platforms" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Order Platforms")}</CardTitle>
                            <CardDescription>
                                {t("Connect Zuha System with order aggregation platforms.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4 border rounded-md p-4 bg-muted/20">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center">
                                        EasyOrders Integration
                                        {integrations.platforms.easyorders.enabled && (
                                            <Badge variant="outline" className="ml-3 bg-green-50 text-green-700 border-green-200">Active</Badge>
                                        )}
                                    </h3>
                                    <Switch 
                                        checked={integrations.platforms.easyorders.enabled} 
                                        onCheckedChange={(c) => handleIntegrationChange('platforms', 'easyorders', 'enabled', c)}
                                    />
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {t("Receive new orders and sync status back to EasyOrders.")}
                                </p>
                                
                                {integrations.platforms.easyorders.enabled && (
                                    <div className="space-y-4 pt-4 border-t">
                                        <div className="space-y-2">
                                            <Label>{t("Webhook URL (For receiving orders)")}</Label>
                                            <div className="flex gap-2">
                                                <Input 
                                                    readOnly 
                                                    value={
                                                        integrations.platforms.easyorders.webhookToken 
                                                            ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/easyorders?business=${activeBusiness.id}&token=${integrations.platforms.easyorders.webhookToken}`
                                                            : t("Generate a token to create the Webhook URL")
                                                    } 
                                                    className="font-mono text-xs bg-muted"
                                                />
                                                <Button 
                                                    variant="outline"
                                                    disabled={!integrations.platforms.easyorders.webhookToken}
                                                    onClick={() => {
                                                        const url = `${window.location.origin}/api/webhooks/easyorders?business=${activeBusiness?.id}&token=${integrations.platforms.easyorders.webhookToken}`;
                                                        navigator.clipboard.writeText(url);
                                                        toast.success(t("URL copied to clipboard"));
                                                    }}
                                                >
                                                    Copy
                                                </Button>
                                                <Button 
                                                    variant="secondary"
                                                    onClick={generateEasyOrdersToken}
                                                    disabled={saving}
                                                >
                                                    {integrations.platforms.easyorders.webhookToken ? t("Regenerate") : t("Generate")}
                                                </Button>
                                            </div>
                                        </div>
                                        
                                        <div className="space-y-2">
                                            <Label>{t("EasyOrders API Key (For sending updates)")}</Label>
                                            <Input 
                                                placeholder={t("Enter API Key")} 
                                                value={integrations.platforms.easyorders.apiKey}
                                                onChange={(e) => handleIntegrationChange('platforms', 'easyorders', 'apiKey', e.target.value)}
                                                type="password"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                        <CardFooter className="border-t p-6">
                            <Button onClick={handleSaveTheme} disabled={saving}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                {t("Save Platforms Settings")}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                {/* Tools Tab */}
                <TabsContent value="tools" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Tools")}</CardTitle>
                            <CardDescription>
                                {t("Manage external tools and third-party integrations.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4 border rounded-md p-4 bg-muted/20">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-medium flex items-center">
                                        VROBO Verification
                                        {integrations.tools.vrobo.enabled && (
                                            <Badge variant="outline" className="ml-3 bg-green-50 text-green-700 border-green-200">Active</Badge>
                                        )}
                                    </h3>
                                    <Switch 
                                        checked={integrations.tools.vrobo.enabled} 
                                        onCheckedChange={(c) => handleIntegrationChange('tools', 'vrobo', 'enabled', c)}
                                    />
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {t("Automated WhatsApp notifications for order verifications and status updates.")}
                                </p>
                                
                                {integrations.tools.vrobo.enabled && (
                                    <div className="space-y-4 pt-4 border-t">
                                        <div className="space-y-2">
                                            <Label>{t("VROBO API Token")}</Label>
                                            <Input 
                                                placeholder={t("Enter API Token")} 
                                                value={integrations.tools.vrobo.apiKey}
                                                onChange={(e) => handleIntegrationChange('tools', 'vrobo', 'apiKey', e.target.value)}
                                                type="password"
                                            />
                                        </div>
                                        
                                        <div className="space-y-2">
                                            <Label>{t("Merchant ID (Optional)")}</Label>
                                            <Input 
                                                placeholder={t("Enter Merchant ID")} 
                                                value={integrations.tools.vrobo.merchantId}
                                                onChange={(e) => handleIntegrationChange('tools', 'vrobo', 'merchantId', e.target.value)}
                                            />
                                        </div>

                                        <div className="flex items-center space-x-2 pt-2">
                                            <Switch 
                                                checked={integrations.tools.vrobo.autoSync} 
                                                onCheckedChange={(c) => handleIntegrationChange('tools', 'vrobo', 'autoSync', c)}
                                            />
                                            <Label>{t("Enable Auto Sync")}</Label>
                                        </div>
                                        
                                        {integrations.tools.vrobo.autoSync && (
                                            <div className="space-y-2">
                                                <Label>{t("Auto Sync Interval (Minutes)")}</Label>
                                                <Input 
                                                    type="number"
                                                    min="1"
                                                    max="1440"
                                                    value={integrations.tools.vrobo.autoSyncIntervalMinutes}
                                                    onChange={(e) => handleIntegrationChange('tools', 'vrobo', 'autoSyncIntervalMinutes', parseInt(e.target.value) || 60)}
                                                />
                                                <p className="text-xs text-muted-foreground">
                                                    {t("How often should VROBO sync problematic orders automatically.")}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                        <CardFooter className="border-t p-6">
                            <Button onClick={handleSaveTheme} disabled={saving}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                {t("Save Tools Settings")}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                {/* Inventory Tab */}
                <TabsContent value="inventory" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Inventory Settings")}</CardTitle>
                            <CardDescription>
                                {t("Configure parameters for the smart restocking system.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>{t("Sales History Period (Days)")}</Label>
                                    <Input 
                                        type="number"
                                        min="1"
                                        value={restockHistoryDays}
                                        onChange={(e) => setRestockHistoryDays(parseInt(e.target.value) || 14)}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t("How many days in the past should the system analyze to calculate sales velocity?")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Stock Coverage Period (Days)")}</Label>
                                    <Input 
                                        type="number"
                                        min="1"
                                        value={restockCoverageDays}
                                        onChange={(e) => setRestockCoverageDays(parseInt(e.target.value) || 14)}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t("How many days into the future do you want your restock to cover?")}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="border-t p-6">
                            <Button onClick={handleSaveTheme} disabled={saving}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                {t("Save Inventory Settings")}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                {/* System Logs Tab */}
                <TabsContent value="logs" className="space-y-4">
                    <IntegrationLogs />
                </TabsContent>

            </Tabs>
        </div>
    );
}
