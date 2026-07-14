const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

// 1. Add state for selectedProductOverride
code = code.replace(
    'const [selectedVariantForAdd, setSelectedVariantForAdd] = useState<Record<string, string>>({});',
    `const [selectedVariantForAdd, setSelectedVariantForAdd] = useState<Record<string, string>>({});
    const [selectedProductOverride, setSelectedProductOverride] = useState<Record<string, string>>({});`
);

// 2. Replace the item mapping UI
const oldItemMapStart = `<div className="flex-1">
                                                            {!item.variant_id ? (
                                                                <div className="text-destructive flex items-center text-sm font-medium mb-2">
                                                                    <AlertTriangle className="h-4 w-4 mr-1" />
                                                                    Unmapped: {item.unmapped_name} (SKU: {item.unmapped_sku || "N/A"})
                                                                </div>
                                                            ) : (
                                                                <div className="font-medium text-sm">
                                                                    {item.variants?.products?.name} - {item.variants?.title}
                                                                </div>
                                                            )}
                                                        </div>`;

// Wait, the grid contains `<div>` with `!item.variant_id && Popover...`
// Let's replace the whole `div key={item.id}` content
const oldItemContentRegex = /<div key=\{item\.id\} className=\{\`p-3 rounded-md border \$\{\!item\.variant_id \? 'border-destructive bg-destructive\/5' : 'bg-muted\/20'\}\`\}>[\s\S]*?(?=\n                                            \}\)\})/;

const newItemContent = `<div key={item.id} className={\`p-3 rounded-md border \${!item.variant_id ? 'border-destructive bg-destructive/5' : 'bg-muted/20 border-border/50'}\`}>
                                                    <div className="flex flex-col gap-3">
                                                        <div className="flex justify-between items-center">
                                                            {!item.variant_id ? (
                                                                <div className="text-destructive flex items-center text-sm font-medium">
                                                                    <AlertTriangle className="h-4 w-4 mr-1" />
                                                                    Unmapped: {item.unmapped_name} (SKU: {item.unmapped_sku || "N/A"})
                                                                </div>
                                                            ) : (
                                                                <div className="text-emerald-600 flex items-center text-sm font-medium">
                                                                    <Check className="h-4 w-4 mr-1" />
                                                                    Mapped: {item.unmapped_name || item.variants?.products?.name}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-[1fr,1fr,80px,100px] gap-2 items-center">
                                                            {/* Product Selection */}
                                                            <div className="space-y-1">
                                                                <Label className="text-xs text-muted-foreground">Product</Label>
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button variant="outline" className={\`w-full justify-between h-8 text-xs font-normal \${!item.variant_id ? "border-destructive" : ""}\`}>
                                                                            {(selectedProductOverride[item.id] || item.variants?.product_id) ? products.find(p => p.id === (selectedProductOverride[item.id] || item.variants?.product_id))?.name : "Select product..."}
                                                                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                        </Button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-[250px] p-0" align="start">
                                                                        <Command>
                                                                            <CommandInput placeholder="Search product..." />
                                                                            <CommandEmpty>No product found.</CommandEmpty>
                                                                            <CommandGroup className="max-h-60 overflow-auto">
                                                                                <CommandList>
                                                                                {products.map(p => (
                                                                                    <CommandItem
                                                                                        key={p.id}
                                                                                        value={p.name}
                                                                                        onSelect={() => {
                                                                                            setSelectedProductOverride(prev => ({...prev, [item.id]: p.id}));
                                                                                        }}
                                                                                    >
                                                                                        <Check className={cn("mr-2 h-4 w-4", (selectedProductOverride[item.id] || item.variants?.product_id) === p.id ? "opacity-100" : "opacity-0")} />
                                                                                        {p.name}
                                                                                    </CommandItem>
                                                                                ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>
                                                            </div>
                                                            
                                                            {/* Variant Selection */}
                                                            <div className="space-y-1">
                                                                <Label className="text-xs text-muted-foreground">Variant</Label>
                                                                <Select 
                                                                    value={item.variant_id || ""}
                                                                    onValueChange={(val) => {
                                                                        const prodId = selectedProductOverride[item.id] || item.variants?.product_id;
                                                                        const prod = products.find(p => p.id === prodId);
                                                                        const v = prod?.variants.find((vr:any) => vr.id === val);
                                                                        if (v) {
                                                                            const newOrders = [...orders];
                                                                            const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                            const iIndex = newOrders[oIndex].order_items.findIndex(i => i.id === item.id);
                                                                            newOrders[oIndex].order_items[iIndex] = {
                                                                                ...item,
                                                                                variant_id: val,
                                                                                variants: { ...v, product_id: prodId, products: { name: prod.name } } as any
                                                                            };
                                                                            setOrders(newOrders);
                                                                            handleUpdateItem(item.id, { variant_id: val });
                                                                        }
                                                                    }}
                                                                    disabled={!(selectedProductOverride[item.id] || item.variants?.product_id)}
                                                                >
                                                                    <SelectTrigger className={\`h-8 text-xs \${!item.variant_id ? "border-destructive" : ""}\`}>
                                                                        <SelectValue placeholder="Variant" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {products.find(p => p.id === (selectedProductOverride[item.id] || item.variants?.product_id))?.variants.map((v: any) => (
                                                                            <SelectItem key={v.id} value={v.id}>
                                                                                {v.title} - {formatCurrency(v.sale_price)}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>

                                                            <div className="space-y-1">
                                                                <Label className="text-xs text-muted-foreground">Qty</Label>
                                                                <Input 
                                                                    type="number" 
                                                                    className="h-8 text-xs" 
                                                                    value={item.quantity} 
                                                                    onChange={e => updateItemField(order.id, item.id, 'quantity', parseInt(e.target.value) || 1)}
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs text-muted-foreground">Price</Label>
                                                                <Input 
                                                                    type="number" 
                                                                    className="h-8 text-xs" 
                                                                    value={item.price_at_sale} 
                                                                    onChange={e => updateItemField(order.id, item.id, 'price_at_sale', parseFloat(e.target.value) || 0)}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>`;

code = code.replace(oldItemContentRegex, newItemContent);

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done patch');
