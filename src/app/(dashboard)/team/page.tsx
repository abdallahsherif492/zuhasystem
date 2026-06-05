"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Users, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type BusinessUser = {
    id: string;
    user_email: string;
    role: string;
    created_at: string;
};

export default function TeamManagementPage() {
    const { activeBusiness } = useBusiness();
    const [team, setTeam] = useState<BusinessUser[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Add user state
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState("staff");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (activeBusiness) {
            fetchTeam();
        }
    }, [activeBusiness]);

    async function fetchTeam() {
        if (!activeBusiness) return;
        if (!activeBusiness) return;
        setLoading(true);
        const { data, error } = await supabase
            .from("business_users")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setTeam(data as BusinessUser[]);
        }
        setLoading(false);
    }

    async function handleAddMember(e: React.FormEvent) {
        e.preventDefault();
        if (!activeBusiness) return;
        setSaving(true);

        const { error } = await supabase
            .from("business_users")
            .insert({
                business_id: activeBusiness.id,
                user_email: newEmail.toLowerCase().trim(),
                role: newRole
            });

        setSaving(false);
        if (error) {
            toast.error("Failed to add team member: " + error.message);
        } else {
            toast.success("Team member added! They can now sign up using this email.");
            setIsAddOpen(false);
            setNewEmail("");
            setNewRole("staff");
            fetchTeam();
        }
    }

    async function handleRemoveMember(id: string, role: string) {
        if (role === "owner") {
            const ownerCount = team.filter(t => t.role === "owner").length;
            if (ownerCount <= 1) {
                toast.error("You cannot remove the only owner of the business.");
                return;
            }
        }

        if (!confirm("Are you sure you want to remove this team member?")) return;

        const { error } = await supabase
            .from("business_users")
            .delete()
            .eq("id", id);

        if (error) {
            toast.error("Failed to remove member: " + error.message);
        } else {
            toast.success("Member removed successfully.");
            fetchTeam();
        }
    }

    async function handleChangeRole(id: string, newRole: string) {
        const member = team.find(t => t.id === id);
        if (!member) return;

        if (member.role === "owner" && newRole !== "owner") {
            const ownerCount = team.filter(t => t.role === "owner").length;
            if (ownerCount <= 1) {
                toast.error("You cannot change the role of the only owner.");
                return;
            }
        }

        const { error } = await supabase
            .from("business_users")
            .update({ role: newRole })
            .eq("id", id);

        if (error) {
            toast.error("Failed to update role: " + error.message);
        } else {
            toast.success("Role updated successfully.");
            fetchTeam();
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Team Management</h1>
                    <p className="text-muted-foreground mt-1">Manage your staff, cashiers, and managers.</p>
                </div>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <UserPlus className="mr-2 h-4 w-4" /> Add Member
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add Team Member</DialogTitle>
                            <DialogDescription>
                                Enter their email. If they don't have an account, tell them to sign up with this email.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleAddMember} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email Address</label>
                                <Input 
                                    type="email" 
                                    placeholder="staff@example.com" 
                                    value={newEmail} 
                                    onChange={e => setNewEmail(e.target.value)} 
                                    required 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Role</label>
                                <Select value={newRole} onValueChange={setNewRole}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="owner">Owner</SelectItem>
                                        <SelectItem value="manager">Manager</SelectItem>
                                        <SelectItem value="accountant">Accountant</SelectItem>
                                        <SelectItem value="staff">Staff (Cashier)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                                <Button type="submit" disabled={saving}>
                                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Send Invite
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        Current Team
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Added On</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {team.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center p-8 text-muted-foreground">
                                        No team members found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                team.map((member) => (
                                    <TableRow key={member.id}>
                                        <TableCell className="font-medium">{member.user_email}</TableCell>
                                        <TableCell>
                                            <Select 
                                                value={["owner", "manager", "staff", "accountant"].includes(member.role?.toLowerCase()) ? member.role.toLowerCase() : ""} 
                                                onValueChange={(val) => handleChangeRole(member.id, val)}
                                            >
                                                <SelectTrigger className="w-[130px] h-8 text-xs">
                                                    <SelectValue placeholder={member.role || "Select role"} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="owner">Owner</SelectItem>
                                                    <SelectItem value="manager">Manager</SelectItem>
                                                    <SelectItem value="accountant">Accountant</SelectItem>
                                                    <SelectItem value="staff">Staff</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>{new Date(member.created_at).toLocaleDateString()}</TableCell>
                                        <TableCell className="text-right">
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => handleRemoveMember(member.id, member.role)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
