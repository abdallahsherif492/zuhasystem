const fs = require('fs');
let content = fs.readFileSync('src/app/system-admin/users/page.tsx', 'utf8');

// 1. Add required imports
content = content.replace(
    'import { Loader2, Users, ShieldAlert, Trash2 } from "lucide-react";',
    'import { Loader2, Users, ShieldAlert, Trash2, Edit3 } from "lucide-react";\nimport { Input } from "@/components/ui/input";\nimport { Label } from "@/components/ui/label";'
);

// 2. Add Quota Modal State
content = content.replace(
    '    const [processing, setProcessing] = useState(false);',
    `    const [processing, setProcessing] = useState(false);

    // Quota state
    const [isQuotaOpen, setIsQuotaOpen] = useState(false);
    const [quotaLoading, setQuotaLoading] = useState(false);
    const [quotaValue, setQuotaValue] = useState(1);
    const [quotaUserEmail, setQuotaUserEmail] = useState("");
    const [quotaUserId, setQuotaUserId] = useState("");`
);

// 3. Add handleOpenQuota and handleSaveQuota
const quotaFunctions = `
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
`;

content = content.replace(
    '    const handleRevokeAccess = async () => {',
    quotaFunctions + '\n    const handleRevokeAccess = async () => {'
);

// 4. Add Quota Modal UI
const quotaModalUI = `
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
`;

content = content.replace(
    '            {/* Revoke Dialog */}',
    quotaModalUI + '\n            {/* Revoke Dialog */}'
);

// 5. Add Quota Button to Table
const actionButtons = `
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
`;

content = content.replace(
    /<TableCell className="text-right">\s*<Button[\s\S]*?<\/Button>\s*<\/TableCell>/g,
    '<TableCell className="text-right">' + actionButtons + '</TableCell>'
);

fs.writeFileSync('src/app/system-admin/users/page.tsx', content);
