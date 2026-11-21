"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatCurrency, normalizeSearchText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AutosaveField } from "@/components/ui/autosave-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ClosedBySelect } from "@/components/orders/closed-by-select";
import { BundlePicker, BundleTag } from "@/components/bundles/bundle-picker";
import { bundleLabel, bundleSkuIndex, bundleVariantIndex, skuKey, type Bundle, type BundleVariant } from "@/lib/bundles";

/**
 * The order's edit section of «New from stores» — customer details, notes,
 * who closed it, products (add, map, bundles, quantity, price), shipping and
 * payment — as a component, so the chats can open the same section over the
 * conversation (components/whatsapp/order-edit-dialog.tsx). It only draws;
 * what each change does comes in `edit` (the page's own handlers there,
 * hooks/use-order-editor.ts in the chats).
 */

export const GOVERNORATES = [
    "Cairo", "New Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

/** What an order's lines cost us: the order's total_cost, which its profit is generated from. */
export const itemsCost = (items: { quantity: number; cost_at_sale?: number | null }[]) =>
    items.reduce((sum, i) => sum + (Number(i.cost_at_sale) || 0) * (Number(i.quantity) || 0), 0);

export interface EditableItem {
    id: string;
    variant_id: string | null;
    quantity: number;
    price_at_sale: number;
    cost_at_sale?: number | null;
    unmapped_name?: string;
    unmapped_sku?: string;
    bundle_variant_id?: string | null;
    variants?: { title: string; sku: string; product_id: string; products: { name: string } };
}

export interface EditableOrder {
    id: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_info: any;
    subtotal: number;
    total_amount: number;
    total_cost?: number | null;
    shipping_cost: number;
    payment_status: string;
    paid_amount: number;
    closed_by?: string | null;
    notes?: string | null;
    order_items: EditableItem[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OrderEditActions<O extends EditableOrder = EditableOrder> {
    saveStatus: string;
    updateCustomerInfo: (order: O, field: string, value: string) => Promise<unknown>;
    handleAutoSaveNotes: (order: O, text: string) => Promise<unknown>;
    updateOrderField: (order: O, field: string, value: any) => Promise<unknown>;
    updateOrderFields: (order: O, updates: Partial<EditableOrder>) => Promise<unknown>;
    updateOrderItem: (orderId: string, itemId: string, field: string, value: any) => Promise<unknown>;
    mapVariantToItem: (orderId: string, itemId: string, variantId: string) => Promise<unknown>;
    deleteItemFromOrder: (orderId: string, itemId: string) => Promise<unknown>;
    addBundleToOrder: (orderId: string, bundle: Bundle, variant: BundleVariant, replace?: any) => Promise<unknown>;
    /** Adds one of a product's variant; true when it went in. */
    addVariant: (order: O, product: any, variant: any) => Promise<boolean>;
    /** The order's subtotal as saved last (the shipping field adds to it). */
    currentSubtotal: (orderId: string) => number | undefined;
}

export function StoreOrderEditor<O extends EditableOrder>({ order, businessId, products, bundles, edit }: {
    order: O; businessId: string | undefined; products: any[]; bundles: Bundle[]; edit: OrderEditActions<O>;
}) {
    const { t } = useLanguage();
    const bundleNames = useMemo(() => bundleVariantIndex(bundles), [bundles]);
    const bundlesBySku = useMemo(() => bundleSkuIndex(bundles), [bundles]);
    const [addItemOpen, setAddItemOpen] = useState(false);
    const [selectedProductForAdd, setSelectedProductForAdd] = useState("");
    const [selectedVariantForAdd, setSelectedVariantForAdd] = useState("");
    const [selectedItemProduct, setSelectedItemProduct] = useState<Record<string, string>>({});

    return (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
                    {/* Customer Details */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center border-b pb-2">{t("Customer Details")}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div className="space-y-2">
                                <Label>{t("Name")}</Label>
                                <AutosaveField
                                    value={order.customer_info?.name || ""}
                                    onCommit={v => edit.updateCustomerInfo(order, 'name', v)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t("Phone 1")}</Label>
                                <AutosaveField
                                    value={order.customer_info?.phone || ""}
                                    onCommit={v => edit.updateCustomerInfo(order, 'phone', v)}
                                />
                            </div>
                        </div>
                    
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div className="space-y-2">
                                <Label>{t("Phone 2")}</Label>
                                <AutosaveField
                                    value={order.customer_info?.phone2 || ""}
                                    onCommit={v => edit.updateCustomerInfo(order, 'phone2', v)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t("Governorate")}</Label>
                                <Select 
                                    value={order.customer_info?.governorate || ""} 
                                    onValueChange={val => edit.updateCustomerInfo(order, 'governorate', val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Governorate" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {GOVERNORATES.map(gov => (
                                            <SelectItem key={gov} value={gov}>{gov}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>{t("Address")}</Label>
                            <AutosaveField
                                multiline
                                value={order.customer_info?.address || ""}
                                onCommit={v => edit.updateCustomerInfo(order, 'address', v)}
                                rows={2}
                            />
                        </div>

                        {/* Internal Workbench Notes (Autosave) */}
                        <div className="space-y-1.5 pt-3 border-t">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold text-primary flex items-center gap-1.5">
                                    📝 {t("Internal Review Notes")}
                                </Label>
                                {edit.saveStatus && (
                                    <span className="text-[10px] text-emerald-600 font-medium font-mono transition-all animate-pulse">
                                        {edit.saveStatus}
                                    </span>
                                )}
                            </div>
                            <AutosaveField
                                multiline
                                placeholder={t("Write internal review notes here (Auto-Save)...")}
                                value={order.customer_info?.internal_workbench_notes || ""}
                                onCommit={v => edit.handleAutoSaveNotes(order, v)}
                                rows={2}
                                className="text-xs bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/80 dark:border-amber-900/40 focus:border-amber-400"
                            />
                        </div>

                        {/* The note that travels with the order.
                            Distinct from the review notes above:
                            that one is for whoever is checking
                            this screen, this one is on the order
                            everywhere else and goes out with it. */}
                        <div className="space-y-1.5 pt-3 border-t">
                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                🗒️ {t("Order note")}
                            </Label>
                            <AutosaveField
                                multiline
                                placeholder={t("A note that stays on the order — delivery instructions, a landmark, anything the courier should know.")}
                                value={order.notes || ""}
                                onCommit={v => edit.updateOrderField(order, 'notes', v)}
                                rows={2}
                                className="text-xs"
                            />
                        </div>

                        {/* Who confirmed this order with the customer. This is the
                            busiest of the three entry points — most orders arrive
                            from EasyOrders and get closed right here — so it is
                            prefilled with whoever is reviewing and saved on the spot
                            rather than waiting for the order to move on. */}
                        <div className="space-y-1.5 pt-3 border-t">
                            <Label className="text-xs font-semibold text-primary">
                                {t("Closed by")}
                            </Label>
                            <ClosedBySelect
                                bare
                                businessId={businessId}
                                value={order.closed_by ?? null}
                                onChange={v => edit.updateOrderField(order, 'closed_by', v)}
                            />
                        </div>
                    </div>



                    {/* Order Items Mapping */}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h3 className="font-semibold text-lg">{t("Products & Mapping")}</h3>
                        
                            <div className="flex items-center gap-2">
                            <BundlePicker bundles={bundles} onPick={(b, v) => edit.addBundleToOrder(order.id, b, v)} />
                            <Popover open={addItemOpen} onOpenChange={setAddItemOpen}>
                                <PopoverTrigger asChild>
                                    <Button size="sm" variant="outline" className="h-8">
                                        + {t("Add Product")}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-96 p-0" align="end">
                                    {/*
                                      One searchable list of product+variant rather than two
                                      dependent dropdowns. Picking a product first only to then
                                      hunt its variant is slow when you already know what you
                                      want, and the plain Select had no search at all — with a
                                      long catalogue that means scrolling blind.
                                      Searchable by product name, variant title and SKU.
                                    */}
                                    <Command
                                        filter={(value, search) =>
                                            // Substring over cmdk's fuzzy scoring — SKUs and Arabic
                                            // names match far more predictably — and folded so
                                            // "احمر" finds "أحمر" the way staff actually type.
                                            normalizeSearchText(value).includes(normalizeSearchText(search)) ? 1 : 0
                                        }
                                    >
                                        <CommandInput placeholder={t("Search by product, variant or SKU…")} />
                                        <CommandList className="max-h-72">
                                            <CommandEmpty>{t("No product found.")}</CommandEmpty>
                                            {products.map(p => (
                                                <CommandGroup key={p.id} heading={p.name}>
                                                    {(p.variants || []).map((v: any) => {
                                                        const isPicked = selectedVariantForAdd === v.id;
                                                        const outOfStock = v.track_inventory && (v.stock_qty ?? 0) <= 0;
                                                        return (
                                                            <CommandItem
                                                                key={v.id}
                                                                value={`${p.name} ${v.title} ${v.sku || ""}`}
                                                                onSelect={() => {
                                                                    setSelectedProductForAdd(p.id);
                                                                    setSelectedVariantForAdd(v.id);
                                                                }}
                                                            >
                                                                <Check className={cn("mr-2 h-4 w-4 shrink-0", isPicked ? "opacity-100" : "opacity-0")} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-xs font-medium truncate">{v.title}</div>
                                                                    {v.sku && <div className="text-[10px] text-muted-foreground font-mono truncate">{v.sku}</div>}
                                                                </div>
                                                                <div className="text-end shrink-0 ms-2">
                                                                    <div className="text-xs font-semibold">{formatCurrency(v.sale_price)}</div>
                                                                    {v.track_inventory && (
                                                                        <div className={cn("text-[10px]", outOfStock ? "text-red-600 font-bold" : "text-muted-foreground")}>
                                                                            {outOfStock ? t("Out of stock") : `${v.stock_qty} ${t("in stock")}`}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </CommandItem>
                                                        );
                                                    })}
                                                </CommandGroup>
                                            ))}
                                        </CommandList>
                                    </Command>
                                    <div className="p-3 border-t">
                                    <Button 
                                        size="sm" 
                                        className="w-full h-8"
                                        disabled={!selectedVariantForAdd}
                                        onClick={async () => {
                                    const prod = products.find(p => p.id === selectedProductForAdd);
                                    const vari = prod?.variants?.find((v: any) => v.id === selectedVariantForAdd);
                                    if (!prod || !vari) return;
                                    if (!(await edit.addVariant(order, prod, vari))) return;
                                    setAddItemOpen(false);
                                    setSelectedProductForAdd("");
                                    setSelectedVariantForAdd("");
                                    toast.success("Item added");
                                }}
                                    >
                                        {t("Add to Order")}
                                    </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>
                            </div>
                        </div>

                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                            {order.order_items?.map(item => {
                                const isUnmapped = !item.variant_id;
                                const defaultProd = item.variant_id 
                                    ? products.find(p => p.variants?.some((v: any) => v.id === item.variant_id))
                                    : null;
                                const chosenProdId = selectedItemProduct[item.id] || defaultProd?.id;
                                const activeProd = products.find(p => p.id === chosenProdId);
                                // An unmapped line whose code is a bundle's: it came in
                                // before the bundle was made, or before the webhook knew it.
                                const bundleMatch = isUnmapped && item.unmapped_sku ? bundlesBySku.get(skuKey(item.unmapped_sku)) : undefined;
                                const fromBundle = item.bundle_variant_id ? bundleNames.get(item.bundle_variant_id)?.label : undefined;

                                return (
                                    <div key={item.id} className={cn("p-3 rounded-lg border space-y-2", isUnmapped ? "bg-red-50/50 border-red-200" : "bg-muted/30")}>
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="space-y-1 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-sm">
                                                        {item.variants?.products?.name 
                                                            ? `${item.variants.products.name} (${item.variants.title})`
                                                            : item.unmapped_name || "Unknown Item"}
                                                    </p>
                                                    {isUnmapped && (
                                                        <Badge variant="destructive" className="text-[10px]">Unmapped</Badge>
                                                    )}
                                                </div>
                                                {item.unmapped_sku && (
                                                    <p className="text-xs font-mono text-muted-foreground">SKU: {item.unmapped_sku}</p>
                                                )}
                                                {fromBundle && <BundleTag label={fromBundle} />}
                                                {bundleMatch && (
                                                    <Button
                                                        size="sm"
                                                        className="mt-1 h-8 bg-violet-600 text-white hover:bg-violet-700"
                                                        onClick={() => edit.addBundleToOrder(order.id, bundleMatch.bundle, bundleMatch.variant, item)}
                                                    >
                                                        ده باندل «{bundleLabel(bundleMatch.bundle, bundleMatch.variant)}»، فكّه لمنتجاته
                                                    </Button>
                                                )}
                                            </div>
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                onClick={() => edit.deleteItemFromOrder(order.id, item.id)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        {/* 2-Step Product & Variant Menus */}
                                        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {/* Step 1: Product Selection Menu */}
                                            <div>
                                                <Label className="text-[10px] font-medium text-muted-foreground block mb-1">{t("Select Product")}:</Label>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="w-full justify-between text-xs h-8 truncate bg-background/50">
                                                            <span className="truncate">{activeProd?.name || t("Select Product")}</span>
                                                            <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-[240px] p-0" align="start">
                                                        <Command>
                                                            <CommandInput placeholder={t("Search system products...")} />
                                                            <CommandEmpty>{t("No product found.")}</CommandEmpty>
                                                            <CommandGroup>
                                                                <CommandList className="max-h-60 overflow-y-auto">
                                                                    {products.map(p => (
                                                                        <CommandItem
                                                                            key={p.id}
                                                                            value={p.name}
                                                                            onSelect={() => {
                                                                                setSelectedItemProduct(prev => ({ ...prev, [item.id]: p.id }));
                                                                            }}
                                                                        >
                                                                            <Check className={cn("mr-2 h-4 w-4 shrink-0", activeProd?.id === p.id ? "opacity-100" : "opacity-0")} />
                                                                            <span className="text-xs font-medium">{p.name}</span>
                                                                        </CommandItem>
                                                                    ))}
                                                                </CommandList>
                                                            </CommandGroup>
                                                        </Command>
                                                    </PopoverContent>
                                                </Popover>
                                            </div>

                                            {/* Step 2: Variant Selection Menu (Filtered to activeProd) */}
                                            <div>
                                                <Label className="text-[10px] font-medium text-muted-foreground block mb-1">{t("Select Variant")}:</Label>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button 
                                                            variant={isUnmapped ? "outline" : "ghost"} 
                                                            size="sm" 
                                                            disabled={!activeProd}
                                                            className="w-full justify-between text-xs h-8 border border-input bg-background/50 hover:bg-accent truncate"
                                                        >
                                                            <span className="truncate">
                                                                {item.variants?.title ? item.variants.title : t("Select Variant")}
                                                            </span>
                                                            <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-[260px] p-0" align="start">
                                                        <Command>
                                                            <CommandInput placeholder={t("Search variants...")} />
                                                            <CommandEmpty>{t("No variant found.")}</CommandEmpty>
                                                            <CommandGroup>
                                                                <CommandList className="max-h-60 overflow-y-auto">
                                                                    {activeProd?.variants?.map((v: any) => (
                                                                        <CommandItem
                                                                            key={v.id}
                                                                            value={`${v.title} ${v.sku}`}
                                                                            onSelect={() => edit.mapVariantToItem(order.id, item.id, v.id)}
                                                                        >
                                                                            <Check className={cn("mr-2 h-4 w-4 shrink-0", item.variant_id === v.id ? "opacity-100" : "opacity-0")} />
                                                                            <div className="flex flex-col text-xs">
                                                                                <span className="font-medium">{v.title}</span>
                                                                                <span className="text-muted-foreground font-mono">SKU: {v.sku} ({formatCurrency(v.sale_price)})</span>
                                                                            </div>
                                                                        </CommandItem>
                                                                    ))}
                                                                </CommandList>
                                                            </CommandGroup>
                                                        </Command>
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                        </div>



                                        <div className="flex items-center gap-3 pt-1 border-t text-xs">
                                            <div className="flex items-center gap-1">
                                                <Label className="text-[11px] text-muted-foreground">{t("Qty")}:</Label>
                                                <AutosaveField
                                                    type="number"
                                                    min="1"
                                                    inputMode="numeric"
                                                    className="w-14 h-7 text-xs"
                                                    value={String(item.quantity)}
                                                    onCommit={v => edit.updateOrderItem(order.id, item.id, 'quantity', parseInt(v) || 1)}
                                                />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Label className="text-[11px] text-muted-foreground">{t("Price")}:</Label>
                                                <AutosaveField
                                                    type="number"
                                                    inputMode="decimal"
                                                    className="w-20 h-7 text-xs"
                                                    value={String(item.price_at_sale)}
                                                    onCommit={v => edit.updateOrderItem(order.id, item.id, 'price_at_sale', parseFloat(v) || 0)}
                                                />
                                            </div>
                                            <div className="ml-auto font-bold">
                                                {formatCurrency(item.quantity * item.price_at_sale)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Financial Summary */}
                        <div className="border-t pt-4 space-y-2 text-sm bg-muted/20 p-3 rounded-lg">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-muted-foreground">{t("Subtotal")}</span>
                                <span>{formatCurrency(order.subtotal)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-muted-foreground">{t("Shipping Cost")}</span>
                                <AutosaveField
                                    type="number"
                                    inputMode="decimal"
                                    className="w-24 h-7 text-xs text-right"
                                    value={String(order.shipping_cost)}
                                    onCommit={v => {
                                        const val = parseFloat(v) || 0;
                                        const subtotal = edit.currentSubtotal(order.id) ?? order.subtotal;
                                        edit.updateOrderFields(order, { shipping_cost: val, total_amount: subtotal + val });
                                    }}
                                />
                            </div>
                            <div className="flex justify-between items-center font-bold text-sm border-t pt-2">
                                <span>{t("Total Amount")}</span>
                                <span className="text-primary">{formatCurrency(order.total_amount)}</span>
                            </div>
                        
                            <div className="flex justify-between items-center pt-2">
                                <Label>{t("Payment Status")}</Label>
                                <Select value={order.payment_status === 'Partial' ? 'Partially Paid' : (order.payment_status || "Not Paid")} onValueChange={(val) => {
                                    edit.updateOrderField(order, 'payment_status', val);
                                    if (val === 'Paid') edit.updateOrderField(order, 'paid_amount', order.total_amount);
                                    if (val === 'Not Paid') edit.updateOrderField(order, 'paid_amount', 0);
                                }}>
                                    <SelectTrigger className="w-[150px] h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Not Paid">Not Paid</SelectItem>
                                        <SelectItem value="Partially Paid">Partially Paid</SelectItem>
                                        <SelectItem value="Paid">Paid</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {(order.payment_status === 'Partially Paid' || order.payment_status === 'Partial') && (
                                <div className="flex justify-between items-center">
                                    <Label>{t("Paid Amount")}</Label>
                                    <AutosaveField
                                        type="number"
                                        inputMode="decimal"
                                        className="w-[150px] h-8"
                                        value={String(order.paid_amount || 0)}
                                        onCommit={v => edit.updateOrderField(order, 'paid_amount', parseFloat(v) || 0)}
                                    />
                                </div>
                            )}
                        </div>

                    </div>
                </div>
    );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
