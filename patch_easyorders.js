const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

// 1. Add imports for Command, Popover (for Combobox) and Check, ChevronsUpDown
code = code.replace(
    'import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";',
    `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";`
);

// 2. Add GOVERNORATES constant
const govStr = `
const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];
`;
code = code.replace('export default function EasyOrdersPage() {', govStr + '\nexport default function EasyOrdersPage() {');

// 3. Add state for Treasury Modal, products list, etc.
code = code.replace(
    'const [variants, setVariants] = useState<Variant[]>([]);',
    `const [variants, setVariants] = useState<Variant[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    
    // Treasury Modal state
    const [treasuryModalOpen, setTreasuryModalOpen] = useState(false);
    const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
    const [transactionAccount, setTransactionAccount] = useState("");
    
    // Add Item state per order
    const [addItemOpen, setAddItemOpen] = useState<Record<string, boolean>>({});
    const [selectedProductForAdd, setSelectedProductForAdd] = useState<Record<string, string>>({});
    const [selectedVariantForAdd, setSelectedVariantForAdd] = useState<Record<string, string>>({});`
);

code = code.replace('fetchVariants();', 'fetchVariants();\n            fetchProducts();');

const fetchProductsStr = `
    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from('products')
            .select('id, name, variants(id, title, sale_price, stock_qty, track_inventory)')
            .eq('business_id', activeBusiness.id)
            .eq('is_active', true);
        if (data) setProducts(data);
    };
`;
code = code.replace('const fetchOrders', fetchProductsStr + '\n    const fetchOrders');

// 4. Update the Governorates Input to Select
const govInputStr = `                                                <Input 
                                                    value={order.customer_info?.governorate || ""} 
                                                    onChange={e => updateCustomerInfo(order, 'governorate', e.target.value)}
                                                    className={!order.customer_info?.governorate ? "border-destructive" : ""}
                                                />`;
const govSelectStr = `                                                <Select 
                                                    value={order.customer_info?.governorate || ""} 
                                                    onValueChange={val => updateCustomerInfo(order, 'governorate', val)}
                                                >
                                                    <SelectTrigger className={!order.customer_info?.governorate ? "border-destructive" : ""}>
                                                        <SelectValue placeholder="Select Governorate" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {GOVERNORATES.map(g => (
                                                            <SelectItem key={g} value={g}>{g}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>`;
code = code.replace(govInputStr, govSelectStr);


fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done 1');
