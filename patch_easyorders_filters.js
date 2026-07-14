const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

// Add imports
const importsToAdd = `import { DateRangePicker } from "@/components/date-range-picker";
import { useSearchParams } from "next/navigation";`;

if (!code.includes('DateRangePicker')) {
    code = code.replace(
        'import { formatCurrency } from "@/lib/utils";',
        `import { formatCurrency } from "@/lib/utils";\n${importsToAdd}`
    );
}

// Add state and searchParams inside component
if (!code.includes('const searchParams = useSearchParams();')) {
    code = code.replace(
        'const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});',
        `const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});
    
    const searchParams = useSearchParams();
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const [searchQuery, setSearchQuery] = useState("");`
    );
}

// Add filtering logic
if (!code.includes('const filteredOrders = useMemo')) {
    code = code.replace(
        'if (loading) {',
        `const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            let matchesSearch = true;
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const name = (order.customer_info?.name || "").toLowerCase();
                const phone = (order.customer_info?.phone || "").toLowerCase();
                const easyId = (order.easyorders_id || "").toLowerCase();
                const id = (order.id || "").toLowerCase();
                
                matchesSearch = name.includes(query) || phone.includes(query) || easyId.includes(query) || id.includes(query);
            }
            
            let matchesDate = true;
            if (fromDate || toDate) {
                const orderDate = new Date(order.created_at);
                orderDate.setHours(0, 0, 0, 0);
                
                if (fromDate) {
                    const from = new Date(fromDate);
                    from.setHours(0, 0, 0, 0);
                    if (orderDate < from) matchesDate = false;
                }
                
                if (toDate) {
                    const to = new Date(toDate);
                    to.setHours(0, 0, 0, 0);
                    if (orderDate > to) matchesDate = false;
                }
            }
            
            return matchesSearch && matchesDate;
        });
    }, [orders, searchQuery, fromDate, toDate]);

    if (loading) {`
    );
}

// Update the orders.map to use filteredOrders
code = code.replace(
    /\{orders\.length === 0 \? \(/,
    `{filteredOrders.length === 0 ? (`
);

code = code.replace(
    /\{orders\.map\(order => \(/,
    `{filteredOrders.map(order => (`
);

// Add the UI
if (!code.includes('value={searchQuery}')) {
    const headerReplacement = `<div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center">
                        {t("EasyOrders")}
                        {!loading && orders.length > 0 && (
                            <Badge variant="secondary" className="ml-3 text-lg px-3 py-1 bg-primary/10 text-primary">
                                {orders.length} {t("Waiting")}
                            </Badge>
                        )}
                    </h2>
                    <p className="text-muted-foreground">{t("Manage incoming orders from EasyOrders that are waiting for review.")}</p>
                </div>
            </div>
            
            <div className="flex items-center gap-4 py-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search by name, phone, or order ID..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <DateRangePicker />
            </div>`;

    code = code.replace(
        /<div className="flex items-center justify-between">[\s\S]*?<\/div>[\s\S]*?<\/div>/,
        headerReplacement
    );
}

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done patching easy orders');
