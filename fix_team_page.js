const fs = require('fs');
const file = 'src/app/(dashboard)/team/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// The new imports
const newImports = `
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
`;
content = content.replace('import { Badge } from "@/components/ui/badge";', newImports + 'import { Badge } from "@/components/ui/badge";');

// Update BusinessUser type
const newType = `type BusinessUser = {
    id: string;
    user_email: string;
    role: string;
    allowed_pages: string[];
    shift_start: string | null;
    shift_end: string | null;
    weekend_days: string[];
    created_at: string;
};`;
content = content.replace(/type BusinessUser = \{[\s\S]*?\};/, newType);

// Add state variables
const stateVars = `
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState("staff");
    const [newAllowedPages, setNewAllowedPages] = useState<string[]>([]);
    const [newShiftStart, setNewShiftStart] = useState("09:00");
    const [newShiftEnd, setNewShiftEnd] = useState("17:00");
    const [newWeekendDays, setNewWeekendDays] = useState<string[]>(["Friday"]);
    const [saving, setSaving] = useState(false);

    const availablePages = [
        { id: "/dashboard", label: "Dashboard" },
        { id: "/orders", label: "Orders" },
        { id: "/products", label: "Products" },
        { id: "/inventory", label: "Inventory" },
        { id: "/customers", label: "Customers" },
        { id: "/purchases", label: "Purchases" },
        { id: "/accounting", label: "Accounting" },
        { id: "/shipping", label: "Shipping" },
        { id: "/logistics", label: "Logistics" },
        { id: "/payable", label: "Accounts Payable" },
        { id: "/ads", label: "Ads Spent" },
        { id: "/insights", label: "Insights" }
    ];

    const weekDays = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
`;
content = content.replace(/const \[isAddOpen, setIsAddOpen\] = useState\(false\);[\s\S]*?const \[saving, setSaving\] = useState\(false\);/, stateVars);

// Update insert logic
const insertLogic = `
        const { error } = await supabase
            .from("business_users")
            .insert({
                business_id: activeBusiness.id,
                user_email: newEmail.toLowerCase().trim(),
                role: newRole,
                allowed_pages: newRole === 'owner' || newRole === 'admin' ? [] : newAllowedPages,
                shift_start: newShiftStart,
                shift_end: newShiftEnd,
                weekend_days: newWeekendDays
            });
`;
content = content.replace(/const { error } = await supabase[\s\S]*?role: newRole\n\s*\}\);/g, insertLogic);

// Update form UI
const formUI = `
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
                            
                            {newRole !== 'owner' && newRole !== 'admin' && (
                                <div className="space-y-4 border p-4 rounded-md">
                                    <h4 className="text-sm font-semibold">Permissions (Allowed Pages)</h4>
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
                                    
                                    <h4 className="text-sm font-semibold mt-4">Shift & Working Hours</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Start Time</Label>
                                            <Input type="time" value={newShiftStart} onChange={e => setNewShiftStart(e.target.value)} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">End Time</Label>
                                            <Input type="time" value={newShiftEnd} onChange={e => setNewShiftEnd(e.target.value)} />
                                        </div>
                                    </div>
                                    
                                    <h4 className="text-sm font-semibold mt-4">Weekend Days (Holidays)</h4>
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
`;

content = content.replace(/<div className="space-y-2">\s*<label className="text-sm font-medium">Role<\/label>[\s\S]*?<\/Select>\s*<\/div>/, formUI);

fs.writeFileSync(file, content);
console.log("Team page modified.");
