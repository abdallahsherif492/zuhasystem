"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Users, ShieldAlert, Trash2, Edit3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { logAuditAction } from "@/lib/audit";

type PlatformUser = {
    id: string;
    user_email: string;
    role: string;
    created_at: string;
    business_id: string;
    businesses: {
        name: string;
    };
};

export default function PlatformUsersDirectory() {
    const [users, setUsers] = useState<PlatformUser[]>([]);
    const [loading, setLoading] = useState(true);

    const [isRevokeOpen, setIsRevokeOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
    const [processing, setProcessing] = useState(false);

    // Quota state
    const [isQuotaOpen, setIsQuotaOpen] = useState(false);
    const [quotaLoading, setQuotaLoading] = useState(false);
    const [quotaValue, setQuotaValue] = useState(1);
    const [quotaUserEmail, setQuotaUserEmail] = useState("");
    const [quotaUserId, setQuotaUserId] = useState("");

    const fetchUsers = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("business_users")
            .select(`
                id,
                user_email,
                role,
                created_at,
                business_id,
                businesses ( name )
            `)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setUsers(data as unknown as PlatformUser[]);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleChangeRole = async (userId: string, newRole: string) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        // Ensure we don't accidentally remove the only owner
        if (user.role === "owner" && newRole !== "owner") {
            const ownerCount = users.filter(u => u.business_id === user.business_id && u.role === "owner").length;
            if (ownerCount <= 1) {
                alert("Cannot change the role of the only owner of this business.");
                return;
            }
        }

        const { error } = await supabase
            .from("business_users")
            .update({ role: newRole })
            .eq("id", userId);

        if (!error) {
            await logAuditAction("USER_ROLE_CHANGED", "User", userId, { 
                email: user.user_email, 
                business: user.businesses?.name, 
                old_role: user.role, 
                new_role: newRole 
            });
            fetchUsers();
        } else {
            alert("Error: " + error.message);
        }
    };


    const handleOpenQuota = async (userEmail: string, userId: string) => {
        setQuotaUserEmail(userEmail);
        setQuotaUserId(userId);
        setIsQuotaOpen(true);
        setQuotaLoading(true);

        const { data, error } = await supabase
            .from("user_permissions")
            .select("max_businesses")
            .eq("email", userEmail)
            .maybeSingle();

        if (data) {
            setQuotaValue(data.max_businesses || 1);
        } else {
            setQuotaValue(1);
        }
        setQuotaLoading(false);
    };

    const handleSaveQuota = async () => {
        setProcessing(true);
        
        // Ensure user_permissions row exists
        const { data: existing } = await supabase
            .from("user_permissions")
            .select("id")
            .eq("email", quotaUserEmail)
            .maybeSingle();

        let error;
        if (existing) {
            const res = await supabase
                .from("user_permissions")
                .update({ max_businesses: quotaValue })
                .eq("email", quotaUserEmail);
            error = res.error;
        } else {
            // Need to insert with the real auth user id. But we might not have it in business_users directly if we use business_users.id (which is business_user id).
            // Actually, we don't have the auth user ID easily available here. Let's just alert if they are not in user_permissions.
            // But wait, user_permissions has the auth ID.
            alert("User not found in permissions table. They need to login first.");
            setProcessing(false);
            return;
        }

        if (!error) {
            await logAuditAction("USER_QUOTA_CHANGED", "User", quotaUserEmail, { 
                email: quotaUserEmail, 
                new_quota: quotaValue 
            });
            setIsQuotaOpen(false);
        } else {
            alert("Error updating quota: " + error.message);
        }
        setProcessing(false);
    };

    const handleRevokeAccess = async () => {
        if (!selectedUser) return;
        setProcessing(true);

        // Prevent deleting the only owner
        if (selectedUser.role === "owner") {
            const ownerCount = users.filter(u => u.business_id === selectedUser.business_id && u.role === "owner").length;
            if (ownerCount <= 1) {
                alert("Cannot revoke access from the only owner of this business. Add another owner first.");
                setProcessing(false);
                setIsRevokeOpen(false);
                return;
            }
        }

        const { error } = await supabase
            .from("business_users")
            .delete()
            .eq("id", selectedUser.id);

        if (!error) {
            await logAuditAction("USER_REVOKED", "User", selectedUser.id, { 
                email: selectedUser.user_email, 
                business: selectedUser.businesses?.name 
            });
            fetchUsers();
        } else {
            alert("Error revoking access: " + error.message);
        }
        
        setProcessing(false);
        setIsRevokeOpen(false);
        setSelectedUser(null);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Platform Users</h1>
                <p className="text-muted-foreground">Directory of all users across all tenant stores.</p>
            </div>


            {/* Quota Dialog */}
            <Dialog open={isQuotaOpen} onOpenChange={setIsQuotaOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Business Quota</DialogTitle>
                        <DialogDescription>
                            Set the maximum number of business profiles <strong>{quotaUserEmail}</strong> can create.
                        </DialogDescription>
                    </DialogHeader>
                    {quotaLoading ? (
                        <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                    ) : (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Max Businesses</Label>
                                <Input 
                                    type="number" 
                                    min="1" 
                                    value={quotaValue} 
                                    onChange={(e) => setQuotaValue(parseInt(e.target.value) || 1)} 
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsQuotaOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveQuota} disabled={processing || quotaLoading}>
                            {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Revoke Dialog */}
            <Dialog open={isRevokeOpen} onOpenChange={setIsRevokeOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-red-600 flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5" />
                            Revoke Access
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to revoke <strong>{selectedUser?.user_email}</strong>'s access to <strong>{selectedUser?.businesses?.name}</strong>?
                            They will no longer be able to log in to this store.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsRevokeOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleRevokeAccess} disabled={processing}>
                            {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Revoke Access
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        User Directory
                    </CardTitle>
                    <CardDescription>
                        A comprehensive list of every team member and store owner registered on the platform.
                    </CardDescription>
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
                                        <TableHead>Email</TableHead>
                                        <TableHead>Store</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Joined</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {users.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center p-8 text-muted-foreground">
                                                No users found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        users.map((user) => (
                                            <TableRow key={user.id}>
                                                <TableCell className="font-medium">{user.user_email}</TableCell>
                                                <TableCell>{user.businesses?.name || "Unknown"}</TableCell>
                                                <TableCell>
                                                    <Select value={user.role} onValueChange={(val) => handleChangeRole(user.id, val)}>
                                                        <SelectTrigger className="w-[130px] h-8 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="owner">Owner</SelectItem>
                                                            <SelectItem value="manager">Manager</SelectItem>
                                                            <SelectItem value="staff">Staff</SelectItem>
                                                            <SelectItem value="accountant">Accountant</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                                <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button 
                                                            variant="ghost" 
                                                            size="sm" 
                                                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                            onClick={() => handleOpenQuota(user.user_email, user.id)}
                                                            title="Edit Quota"
                                                        >
                                                            <Edit3 className="h-4 w-4" />
                                                        </Button>
                                                        <Button 
                                                            variant="ghost" 
                                                            size="sm" 
                                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                            onClick={() => {
                                                                setSelectedUser(user);
                                                                setIsRevokeOpen(true);
                                                            }}
                                                            title="Revoke Access"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
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
