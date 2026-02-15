"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, Truck, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";

const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
].sort();

type ShippingCompany = {
    id: string;
    name: string;
    type: 'Company' | 'Courier' | 'Office';
    phone: string;
    rates: Record<string, number>;
    active: boolean;
};

export function ShippingManagement() {
    const [companies, setCompanies] = useState<ShippingCompany[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<ShippingCompany | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        name: "",
        type: "Company" as 'Company' | 'Courier' | 'Office',
        phone: "",
        rates: {} as Record<string, number>
    });

    useEffect(() => {
        fetchCompanies();
    }, []);

    const fetchCompanies = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('shipping_companies')
            .select('*')
            .order('name');

        if (error) {
            toast.error("Failed to fetch shipping companies");
            console.error(error);
        } else {
            setCompanies(data || []);
        }
        setLoading(false);
    };

    const handleOpenDialog = (company?: ShippingCompany) => {
        if (company) {
            setEditingCompany(company);
            setFormData({
                name: company.name,
                type: company.type,
                phone: company.phone || "",
                rates: company.rates || {}
            });
        } else {
            setEditingCompany(null);
            setFormData({
                name: "",
                type: "Company",
                phone: "",
                rates: {}
            });
        }
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name) {
            toast.error("Name is required");
            return;
        }

        try {
            const payload = {
                name: formData.name,
                type: formData.type,
                phone: formData.phone,
                rates: formData.rates
            };

            let error;
            if (editingCompany) {
                const { error: updateError } = await supabase
                    .from('shipping_companies')
                    .update(payload)
                    .eq('id', editingCompany.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('shipping_companies')
                    .insert([payload]);
                error = insertError;
            }

            if (error) throw error;

            toast.success(editingCompany ? "Company updated" : "Company created");
            setIsDialogOpen(false);
            fetchCompanies();
        } catch (error: any) {
            toast.error(error.message || "Failed to save");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this company?")) return;

        const { error } = await supabase.from('shipping_companies').delete().eq('id', id);
        if (error) {
            toast.error("Failed to delete");
        } else {
            toast.success("Company deleted");
            fetchCompanies();
        }
    };

    const updateRate = (gov: string, value: string) => {
        const num = parseFloat(value);
        const newRates = { ...formData.rates };
        if (isNaN(num)) {
            delete newRates[gov];
        } else {
            newRates[gov] = num;
        }
        setFormData({ ...formData, rates: newRates });
    };

    const applyStandardRate = (rate: number) => {
        const newRates = { ...formData.rates };
        GOVERNORATES.forEach(g => {
            newRates[g] = rate;
        });
        setFormData({ ...formData, rates: newRates });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Companies</h2>
                    <p className="text-muted-foreground text-sm">Manage couriers, companies, and shipping rates.</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/shipping/update">
                        <Button variant="outline">
                            <Upload className="mr-2 h-4 w-4" />
                            Bulk Updates
                        </Button>
                    </Link>
                    <Button onClick={() => handleOpenDialog()}>
                        <Plus className="mr-2 h-4 w-4" /> Add Company
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {companies.map(company => (
                        <Card key={company.id} className="relative overflow-hidden group hover:border-primary/50 transition-colors">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-2">
                                        <div className="p-2 bg-primary/10 rounded-full text-primary">
                                            <Truck className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <CardTitle>{company.name}</CardTitle>
                                            <CardDescription>{company.type} • {company.phone || "No Phone"}</CardDescription>
                                        </div>
                                    </div>
                                    <Badge variant={company.active ? "default" : "secondary"}>
                                        {company.active ? "Active" : "Inactive"}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-sm text-muted-foreground mb-4">
                                    {Object.keys(company.rates || {}).length} Governorates Configured
                                </div>
                                <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="outline" size="sm" onClick={() => handleOpenDialog(company)}>
                                        <Pencil className="h-4 w-4 mr-1" /> Edit
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => handleDelete(company.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    {companies.length === 0 && (
                        <div className="col-span-full text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                            No shipping companies found. Add one to get started.
                        </div>
                    )}
                </div>
            )}

            {/* Add/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{editingCompany ? "Edit Company" : "Add Shipping Company"}</DialogTitle>
                        <DialogDescription>Configure company details and shipping rates.</DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto pr-2 space-y-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>Company Name</Label>
                                <Input
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Bosta, Mylerz, Ahmed Courier"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select
                                    value={formData.type}
                                    onValueChange={(v: any) => setFormData({ ...formData, type: v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Company">Company</SelectItem>
                                        <SelectItem value="Courier">Courier (Individual)</SelectItem>
                                        <SelectItem value="Office">Office</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="Contact Number"
                                />
                            </div>
                        </div>

                        <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold">Shipping Rates (EGP)</h3>
                                <div className="flex items-center gap-2">
                                    <Label className="text-xs whitespace-nowrap">Bulk Set:</Label>
                                    <Input
                                        type="number"
                                        className="w-20 h-8"
                                        placeholder="Amount"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                applyStandardRate(parseFloat((e.target as HTMLInputElement).value) || 0);
                                                (e.target as HTMLInputElement).value = "";
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                {GOVERNORATES.map(gov => (
                                    <div key={gov} className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">{gov}</Label>
                                        <Input
                                            type="number"
                                            value={formData.rates[gov] ?? ""}
                                            onChange={e => updateRate(gov, e.target.value)}
                                            className="h-8"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave}>Save Company</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
