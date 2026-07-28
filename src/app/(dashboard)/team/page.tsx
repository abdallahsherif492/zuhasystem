"use client";

import { updateTeamMemberAction, addTeamMemberAction } from "./actions";
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
import { Loader2, Users, UserPlus, Trash2, Edit2, Shield, Clock, Key, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
        { id: "/platform-orders", label: t("Platform Orders") },
        { id: "/products", label: t("Products") },
        { id: "/inventory", label: t("Inventory") },
        { id: "/customers", label: t("Customers") },
        { id: "/purchases", label: t("Purchases") },
        { id: "/accounting", label: t("Accounting") },
        { id: "/shipping", label: t("Shipping") },
        { id: "/logistics", label: t("Logistics") },
        { id: "/payable", label: t("Accounts Payable") },
        { id: "/ads", label: t("Ads Spent") },
        { id: "/insights", label: t("Insights") },
        { id: "/actions-log", label: t("Actions Log") }
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
        setTeam((data as BusinessUser[]) || []);
        setLoading(false);
    }

    async function handleAddMember(e: React.FormEvent) {
        e.preventDefault();
        if (!activeBusiness) return;
        setSaving(true);

        const result = await addTeamMemberAction({
            business_id: activeBusiness.id,
            user_email: newEmail.toLowerCase().trim(),
            role: newRole,
            allowed_pages: newRole === 'owner' || newRole === 'admin' || newRole === 'super admin' ? [] : newAllowedPages,
            shift_start: newShiftStart || null,
            shift_end: newShiftEnd || null,
            weekend_days: newWeekendDays
        });

        setSaving(false);
        if (result.error) {
            toast.error("Failed to add team member: " + result.error);
        } else {
            toast.success("Team member added successfully.");
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

        if (!confirm(t("Are you sure you want to remove this team member?"))) return;

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

        if (team.find(t => t.id === editingMember.id)?.role === "owner" && editingMember.role !== "owner") {
            const ownerCount = team.filter(t => t.role === "owner").length;
            if (ownerCount <= 1) {
                toast.error("You cannot change the role of the only owner.");
                return;
            }
        }

        const updatesToSend = {
            role: editingMember.role || 'staff',
            allowed_pages: editingMember.role === 'owner' || editingMember.role === 'super admin' || editingMember.role === 'admin' ? [] : (editingMember.allowed_pages || []),
            shift_start: editingMember.shift_start || null,
            shift_end: editingMember.shift_end || null,
            weekend_days: editingMember.weekend_days || []
        };

        setEditSaving(true);
        const result = await updateTeamMemberAction(editingMember.id, editingMember.user_email, activeBusiness?.id || '', updatesToSend);
        
        setEditSaving(false);
        if (result.error) {
            toast.error("Failed to update member: " + result.error);
        } else {
            toast.success("Member updated successfully.");
            if (result.data && result.data.length > 0) {
                setTeam(prev => prev.map(m => m.id === editingMember.id ? result.data![0] as BusinessUser : m));
            } else {
                fetchTeam();
            }
            setEditingMember(null);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    // Role helper badges
    const getRoleBadge = (role: string) => {
        const r = role.toLowerCase();
        if (r === 'owner') return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 font-bold">{t("Owner")}</Badge>;
        if (r === 'super admin' || r === 'admin') return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 font-bold">{t("Super Admin")}</Badge>;
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold">{t("Staff")}</Badge>;
    };

    // Calculate Summary Metrics
    const totalMembers = team.length;
    const ownersAdminsCount = team.filter(m => m.role === 'owner' || m.role === 'admin' || m.role === 'super admin').length;
    const staffCount = team.filter(m => m.role !== 'owner' && m.role !== 'admin' && m.role !== 'super admin').length;

    return (
        <div className="space-y-6 max-w-6xl mx-auto font-sans">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                        <Users className="h-7 w-7 text-primary" />
                        {t("Team Management")}
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">{t("Manage your staff, cashiers, and managers.")}</p>
                </div>
                
                {/* Add Member Button Dialog */}
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button id="add-team-member-btn" className="bg-primary hover:bg-primary/90 gap-2 text-xs font-semibold shadow-sm">
                            <UserPlus className="h-4 w-4" /> {t("Add Member")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto custom-scrollbar">
                        <DialogHeader>
                            <DialogTitle className="text-base font-bold flex items-center gap-2">
                                <UserPlus className="h-5 w-5 text-primary" />
                                {t("Add Team Member")}
                            </DialogTitle>
                            <DialogDescription className="text-xs">
                                {t("Enter their email. If they don't have an account, tell them to sign up with this email.")}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleAddMember} className="space-y-4 pt-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-medium">{t("Email Address")}</Label>
                                <Input 
                                    type="email" 
                                    placeholder="staff@example.com" 
                                    value={newEmail} 
                                    onChange={e => setNewEmail(e.target.value)} 
                                    required 
                                    className="h-10 text-xs"
                                />
                            </div>
                            
                            <div className="space-y-1.5">
                                <Label className="text-xs font-medium">{t("Role")}</Label>
                                <Select value={newRole} onValueChange={setNewRole}>
                                    <SelectTrigger className="h-10 text-xs">
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
                                <div className="space-y-4 border p-4 rounded-xl bg-muted/20">
                                    <div>
                                        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                                            <Key className="h-3.5 w-3.5 text-primary" />
                                            {t("Permissions (Allowed Pages)")}
                                        </h4>
                                        <div className="grid grid-cols-2 gap-2">
                                            {availablePages.map(page => (
                                                <div key={page.id} className="flex items-center space-x-2 bg-background/80 p-2 rounded-lg border border-border/50">
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
                                                    <Label htmlFor={page.id} className="text-xs font-normal cursor-pointer">{page.label}</Label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                                            <Clock className="h-3.5 w-3.5 text-primary" />
                                            {t("Shift & Working Hours")}
                                        </h4>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">{t("Start Time")}</Label>
                                                <Input type="time" className="h-9 text-xs" value={newShiftStart} onChange={e => setNewShiftStart(e.target.value)} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">{t("End Time")}</Label>
                                                <Input type="time" className="h-9 text-xs" value={newShiftEnd} onChange={e => setNewShiftEnd(e.target.value)} />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                                            <Calendar className="h-3.5 w-3.5 text-primary" />
                                            {t("Weekend Days (Holidays)")}
                                        </h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            {weekDays.map(day => (
                                                <div key={day} className="flex items-center space-x-2 bg-background/80 p-2 rounded-lg border border-border/50">
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
                                                    <Label htmlFor={day} className="text-xs font-normal cursor-pointer">{day}</Label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <DialogFooter className="pt-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>{t("Cancel")}</Button>
                                <Button type="submit" size="sm" disabled={saving}>
                                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t("Add Member")}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Top Summary Metrics */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-primary uppercase tracking-wider">{t("Total Members")}</CardTitle>
                        <Users className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-foreground">{totalMembers}</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{t("Active team accounts")}</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border-purple-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">{t("Owners & Admins")}</CardTitle>
                        <Shield className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-purple-900 dark:text-purple-100">{ownersAdminsCount}</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{t("Full administrative access")}</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t("Staff Members")}</CardTitle>
                        <Users className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-emerald-900 dark:text-emerald-100">{staffCount}</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{t("Role-based page permissions")}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Team Table */}
            <Card className="shadow-sm border border-border/60">
                <CardHeader className="border-b pb-4">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        {t("Current Team")}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40 text-xs">
                                <TableHead>{t("Member")}</TableHead>
                                <TableHead>{t("Role")}</TableHead>
                                <TableHead>{t("Shift")}</TableHead>
                                <TableHead>{t("Permitted Pages")}</TableHead>
                                <TableHead className="text-right">{t("Actions")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="divide-y">
                            {team.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center p-8 text-xs text-muted-foreground">
                                        {t("No team members found.")}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                team.map((member) => {
                                    const emailPrefix = member.user_email.substring(0, 2).toUpperCase();
                                    const isFullAccess = member.role === 'owner' || member.role === 'admin' || member.role === 'super admin';

                                    return (
                                        <TableRow key={member.id} className="hover:bg-muted/20 text-xs">
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-8 w-8 bg-primary/10 text-primary border border-primary/20">
                                                        <AvatarFallback className="font-bold text-xs">{emailPrefix}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-semibold text-xs text-foreground">{member.user_email}</p>
                                                        <p className="text-[10px] text-muted-foreground">Added: {new Date(member.created_at).toLocaleDateString()}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {getRoleBadge(member.role)}
                                            </TableCell>
                                            <TableCell>
                                                {member.shift_start && member.shift_end ? (
                                                    <Badge variant="outline" className="text-[10px] font-mono gap-1">
                                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                                        {member.shift_start} - {member.shift_end}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-[11px] text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {isFullAccess ? (
                                                    <Badge variant="secondary" className="text-[10px] font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300">
                                                        {t("All Pages Access")}
                                                    </Badge>
                                                ) : member.allowed_pages && member.allowed_pages.length > 0 ? (
                                                    <div className="flex flex-wrap gap-1 max-w-[280px]">
                                                        {member.allowed_pages.slice(0, 3).map(path => {
                                                            const pObj = availablePages.find(p => p.id === path);
                                                            return (
                                                                <Badge key={path} variant="outline" className="text-[10px]">
                                                                    {pObj?.label || path}
                                                                </Badge>
                                                            );
                                                        })}
                                                        {member.allowed_pages.length > 3 && (
                                                            <Badge variant="outline" className="text-[10px] bg-muted">
                                                                +{member.allowed_pages.length - 3}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-muted-foreground">{t("No pages assigned")}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground mr-1"
                                                    onClick={() => setEditingMember(member)}
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </Button>
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => handleRemoveMember(member.id, member.role)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Edit Dialog Modal */}
            <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader>
                        <DialogTitle className="text-base font-bold flex items-center gap-2">
                            <Edit2 className="h-5 w-5 text-primary" />
                            {t("Edit Team Member")}
                        </DialogTitle>
                        <DialogDescription className="text-xs">{t("Update permissions, role, and working hours.")}</DialogDescription>
                    </DialogHeader>
                    {editingMember && (
                    <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium">{t("Role")}</Label>
                            <Select value={editingMember.role} onValueChange={v => setEditingMember({...editingMember, role: v})}>
                                <SelectTrigger className="h-10 text-xs">
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
                            <div className="space-y-4 border p-4 rounded-xl bg-muted/20">
                                <div>
                                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                                        <Key className="h-3.5 w-3.5 text-primary" />
                                        {t("Permissions (Allowed Pages)")}
                                    </h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {availablePages.map(page => (
                                            <div key={page.id} className="flex items-center space-x-2 bg-background/80 p-2 rounded-lg border border-border/50">
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
                                                        setEditingMember({...editingMember, allowed_pages: newAllowedPages});
                                                    }}
                                                />
                                                <Label htmlFor={"edit-"+page.id} className="text-xs font-normal cursor-pointer">{page.label}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                
                                <div>
                                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                                        <Clock className="h-3.5 w-3.5 text-primary" />
                                        {t("Shift & Working Hours")}
                                    </h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-[11px] text-muted-foreground">{t("Start Time")}</Label>
                                            <Input type="time" className="h-9 text-xs" value={editingMember.shift_start || ""} onChange={e => setEditingMember({...editingMember, shift_start: e.target.value})} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[11px] text-muted-foreground">{t("End Time")}</Label>
                                            <Input type="time" className="h-9 text-xs" value={editingMember.shift_end || ""} onChange={e => setEditingMember({...editingMember, shift_end: e.target.value})} />
                                        </div>
                                    </div>
                                </div>
                                
                                <div>
                                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                                        <Calendar className="h-3.5 w-3.5 text-primary" />
                                        {t("Weekend Days (Holidays)")}
                                    </h4>
                                    <div className="grid grid-cols-3 gap-2">
                                        {weekDays.map(day => (
                                            <div key={"edit-"+day} className="flex items-center space-x-2 bg-background/80 p-2 rounded-lg border border-border/50">
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
                                                <Label htmlFor={"edit-"+day} className="text-xs font-normal cursor-pointer">{day}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        <DialogFooter className="pt-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => setEditingMember(null)}>{t("Cancel")}</Button>
                            <Button type="submit" size="sm" disabled={editSaving}>
                                {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t("Save Changes")}
                            </Button>
                        </DialogFooter>
                    </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
