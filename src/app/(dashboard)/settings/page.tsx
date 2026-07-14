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
import { Loader2, Upload, Trash2, CheckCircle2 } from "lucide-react";
import Image from "next/image";

export default function SettingsPage() {
    const { activeBusiness, userRole } = useBusiness();
    const { t } = useLanguage();
    
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    
    // Form state
    const [businessName, setBusinessName] = useState<string>("");
    const [language, setLanguage] = useState<string>("en");
    const [primaryColor, setPrimaryColor] = useState<string>("#0f172a"); // Default slate-900
    const [secondaryColor, setSecondaryColor] = useState<string>("#e2e8f0"); // Default slate-200
    const [darkMode, setDarkMode] = useState<string>("system");
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    useEffect(() => {
        if (activeBusiness) {
            setBusinessName(activeBusiness.name || "");
            setLanguage(activeBusiness.theme_config?.language || "en");
            setPrimaryColor(activeBusiness.theme_config?.primaryColor || "#0f172a");
            setSecondaryColor(activeBusiness.theme_config?.secondaryColor || "#e2e8f0");
            setDarkMode(activeBusiness.theme_config?.darkMode || "system");
            setLogoPreview(activeBusiness.logo_url);
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

    const handleSaveTheme = async () => {
        if (!activeBusiness) return;
        setSaving(true);
        setSuccessMessage("");
        
        try {
            let finalLogoUrl = logoPreview; // Keep existing or null

            // 1. Upload new logo if exists
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

            // 2. Update Business record
            const newThemeConfig = {
                ...(activeBusiness.theme_config || {}),
                language,
                primaryColor,
                secondaryColor,
                darkMode
            };

            const { error: updateError } = await supabase
                .from('businesses')
                .update({
                    name: businessName,
                    logo_url: finalLogoUrl,
                    theme_config: newThemeConfig
                })
                .eq('id', activeBusiness.id);

            if (updateError) throw updateError;

            setSuccessMessage("Settings saved successfully! Refreshing to apply...");
            
            // Reload to apply changes across contexts
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            console.error("Error saving theme settings:", error);
            alert("Failed to save settings. Make sure the storage bucket exists.");
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
                            
                            {/* Logo Upload */}
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
                                {/* Business Name */}
                                <div className="space-y-2">
                                    <Label>{t("Business Name")}</Label>
                                    <Input 
                                        type="text" 
                                        value={businessName} 
                                        onChange={(e) => setBusinessName(e.target.value)} 
                                        placeholder={t("Business Name")}
                                    />
                                </div>

                                {/* Language */}
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

                                {/* Primary Color */}
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

                                {/* Secondary Color */}
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

                                {/* Dark Mode */}
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
            </Tabs>
        </div>
    );
}
