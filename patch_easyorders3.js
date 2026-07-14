const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

const oldSelectStr = `                                                                <Select 
                                                                    onValueChange={(val) => {
                                                                        const v = variants.find(vr => vr.id === val);
                                                                        if (v) {
                                                                            const newOrders = [...orders];
                                                                            const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                            const iIndex = newOrders[oIndex].order_items.findIndex(i => i.id === item.id);
                                                                            newOrders[oIndex].order_items[iIndex] = {
                                                                                ...item,
                                                                                variant_id: val,
                                                                                variants: v as any
                                                                            };
                                                                            setOrders(newOrders);
                                                                            handleUpdateItem(item.id, { variant_id: val });
                                                                        }
                                                                    }}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs border-destructive">
                                                                        <SelectValue placeholder="Select Match" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {variants.map(v => (
                                                                            <SelectItem key={v.id} value={v.id}>
                                                                                {v.products?.name} - {v.title} ({v.sku})
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>`;

const newComboboxStr = `                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button variant="outline" className="w-full h-8 text-xs justify-between border-destructive font-normal">
                                                                            Select Match
                                                                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                        </Button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-[300px] p-0" align="start">
                                                                        <Command>
                                                                            <CommandInput placeholder="Search variant..." />
                                                                            <CommandEmpty>No variant found.</CommandEmpty>
                                                                            <CommandGroup className="max-h-60 overflow-auto">
                                                                                <CommandList>
                                                                                {variants.map(v => (
                                                                                    <CommandItem
                                                                                        key={v.id}
                                                                                        value={v.products?.name + " " + v.title + " " + v.sku}
                                                                                        onSelect={() => {
                                                                                            const newOrders = [...orders];
                                                                                            const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                                            const iIndex = newOrders[oIndex].order_items.findIndex(i => i.id === item.id);
                                                                                            newOrders[oIndex].order_items[iIndex] = {
                                                                                                ...item,
                                                                                                variant_id: v.id,
                                                                                                variants: v as any
                                                                                            };
                                                                                            setOrders(newOrders);
                                                                                            handleUpdateItem(item.id, { variant_id: v.id });
                                                                                        }}
                                                                                    >
                                                                                        <Check className={cn("mr-2 h-4 w-4", item.variant_id === v.id ? "opacity-100" : "opacity-0")} />
                                                                                        {v.products?.name} - {v.title} ({v.sku})
                                                                                    </CommandItem>
                                                                                ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>`;

code = code.replace(oldSelectStr, newComboboxStr);

// Add Extra Items Section
const extraItemsStr = `
                                            {/* Add Extra Item */}
                                            <div className="mt-4 pt-4 border-t border-dashed">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="w-full border-dashed"
                                                    onClick={() => setAddItemOpen(prev => ({...prev, [order.id]: !prev[order.id]}))}
                                                >
                                                    {addItemOpen[order.id] ? "Cancel Adding" : "+ Add Item"}
                                                </Button>
                                                
                                                {addItemOpen[order.id] && (
                                                    <div className="mt-3 p-3 bg-muted/20 border rounded-md space-y-3">
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Product</Label>
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <Button variant="outline" className="w-full justify-between h-8 text-xs font-normal">
                                                                            {selectedProductForAdd[order.id] ? products.find(p => p.id === selectedProductForAdd[order.id])?.name : "Select product..."}
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
                                                                                            setSelectedProductForAdd(prev => ({...prev, [order.id]: p.id}));
                                                                                            setSelectedVariantForAdd(prev => ({...prev, [order.id]: ""}));
                                                                                        }}
                                                                                    >
                                                                                        <Check className={cn("mr-2 h-4 w-4", selectedProductForAdd[order.id] === p.id ? "opacity-100" : "opacity-0")} />
                                                                                        {p.name}
                                                                                    </CommandItem>
                                                                                ))}
                                                                                </CommandList>
                                                                            </CommandGroup>
                                                                        </Command>
                                                                    </PopoverContent>
                                                                </Popover>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Variant</Label>
                                                                <Select 
                                                                    value={selectedVariantForAdd[order.id] || ""}
                                                                    onValueChange={(val) => setSelectedVariantForAdd(prev => ({...prev, [order.id]: val}))}
                                                                    disabled={!selectedProductForAdd[order.id]}
                                                                >
                                                                    <SelectTrigger className="h-8 text-xs">
                                                                        <SelectValue placeholder="Variant" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {products.find(p => p.id === selectedProductForAdd[order.id])?.variants.map((v: any) => (
                                                                            <SelectItem key={v.id} value={v.id}>
                                                                                {v.title} - {formatCurrency(v.sale_price)}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
                                                        <Button 
                                                            size="sm" 
                                                            className="w-full h-8"
                                                            disabled={!selectedVariantForAdd[order.id]}
                                                            onClick={async () => {
                                                                const vId = selectedVariantForAdd[order.id];
                                                                const pId = selectedProductForAdd[order.id];
                                                                const prod = products.find(p => p.id === pId);
                                                                const vari = prod?.variants.find((v:any) => v.id === vId);
                                                                if (!prod || !vari) return;
                                                                
                                                                const { data: newItem, error } = await supabase.from('order_items').insert({
                                                                    order_id: order.id,
                                                                    variant_id: vari.id,
                                                                    quantity: 1,
                                                                    price_at_sale: vari.sale_price,
                                                                    business_id: activeBusiness?.id
                                                                }).select('id').single();
                                                                
                                                                if (error) {
                                                                    toast.error("Failed to add item");
                                                                    return;
                                                                }
                                                                
                                                                const newItemObj = {
                                                                    id: newItem.id,
                                                                    variant_id: vari.id,
                                                                    quantity: 1,
                                                                    price_at_sale: vari.sale_price,
                                                                    variants: {
                                                                        title: vari.title,
                                                                        sku: "",
                                                                        product_id: prod.id,
                                                                        products: { name: prod.name }
                                                                    }
                                                                };
                                                                
                                                                const newOrders = [...orders];
                                                                const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                newOrders[oIndex].order_items.push(newItemObj);
                                                                
                                                                const newTotal = newOrders[oIndex].order_items.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + newOrders[oIndex].shipping_cost;
                                                                newOrders[oIndex].total_amount = newTotal;
                                                                setOrders(newOrders);
                                                                handleUpdateOrder(order.id, { subtotal: newTotal - newOrders[oIndex].shipping_cost, total_amount: newTotal });
                                                                
                                                                setAddItemOpen(prev => ({...prev, [order.id]: false}));
                                                                toast.success("Item added");
                                                            }}
                                                        >
                                                            Add to Order
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
`;

code = code.replace('{/* Payment Status */}', extraItemsStr + '\n                                        {/* Payment Status */}');

// The original doesn't have {/* Payment Status */}, it has the payment status section directly
code = code.replace('<div className="flex flex-col gap-3 pt-2 mt-4 border-t">', extraItemsStr + '\n                                        <div className="flex flex-col gap-3 pt-2 mt-4 border-t">');

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done 3');
