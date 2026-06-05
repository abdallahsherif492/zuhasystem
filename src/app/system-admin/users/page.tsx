"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Users, ShieldAlert, Trash2 } from "lucide-react";
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
                                                    <Button 
                                                        variant="ghost" 
                                                        size="sm" 
                                                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                        onClick={() => {
                                                            setSelectedUser(user);
                                                            setIsRevokeOpen(true);
                                                        }}
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
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
