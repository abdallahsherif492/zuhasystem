const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/team/page.tsx', 'utf8');

// 1. Add Edit2 icon
content = content.replace(
    'import { Loader2, Users, UserPlus, Trash2 } from "lucide-react";',
    'import { Loader2, Users, UserPlus, Trash2, Edit2 } from "lucide-react";'
);

// 2. Add edit state
content = content.replace(
    'const [saving, setSaving] = useState(false);',
    'const [saving, setSaving] = useState(false);\n    const [editingMember, setEditingMember] = useState<BusinessUser | null>(null);\n    const [editSaving, setEditSaving] = useState(false);'
);

// 3. Replace handleChangeRole with handleSaveEdit
content = content.replace(
    /async function handleChangeRole\([\s\S]*?fetchTeam\(\);\n        \}\n    \}/,
    `async function handleSaveEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editingMember) return;
        
        if (team.find(t => t.id === editingMember.id)?.role === "owner" && editingMember.role !== "owner") {
            const ownerCount = team.filter(t => t.role === "owner").length;
            if (ownerCount <= 1) {
                toast.error("You cannot change the role of the only owner.");
                return;
            }
        }

        setEditSaving(true);
        const { error } = await supabase.from("business_users").update({
            role: editingMember.role,
            allowed_pages: editingMember.role === 'owner' || editingMember.role === 'admin' ? [] : editingMember.allowed_pages,
            shift_start: editingMember.shift_start || null,
            shift_end: editingMember.shift_end || null,
            weekend_days: editingMember.weekend_days
        }).eq("id", editingMember.id);
        
        setEditSaving(false);
        if (error) toast.error("Failed to update member: " + error.message);
        else {
            toast.success("Member updated successfully.");
            setEditingMember(null);
            fetchTeam();
        }
    }`
);

// 4. Replace inline select with text and edit button
content = content.replace(
    /<TableCell>\s*<Select[\s\S]*?<\/Select>\s*<\/TableCell>/g,
    '<TableCell className="capitalize">{member.role}</TableCell>'
);

content = content.replace(
    /<TableCell className="text-right">\s*<Button/g,
    `<TableCell className="text-right">
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="text-muted-foreground hover:text-foreground mr-2"
                                                onClick={() => setEditingMember(member)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button`
);

// 5. Add Dialog for editing below the add dialog
const editDialog = `
                <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit Team Member</DialogTitle>
                            <DialogDescription>Update permissions, role, and working hours.</DialogDescription>
                        </DialogHeader>
                        {editingMember && (
                        <form onSubmit={handleSaveEdit} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Role</label>
                                <Select value={editingMember.role} onValueChange={v => setEditingMember({...editingMember, role: v})}>
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
                            
                            {editingMember.role !== 'owner' && editingMember.role !== 'admin' && (
                                <div className="space-y-4 border p-4 rounded-md">
                                    <h4 className="text-sm font-semibold">Permissions (Allowed Pages)</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {availablePages.map(page => (
                                            <div key={page.id} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={"edit-"+page.id} 
                                                    checked={editingMember.allowed_pages?.includes(page.id)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setEditingMember({...editingMember, allowed_pages: [...(editingMember.allowed_pages||[]), page.id]});
                                                        } else {
                                                            setEditingMember({...editingMember, allowed_pages: (editingMember.allowed_pages||[]).filter(p => p !== page.id)});
                                                        }
                                                    }}
                                                />
                                                <Label htmlFor={"edit-"+page.id} className="text-xs">{page.label}</Label>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">Shift & Working Hours</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Start Time</Label>
                                            <Input type="time" value={editingMember.shift_start || ""} onChange={e => setEditingMember({...editingMember, shift_start: e.target.value})} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">End Time</Label>
                                            <Input type="time" value={editingMember.shift_end || ""} onChange={e => setEditingMember({...editingMember, shift_end: e.target.value})} />
                                        </div>
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">Weekend Days (Holidays)</h4>
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
                                <Button type="button" variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button>
                                <Button type="submit" disabled={editSaving}>
                                    {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Save Changes
                                </Button>
                            </DialogFooter>
                        </form>
                        )}
                    </DialogContent>
                </Dialog>
`;

content = content.replace(
    '</DialogContent>\n                </Dialog>\n            </div>',
    '</DialogContent>\n                </Dialog>\n' + editDialog + '\n            </div>'
);

fs.writeFileSync('src/app/(dashboard)/team/page.tsx', content);
