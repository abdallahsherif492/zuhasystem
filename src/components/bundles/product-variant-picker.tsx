"use client";

import { useState } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import { cn, formatCurrency, normalizeSearchText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BundleProduct } from "@/lib/bundles";

export interface CatalogProduct {
    id: string;
    name: string;
    variants: Omit<BundleProduct, "product">[];
}

/** One searchable list of product and variant, by name, variant or SKU. */
export function ProductVariantPicker({ catalog, onPick, label = "ضيف منتج", className }: {
    catalog: CatalogProduct[];
    onPick: (variantId: string) => void;
    label?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className={cn("justify-between gap-2", className)}>
                    <span className="flex items-center gap-1.5"><Plus className="h-4 w-4" />{label}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
                <Command filter={(value, search) => normalizeSearchText(value).includes(normalizeSearchText(search)) ? 1 : 0}>
                    <CommandInput placeholder="دوّر باسم المنتج أو الكود…" />
                    <CommandList className="max-h-72">
                        <CommandEmpty>مفيش منتج بالاسم ده.</CommandEmpty>
                        {catalog.map(p => (
                            <CommandGroup key={p.id} heading={p.name}>
                                {p.variants.map(v => (
                                    <CommandItem
                                        key={v.id}
                                        value={`${p.name} ${v.title} ${v.sku || ""}`}
                                        onSelect={() => { onPick(v.id); setOpen(false); }}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium">{v.title === "Default" ? p.name : v.title}</div>
                                            {v.sku && <div className="truncate font-mono text-[10px] text-muted-foreground">{v.sku}</div>}
                                        </div>
                                        <div className="ms-2 shrink-0 text-end">
                                            <div className="text-xs font-semibold">{formatCurrency(v.sale_price)}</div>
                                            {v.track_inventory && (
                                                <div className={cn("text-[10px]", (v.stock_qty ?? 0) <= 0 ? "font-bold text-red-600" : "text-muted-foreground")}>
                                                    {(v.stock_qty ?? 0) <= 0 ? "خلصان" : `${v.stock_qty} في المخزن`}
                                                </div>
                                            )}
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
