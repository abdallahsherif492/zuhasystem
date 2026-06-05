"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ShieldAlert, ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Suspense } from "react";

const SECTIONS = [
    { key: "/orders", label: "Orders" },
    { key: "/inventory", label: "Inventory" },
    { key: "/products", label: "Products" },
    { key: "/customers", label: "Customers" },
    { key: "/payable", label: "Accounts Payable" },
    { key: "/logistics", label: "Logistics" },
    { key: "/shipping", label: "Shipping" },
    { key: "/accounting", label: "Accounting" },
    { key: "/purchases", label: "Purchases" },
    { key: "/ads", label: "Ads" },
    { key: "/insights", label: "Insights" }
];

function UsersManagementContent() {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<any>(null);

    useEffect(() => {
        fetchUsers();
    }, []);

    async function fetchUsers() {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            setCurrentUser(user);

            const { data, error } = await supabase
                .from('user_permissions')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUsers(data || []);
        } catch (error: any) {
            toast.error(error.message || "Failed to fetch users. If the table is missing, please run the SQL script first.");
        } finally {
            setLoading(false);
        }
    }

    async function handleTogglePermission(userId: string, sectionKey: string, newValue: boolean) {
        setUsers(current => current.map(u => {
            if (u.id === userId) {
                return {
                    ...u,
                    permissions: {
                        ...(u.permissions || {}),
                        [sectionKey]: newValue
                    }
                };
            }
            return u;
        }));
    }

    async function handleSavePermissions(userObj: any) {
        setSavingId(userObj.id);
        try {
            // In Postgres, updating JSONB with `{...permissions}` will overwrite the object entirely
            // Since we merge locally, this is fine.
            const { error } = await supabase
                .from('user_permissions')
                .update({ permissions: userObj.permissions })
                .eq('id', userObj.id);

            if (error) throw error;
            toast.success(`Permissions updated for ${userObj.email}`);
        } catch (error: any) {
            toast.error(error.message || "Failed to update permissions");
            fetchUsers(); // revert
        } finally {
            setSavingId(null);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    // Identify current user's profile to verify super admin locally
    const myProfile = users.find(u => u.id === currentUser?.id);
    if (!myProfile?.super_admin) {
        return (
            <div className="flex justify-center p-20 flex-col items-center text-center max-w-lg mx-auto">
                <ShieldAlert className="h-16 w-16 text-red-500 mb-6" />
                <h1 className="text-3xl font-bold mb-2">Unauthorized Area</h1>
                <p className="text-muted-foreground">
                    You do not have Super Admin privileges to view or manage user permissions.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Users & Permissions</h1>
                <p className="text-muted-foreground mt-2">
                    Manage access control for all internal accounts. Super Admins bypass these checks.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {users.map(u => (
                    <Card key={u.id} className={u.super_admin ? "border-primary/50 bg-primary/5" : ""}>
                        <CardHeader className="flex flex-row items-start justify-between pb-4">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <UserCog className="h-5 w-5" />
                                    {u.email}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    {u.super_admin ? "Super Admin - Unrestricted Access" : "Standard User - Restricted Access. Toggle pages below."}
                                </CardDescription>
                            </div>
                            {u.super_admin ? (
                                <ShieldCheck className="h-6 w-6 text-primary" />
                            ) : (
                                <Button
                                    onClick={() => handleSavePermissions(u)}
                                    disabled={savingId === u.id}
                                    className="shrink-0"
                                >
                                    {savingId === u.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Save Permissions
                                </Button>
                            )}
                        </CardHeader>
                        {!u.super_admin && (
                            <CardContent>
                                <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {SECTIONS.map(section => {
                                        // Default false if safely not present
                                        const isAllowed = u.permissions?.[section.key] === true;
                                        return (
                                            <div key={section.key} className="flex items-center space-x-3 border p-3 rounded-lg bg-card shadow-sm hover:bg-accent/50 transition-colors">
                                                <Switch
                                                    id={`${u.id}-${section.key}`}
                                                    checked={isAllowed}
                                                    onCheckedChange={(checked) => handleTogglePermission(u.id, section.key, checked)}
                                                />
                                                <label
                                                    htmlFor={`${u.id}-${section.key}`}
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                                                >
                                                    {section.label}
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        )}
                    </Card>
                ))}
            </div>
        </div>
    );
}

export default function UsersManagementPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <UsersManagementContent />
        </Suspense>
    );
}
