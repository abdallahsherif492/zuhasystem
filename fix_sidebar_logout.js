const fs = require('fs');
let content = fs.readFileSync('src/components/layout/sidebar.tsx', 'utf8');

// Add LogOut to lucide imports
content = content.replace(
    'import { LayoutDashboard, ShoppingCart, Package, Users, Settings, UserPlus, CreditCard, Truck, BarChart3, Target, Calendar, UserCheck, ShieldCheck } from "lucide-react";',
    'import { LayoutDashboard, ShoppingCart, Package, Users, Settings, UserPlus, CreditCard, Truck, BarChart3, Target, Calendar, UserCheck, ShieldCheck, LogOut } from "lucide-react";'
);

// Add supabase import
if (!content.includes('import { supabase }')) {
    content = content.replace(
        'import Link from "next/link";',
        'import Link from "next/link";\nimport { supabase } from "@/lib/supabase";'
    );
}

// Add logout handler inside component
content = content.replace(
    'export function Sidebar() {',
    `export function Sidebar() {
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };`
);

// Add logout button at the bottom
const logoutButton = `
            <div className="pt-4 border-t mt-auto mb-4">
                <Button
                    variant="ghost"
                    className="w-full justify-start h-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                    size="sm"
                    onClick={handleLogout}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log Out
                </Button>
            </div>
`;

content = content.replace(
    '        </div>\n    );\n}',
    `        </div>\n${logoutButton}    );\n}`
);

fs.writeFileSync('src/components/layout/sidebar.tsx', content);
