"use client";

import { updateTeamMemberAction } from "./actions";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Users, UserPlus, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";

type BusinessUser = {
    id: string;
    user_email: string;
    role: string;
    allowed_pages: string[];
    shift_start: string | null;
    shift_end: string | null;
    weekend_days: string[];
    created_at: string;
};

export default function TeamManagementPage() {
    const { activeBusiness } = useBusiness();
    const { t } = useLanguage();
    const [team, setTeam] = useState<BusinessUser[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Add user state
    
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState("staff");
    const [newAllowedPages, setNewAllowedPages] = useState<string[]>([]);
    const [newShiftStart, setNewShiftStart] = useState("09:00");
    const [newShiftEnd, setNewShiftEnd] = useState("17:00");
    const [newWeekendDays, setNewWeekendDays] = useState<string[]>(["Friday"]);
    const [saving, setSaving] = useState(false);
    const [editingMember, setEditingMember] = useState<BusinessUser | null>(null);
    const [editSaving, setEditSaving] = useState(false);

    const availablePages = [
        { id: "/dashboard", label: t("Dashboard") },
        { id: "/orders", label: t("Orders") },
        { id: "/easy-orders", label: t("Easy Orders") },
        { id: "/products", label: t("Products") },
        { id: "/inventory", label: t("Inventory") },
        { id: "/customers", label: t("Customers") },
        { id: "/purchases", label: t("Purchases") },
        { id: "/accounting", label: t("Accounting") },
        { id: "/shipping", label: t("Shipping") },
        { id: "/logistics", label: t("Logistics") },
        { id: "/payable", label: t("Accounts Payable") },
        { id: "/ads", label: t("Ads Spent") },
        { id: "/insights", label: t("Insights") }
    ];

    const weekDays = [t("Saturday"), t("Sunday"), t("Monday"), t("Tuesday"), t("Wednesday"), t("Thursday"), t("Friday")];


    useEffect(() => {
        if (activeBusiness) {
            fetchTeam();
        }
    }, [activeBusiness]);

    async function fetchTeam() {
        if (!activeBusiness) return;
        setLoading(true);
        const { data, error } = await supabase
            .from("business_users")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .order("created_at", { ascending: false });

        if (error) console.error("Error fetching team:", error);
        console.log("=== DEBUG: Fetched Team Data ===");
        console.log("Team data from DB:", data);
        setTeam((data as BusinessUser[]) || []);
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
                role: newRole,
                allowed_pages: newRole === 'owner' || newRole === 'admin' ? [] : newAllowedPages,
                shift_start: newShiftStart || null,
                shift_end: newShiftEnd || null,
                weekend_days: newWeekendDays
            });


        setSaving(false);
        if (error) {
            console.error("Supabase Insert Error:", error);
            toast.error("Failed to add team member: " + error.message);
        } else {
            toast.success("Team member added successfully! They can access the system immediately after creating an account with this email.");
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

    async function handleSaveEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editingMember) return;
        
        console.log("=== DEBUG: Saving Edit ===");
        console.log("editingMember full object before save:", editingMember);
        
        if (team.find(t => t.id === editingMember.id)?.role === "owner" && editingMember.role !== "owner") {
            const ownerCount = team.filter(t => t.role === "owner").length;
            if (ownerCount <= 1) {
                toast.error("You cannot change the role of the only owner.");
                return;
            }
        }

        const updatesToSend = {
            role: editingMember.role || 'staff',
            allowed_pages: editingMember.role === 'owner' || editingMember.role === 'super admin' ? [] : (editingMember.allowed_pages || []),
            shift_start: editingMember.shift_start || null,
            shift_end: editingMember.shift_end || null,
            weekend_days: editingMember.weekend_days || []
        };
        console.log("Updates payload being sent to server action:", updatesToSend);

        setEditSaving(true);
        const result = await updateTeamMemberAction(editingMember.id, editingMember.user_email, activeBusiness?.id || '', updatesToSend);
        console.log("Result received from server action:", result);
        
        setEditSaving(false);
        if (result.error) {
            console.error("Server Action returned an error:", result.error);
            toast.error("Failed to update member: " + result.error);
        } else {
            console.log("Server Action Success! Debug Message:", result.debug);
            toast.success("✅ Member updated successfully (V4). " + (result.debug || ""));
            if (result.data && result.data.length > 0) {
                console.log("Data returned from server:", result.data[0]);
                setTeam(prev => prev.map(m => m.id === editingMember.id ? result.data![0] as BusinessUser : m));
            } else {
                console.warn("Server action returned success but empty data array.");
                toast.error("Warning: Member was not found or updated in the database.");
                fetchTeam();
            }
            setEditingMember(null);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t("Team Management")}</h1>
                    <p className="text-muted-foreground mt-1">{t("Manage your staff, cashiers, and managers.")}</p>
                </div>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <UserPlus className="mr-2 h-4 w-4" /> {t("Add Member")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t("Add Team Member")}</DialogTitle>
                            <DialogDescription>
                                {t("Enter their email. If they don't have an account, tell them to sign up with this email.")}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleAddMember} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t("Email Address")}</label>
                                <Input 
                                    type="email" 
                                    placeholder="staff@example.com" 
                                    value={newEmail} 
                                    onChange={e => setNewEmail(e.target.value)} 
                                    required 
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t("Role")}</label>
                                <Select value={newRole} onValueChange={setNewRole}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="owner">{t("Owner")}</SelectItem>
                                        <SelectItem value="super admin">{t("Super Admin")}</SelectItem>
                                        <SelectItem value="staff">{t("Staff")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            
                            {newRole !== 'owner' && newRole !== 'super admin' && (
                                <div className="space-y-4 border p-4 rounded-md">
                                    <h4 className="text-sm font-semibold">{t("Permissions (Allowed Pages)")}</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {availablePages.map(page => (
                                            <div key={page.id} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={page.id} 
                                                    checked={newAllowedPages.includes(page.id)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setNewAllowedPages([...newAllowedPages, page.id]);
                                                        } else {
                                                            setNewAllowedPages(newAllowedPages.filter(p => p !== page.id));
                                                        }
                                                    }}
                                                />
                                                <Label htmlFor={page.id} className="text-xs">{page.label}</Label>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">{t("Shift & Working Hours")}</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label className="text-xs">{t("Start Time")}</Label>
                                            <Input type="time" value={newShiftStart} onChange={e => setNewShiftStart(e.target.value)} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">{t("End Time")}</Label>
                                            <Input type="time" value={newShiftEnd} onChange={e => setNewShiftEnd(e.target.value)} />
                                        </div>
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">{t("Weekend Days (Holidays)")}</h4>
                                    <div className="grid grid-cols-3 gap-2">
                                        {weekDays.map(day => (
                                            <div key={day} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={day} 
                                                    checked={newWeekendDays.includes(day)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setNewWeekendDays([...newWeekendDays, day]);
                                                        } else {
                                                            setNewWeekendDays(newWeekendDays.filter(d => d !== day));
                                                        }
                                                    }}
                                                />
                                                <Label htmlFor={day} className="text-xs">{day}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>{t("Cancel")}</Button>
                                <Button type="submit" disabled={saving}>
                                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t("Add Member")}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t("Edit Team Member")}</DialogTitle>
                            <DialogDescription>{t("Update permissions, role, and working hours.")}</DialogDescription>
                        </DialogHeader>
                        {editingMember && (
                        <form onSubmit={handleSaveEdit} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t("Role")}</label>
                                <Select value={editingMember.role} onValueChange={v => setEditingMember({...editingMember, role: v})}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="owner">{t("Owner")}</SelectItem>
                                        <SelectItem value="super admin">{t("Super Admin")}</SelectItem>
                                        <SelectItem value="staff">{t("Staff")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            
                            {editingMember.role !== 'owner' && editingMember.role !== 'super admin' && (
                                <div className="space-y-4 border p-4 rounded-md">
                                    <h4 className="text-sm font-semibold">{t("Permissions (Allowed Pages)")}</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {availablePages.map(page => (
                                            <div key={page.id} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={"edit-"+page.id} 
                                                    checked={editingMember.allowed_pages?.includes(page.id)}
                                                    onCheckedChange={(checked) => {
                                                        let newAllowedPages = [];
                                                        if (checked) {
                                                            newAllowedPages = [...(editingMember.allowed_pages||[]), page.id];
                                                        } else {
                                                            newAllowedPages = (editingMember.allowed_pages||[]).filter(p => p !== page.id);
                                                        }
                                                        console.log("=== DEBUG: Permission Toggled ===");
                                                        console.log(`Toggled page: ${page.id}, Checked: ${checked}`);
                                                        console.log("New allowed_pages array:", newAllowedPages);
                                                        setEditingMember({...editingMember, allowed_pages: newAllowedPages});
                                                    }}
                                                />
                                                <Label htmlFor={"edit-"+page.id} className="text-xs">{page.label}</Label>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">{t("Shift & Working Hours")}</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label className="text-xs">{t("Start Time")}</Label>
                                            <Input type="time" value={editingMember.shift_start || ""} onChange={e => setEditingMember({...editingMember, shift_start: e.target.value})} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">{t("End Time")}</Label>
                                            <Input type="time" value={editingMember.shift_end || ""} onChange={e => setEditingMember({...editingMember, shift_end: e.target.value})} />
                                        </div>
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">{t("Weekend Days (Holidays)")}</h4>
                                    <div className="grid grid-cols-3 gap-2">
                                        {weekDays.map(day => (
                                            <div key={"edit-"+day} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={"edit-"+day} 
                                                    checked={editingMember.weekend_days?.includes(day)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setEditingMember({...editingMember, weekend_days: [...(editingMember.weekend_days||[]), day]});
                                                        } else {
                                                            setEditingMember({...editingMember, weekend_days: (editingMember.weekend_days||[]).filter(d => d !== day)});
                                                        }
                                                    }}
                                                />
                                                <Label htmlFor={"edit-"+day} className="text-xs">{day}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setEditingMember(null)}>{t("Cancel")}</Button>
                                <Button type="submit" disabled={editSaving}>
                                    {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t("Save Changes")}
                                </Button>
                            </DialogFooter>
                        </form>
                        )}
                    </DialogContent>
                </Dialog>

            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        {t("Current Team")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("Email Address")}</TableHead>
                                <TableHead>{t("Role")}</TableHead>
                                <TableHead>{t("Added On")}</TableHead>
                                <TableHead className="text-right">{t("Actions")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {team.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center p-8 text-muted-foreground">
                                        {t("No team members found.")}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                team.map((member) => (
                                    <TableRow key={member.id}>
                                        <TableCell className="font-medium">{member.user_email}</TableCell>
                                        <TableCell className="capitalize">{member.role}</TableCell>
                                        <TableCell>{new Date(member.created_at).toLocaleDateString()}</TableCell>
                                        <TableCell className="text-right">
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="text-muted-foreground hover:text-foreground mr-2"
                                                onClick={() => setEditingMember(member)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
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
