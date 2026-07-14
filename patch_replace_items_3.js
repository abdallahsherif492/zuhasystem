const fs = require('fs');
const lines = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8').split('\n');

const startIndex = lines.findIndex((l, i) => i > 450 && l.includes('{order.order_items.map(item => ('));
const endIndex = lines.findIndex((l, i) => i > startIndex && l.includes('))}'));

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find block boundaries!");
    process.exit(1);
}

const newItemsMapping = `                                            {order.order_items.map(item => (
                                                <div key={item.id} className={\`p-3 rounded-md border \${!item.variant_id ? 'border-destructive bg-destructive/5' : 'bg-muted/20 border-border/50'}\`}>
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
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveItem(order.id, item.id)}>
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="grid grid-cols-[1fr,1fr,80px,80px] gap-2 items-end">
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
                                                                            let updatedOrder: any = undefined;
                                                                            setOrders(prev => prev.map(o => {
                                                                                if (o.id === order.id) {
                                                                                    const newItems = o.order_items.map(i => i.id === item.id ? {
                                                                                        ...i,
                                                                                        variant_id: val,
                                                                                        price_at_sale: v.sale_price,
                                                                                        variants: { ...v, product_id: prodId, products: { name: prod?.name } } as any
                                                                                    } : i);
                                                                                    const newTotal = newItems.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + o.shipping_cost;
                                                                                    const newOrderObj = { ...o, order_items: newItems, total_amount: newTotal, subtotal: newTotal - o.shipping_cost };
                                                                                    updatedOrder = newOrderObj;
                                                                                    return newOrderObj;
                                                                                }
                                                                                return o;
                                                                            }));
                                                                            handleUpdateItem(item.id, { variant_id: val, price_at_sale: v.sale_price }).then(() => {
                                                                                if (updatedOrder) {
                                                                                    handleUpdateOrder(order.id, { subtotal: updatedOrder.subtotal, total_amount: updatedOrder.total_amount });
                                                                                }
                                                                            });
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
                                                                                {v.title}
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
                                                </div>
                                            ))}`;

lines.splice(startIndex, endIndex - startIndex + 1, newItemsMapping);
fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', lines.join('\n'));
console.log("Replaced lines " + startIndex + " to " + endIndex);
