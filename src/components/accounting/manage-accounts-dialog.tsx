"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Wallet } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export function ManageAccountsDialog({ onSuccess }: { onSuccess?: () => void }) {
    const { activeBusiness } = useBusiness();
    const [open, setOpen] = useState(false);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [newAccountName, setNewAccountName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open && activeBusiness) {
            fetchAccounts();
        }
    }, [open, activeBusiness]);

    async function fetchAccounts() {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from("financial_accounts")
                .select("*")
                .eq("business_id", activeBusiness?.id)
                .order("created_at", { ascending: true });
            
            if (error) throw error;
            setAccounts(data || []);
        } catch (error) {
            console.error("Error fetching accounts:", error);
        } finally {
            setLoading(false);
        }
    }

    async function handleAddAccount(e: React.FormEvent) {
        e.preventDefault();
        if (!newAccountName.trim() || !activeBusiness) return;
        
        try {
            setSubmitting(true);
            const { error } = await supabase.from("financial_accounts").insert({
                business_id: activeBusiness.id,
                name: newAccountName.trim()
            });
            
            if (error) {
                if (error.code === '23505') {
                    alert("An account with this name already exists.");
                } else {
                    throw error;
                }
            } else {
                setNewAccountName("");
                fetchAccounts();
                if (onSuccess) onSuccess();
            }
        } catch (error) {
            console.error("Error adding account:", error);
            alert("Failed to add account");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            const { error } = await supabase.from("financial_accounts").delete().eq("id", id);
            if (error) throw error;
            fetchAccounts();
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error("Error deleting account:", error);
            alert("Failed to delete account. It might be used in existing transactions.");
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Wallet className="h-4 w-4" />
                    Manage Treasury Accounts
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Manage Treasury Accounts</DialogTitle>
                    <DialogDescription>
                        Add or remove financial accounts (e.g. Bank, Safe, Wallet) for your business.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-4">
                    <form onSubmit={handleAddAccount} className="flex gap-2">
                        <Input 
                            placeholder="Account Name (e.g. Bank Misr)" 
                            value={newAccountName}
                            onChange={(e) => setNewAccountName(e.target.value)}
                            disabled={submitting}
                        />
                        <Button type="submit" disabled={!newAccountName.trim() || submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        </Button>
                    </form>

                    <div className="border rounded-md mt-4 max-h-[300px] overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Account Name</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                                        </TableCell>
                                    </TableRow>
                                ) : accounts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                                            No accounts found. Create one above.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    accounts.map((acc) => (
                                        <TableRow key={acc.id}>
                                            <TableCell className="font-medium">{acc.name}</TableCell>
                                            <TableCell className="text-right">
                                                <Button 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    onClick={() => handleDelete(acc.id)}
                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 w-8"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
