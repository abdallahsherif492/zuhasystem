"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, CreditCard, Upload, CheckCircle2, AlertCircle } from "lucide-react";

type SubscriptionPlan = {
    id: string;
    name: string;
    price_monthly: number;
    currency: string;
};

export default function BillingPage() {
    const { activeBusiness, platformSettings } = useBusiness();
    const [loading, setLoading] = useState(true);
    const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
    const [businessData, setBusinessData] = useState<any>(null);
    const [isPaying, setIsPaying] = useState(false);
    
    const [file, setFile] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [hasPendingRequest, setHasPendingRequest] = useState(false);

    useEffect(() => {
        const fetchBillingData = async () => {
            if (!activeBusiness) return;
            setLoading(true);

            // Fetch current business details (including plan_id and trial_ends_at)
            const { data: bizData } = await supabase
                .from("businesses")
                .select("*")
                .eq("id", activeBusiness.id)
                .single();
            
            setBusinessData(bizData);

            if (bizData?.plan_id) {
                const { data: planData } = await supabase
                    .from("subscription_plans")
                    .select("*")
                    .eq("id", bizData.plan_id)
                    .single();
                setPlan(planData);
            }

            // Check if there is a pending payment request
            const { data: pendingTx } = await supabase
                .from("platform_transactions")
                .select("id")
                .eq("business_id", activeBusiness.id)
                .eq("status", "pending")
                .eq("type", "revenue")
                .maybeSingle();

            if (pendingTx) {
                setHasPendingRequest(true);
            }

            setLoading(false);
        };

        fetchBillingData();
    }, [activeBusiness]);

    const handleSubmitPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !activeBusiness || !plan) return;

        setSubmitting(true);
        try {
            // 1. Upload the image to Supabase Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${activeBusiness.id}-${Date.now()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('payment_proofs')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: publicUrlData } = supabase.storage
                .from('payment_proofs')
                .getPublicUrl(fileName);

            // 2. Insert transaction
            const { error: txError } = await supabase
                .from("platform_transactions")
                .insert({
                    type: "revenue",
                    amount: plan.price_monthly,
                    status: "pending",
                    category: "Subscription",
                    business_id: activeBusiness.id,
                    plan_id: plan.id,
                    proof_url: publicUrlData.publicUrl,
                    description: `Payment for ${plan.name} plan via InstaPay`
                });

            if (txError) throw txError;

            setHasPendingRequest(true);
            setIsPaying(false);
            alert("Payment proof submitted successfully! Your account will be activated once verified.");
        } catch (err: any) {
            console.error(err);
            alert("Error submitting payment: " + err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Billing & Subscription</h1>
                <p className="text-muted-foreground">Manage your subscription, view invoices, and make payments.</p>
            </div>

            {hasPendingRequest && (
                <div className="bg-yellow-500/10 border border-yellow-500/50 text-yellow-700 p-4 rounded-lg flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
                    <div>
                        <h4 className="font-semibold">Payment Verification Pending</h4>
                        <p className="text-sm mt-1">We have received your payment proof and our team is currently verifying it. Your subscription will be updated shortly.</p>
                    </div>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CreditCard className="h-5 w-5 text-primary" />
                            Current Plan
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center pb-4 border-b">
                            <div>
                                <p className="text-sm text-muted-foreground">Plan</p>
                                <p className="text-xl font-bold">{plan ? plan.name : "Free Trial"}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-muted-foreground">Status</p>
                                <Badge variant={businessData?.subscription_status === "active" ? "default" : "secondary"}>
                                    {businessData?.subscription_status?.toUpperCase()}
                                </Badge>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Amount</span>
                                <span>{plan ? `${plan.price_monthly} ${plan.currency} / month` : "Free"}</span>
                            </div>
                            {businessData?.trial_ends_at && businessData.subscription_status === "trialing" && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Trial Ends</span>
                                    <span>{new Date(businessData.trial_ends_at).toLocaleDateString()}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Dialog open={isPaying} onOpenChange={setIsPaying}>
                            <DialogTrigger asChild>
                                <Button className="w-full" disabled={hasPendingRequest}>
                                    {hasPendingRequest ? "Pending Verification" : "Pay Subscription"}
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Complete Your Payment</DialogTitle>
                                    <DialogDescription>
                                        Please transfer the subscription amount via InstaPay and upload the receipt screenshot.
                                    </DialogDescription>
                                </DialogHeader>
                                
                                <form onSubmit={handleSubmitPayment} className="space-y-6 pt-4">
                                    <div className="bg-muted p-4 rounded-lg space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Total Amount:</span>
                                            <span className="font-bold">{plan?.price_monthly} {plan?.currency}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">InstaPay Number:</span>
                                            <span className="font-bold font-mono">{platformSettings?.instapay_number || "Not Set"}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Account Name:</span>
                                            <span className="font-bold">{platformSettings?.instapay_name || "Not Set"}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="proof">Upload Payment Screenshot</Label>
                                        <Input 
                                            id="proof" 
                                            type="file" 
                                            accept="image/*"
                                            onChange={e => setFile(e.target.files?.[0] || null)}
                                            required
                                        />
                                        <p className="text-xs text-muted-foreground">Accepted formats: JPG, PNG. Max size: 5MB.</p>
                                    </div>

                                    <DialogFooter>
                                        <Button type="button" variant="outline" onClick={() => setIsPaying(false)}>Cancel</Button>
                                        <Button type="submit" disabled={!file || submitting}>
                                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            <Upload className="mr-2 h-4 w-4" />
                                            Submit Payment Proof
                                        </Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
