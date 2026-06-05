"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Tag, PlusCircle, CheckCircle, XCircle, Star } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { logAuditAction } from "@/lib/audit";

type SubscriptionPlan = {
    id: string;
    name: string;
    description: string;
    price_monthly: number;
    price_yearly: number;
    currency: string;
    features: string[];
    is_active: boolean;
    is_popular: boolean;
    created_at: string;
};

export default function PricingManagement() {
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);

    // Form states
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [priceMonthly, setPriceMonthly] = useState("0");
    const [priceYearly, setPriceYearly] = useState("0");
    const [featuresStr, setFeaturesStr] = useState("");
    const [isPopular, setIsPopular] = useState(false);

    const fetchPlans = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("subscription_plans")
            .select("*")
            .order("price_monthly", { ascending: true });

        if (!error && data) {
            setPlans(data);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchPlans();
    }, []);

    const toggleStatus = async (id: string, currentStatus: boolean) => {
        const { data, error } = await supabase
            .from("subscription_plans")
            .update({ is_active: !currentStatus })
            .eq("id", id)
            .select();
            
        if (error) {
            console.error("Error toggling status:", error);
            alert("Failed to update status: " + error.message);
        } else if (!data || data.length === 0) {
            alert("Update failed silently (0 rows affected). This means the database blocked the update, likely due to RLS permissions.");
        } else {
            await logAuditAction("PRICING_UPDATED", "Pricing", id, { status: !currentStatus ? "active" : "archived" });
            fetchPlans();
        }
    };

    const handleEditClick = (plan: SubscriptionPlan) => {
        setEditingId(plan.id);
        setName(plan.name);
        setDescription(plan.description || "");
        setPriceMonthly(plan.price_monthly.toString());
        setPriceYearly(plan.price_yearly.toString());
        setFeaturesStr(plan.features?.join("\n") || "");
        setIsPopular(plan.is_popular);
        setIsCreating(true);
    };

    const handleNewClick = () => {
        setEditingId(null);
        setName("");
        setDescription("");
        setPriceMonthly("0");
        setPriceYearly("0");
        setFeaturesStr("");
        setIsPopular(false);
        setIsCreating(true);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        
        const featuresArray = featuresStr.split("\n").map(f => f.trim()).filter(f => f.length > 0);

        const payload = {
            name,
            description,
            price_monthly: parseFloat(priceMonthly),
            price_yearly: parseFloat(priceYearly),
            features: featuresArray,
            is_popular: isPopular,
            is_active: true
        };

        let error;
        if (editingId) {
            const { error: updateError } = await supabase
                .from("subscription_plans")
                .update(payload)
                .eq("id", editingId);
            error = updateError;
        } else {
            const { error: insertError } = await supabase
                .from("subscription_plans")
                .insert(payload);
            error = insertError;
        }

        setSubmitting(false);
        if (error) {
            console.error("Error saving plan:", error);
            alert("Failed to save the package: " + error.message);
        } else {
            await logAuditAction("PRICING_UPDATED", "Pricing", editingId || "new", { name, priceMonthly });
            setIsCreating(false);
            setEditingId(null);
            fetchPlans();
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Pricing & Packages</h1>
                    <p className="text-muted-foreground">Manage the subscription plans shown on the landing page.</p>
                </div>
                <Dialog open={isCreating} onOpenChange={setIsCreating}>
                    <DialogTrigger asChild>
                        <Button onClick={handleNewClick}>
                            <PlusCircle className="mr-2 h-4 w-4" /> New Package
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>{editingId ? "Edit Subscription Plan" : "Create Subscription Plan"}</DialogTitle>
                            <DialogDescription>Define a new tier for your SaaS platform.</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="space-y-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name">Plan Name</Label>
                                <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pro, Enterprise" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="desc">Short Description</Label>
                                <Input id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Perfect for growing stores" required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="priceM">Monthly Price (EGP)</Label>
                                    <Input id="priceM" type="number" step="0.01" value={priceMonthly} onChange={e => setPriceMonthly(e.target.value)} required />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="priceY">Yearly Price (EGP)</Label>
                                    <Input id="priceY" type="number" step="0.01" value={priceYearly} onChange={e => setPriceYearly(e.target.value)} required />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="features">Features (One per line)</Label>
                                <Textarea 
                                    id="features" 
                                    value={featuresStr} 
                                    onChange={e => setFeaturesStr(e.target.value)} 
                                    placeholder="Unlimited Products&#10;24/7 Support&#10;Custom Domain" 
                                    className="h-24"
                                    required 
                                />
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <input 
                                    type="checkbox" 
                                    id="popular" 
                                    checked={isPopular} 
                                    onChange={e => setIsPopular(e.target.checked)} 
                                    className="rounded border-gray-300"
                                />
                                <Label htmlFor="popular" className="font-normal cursor-pointer">Mark as "Most Popular" on the landing page</Label>
                            </div>
                            <DialogFooter className="mt-6">
                                <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>Cancel</Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {editingId ? "Save Changes" : "Create Plan"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary" />
                        Available Packages
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Plan</TableHead>
                                        <TableHead>Monthly</TableHead>
                                        <TableHead>Features</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {plans.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center p-8 text-muted-foreground">
                                                No plans configured. Create one to display on the landing page.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        plans.map((plan) => (
                                            <TableRow key={plan.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        {plan.name}
                                                        {plan.is_popular && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{plan.price_monthly} {plan.currency}</TableCell>
                                                <TableCell className="text-muted-foreground text-xs">
                                                    {plan.features?.length} included
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={plan.is_active ? "default" : "secondary"}>
                                                        {plan.is_active ? "Active" : "Archived"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button 
                                                            size="sm" 
                                                            variant="outline" 
                                                            onClick={() => handleEditClick(plan)}
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Button 
                                                            size="sm" 
                                                            variant="outline" 
                                                            onClick={() => toggleStatus(plan.id, plan.is_active)}
                                                            className={plan.is_active ? "text-red-600 border-red-200 hover:bg-red-50" : "text-green-600 border-green-200 hover:bg-green-50"}
                                                        >
                                                            {plan.is_active ? "Archive" : "Activate"}
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
