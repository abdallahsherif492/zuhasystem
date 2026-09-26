"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Link2Off, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PickerProduct {
    id: string;
    name: string;
    skus: string[];
}

/** Sentinel for "this ad is not for one product". */
export const GENERAL = "__general__";

/**
 * Which product an ad sells, searchable by name or code. `value` is a product
 * id, null for "not a product", or undefined when not linked yet.
 */
export function AdProductPicker({ products, value, onChange, ar, disabled }: {
    products: PickerProduct[];
    value: string | null | undefined;
    onChange: (productId: string | null) => void;
    ar: boolean;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const current = value ? products.find(p => p.id === value) : null;
    const label = value === undefined
        ? (ar ? "اختار المنتج…" : "Pick a product…")
        : value === null
            ? (ar ? "إعلان عام (مش لمنتج)" : "General (no product)")
            : current?.name ?? (ar ? "منتج محذوف" : "Deleted product");

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        "h-8 w-full max-w-[280px] justify-between gap-2 text-xs font-normal",
                        value === undefined && "border-amber-400 text-amber-700 dark:text-amber-300",
                    )}
                >
                    <span className="truncate">{label}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(380px,90vw)] p-0" align="start">
                <Command
                    filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0)}
                >
                    <CommandInput placeholder={ar ? "دوّر باسم المنتج أو الكود…" : "Search by name or code…"} />
                    <CommandList>
                        <CommandEmpty>{ar ? "مفيش منتج بالاسم ده" : "No product found"}</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value={`${GENERAL} general عام`} onSelect={() => { onChange(null); setOpen(false); }}>
                                <Link2Off className="me-2 h-4 w-4 opacity-60" />
                                {ar ? "إعلان عام (مش لمنتج معين)" : "General ad (not one product)"}
                                {value === null && <Check className="ms-auto h-4 w-4" />}
                            </CommandItem>
                        </CommandGroup>
                        <CommandGroup heading={ar ? "المنتجات" : "Products"}>
                            {products.map(p => (
                                <CommandItem
                                    key={p.id}
                                    value={`${p.name} ${p.skus.join(" ")} ${p.id}`}
                                    onSelect={() => { onChange(p.id); setOpen(false); }}
                                >
                                    <Package className="me-2 h-4 w-4 opacity-60" />
                                    <span className="truncate">{p.name}</span>
                                    {p.skus[0] && <span className="ms-2 font-mono text-[10px] text-muted-foreground">{p.skus[0]}</span>}
                                    {value === p.id && <Check className="ms-auto h-4 w-4" />}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
