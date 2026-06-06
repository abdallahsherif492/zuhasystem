const fs = require('fs');
let content = fs.readFileSync('src/components/layout/sidebar.tsx', 'utf8');

// Add LogOut to lucide imports
content = content.replace(
    'import { LayoutDashboard, Package, ShoppingCart, Settings, Users, Truck, Banknote, LineChart, ShoppingBag, Megaphone, Box, DollarSign, ShieldCheck, FileText, Ticket, CreditCard, Clock, Inbox, Calendar } from "lucide-react";',
    'import { LayoutDashboard, Package, ShoppingCart, Settings, Users, Truck, Banknote, LineChart, ShoppingBag, Megaphone, Box, DollarSign, ShieldCheck, FileText, Ticket, CreditCard, Clock, Inbox, Calendar, LogOut } from "lucide-react";'
);

// Add logout handler inside SidebarContent
content = content.replace(
    'export function SidebarContent() {',
    `export function SidebarContent() {
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };`
);

// Add logout button at the bottom of SidebarContent
const logoutButton = `
            <div className="pt-4 border-t mt-4">
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
    `        </div>\n${logoutButton}        </div>\n    );\n}`
);

fs.writeFileSync('src/components/layout/sidebar.tsx', content);
