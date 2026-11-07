"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import { cn, formatCurrency, normalizeSearchText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bundleLabel, bundlePrice, bundleStock, type Bundle, type BundleVariant } from "@/lib/bundles";

/**
 * "Add bundle" on the order pages. Picking one hands back the bundle and the
 * variant; the page writes its products as order lines (expandBundle).
 * Renders nothing while the business has no active bundle.
 */
export function BundlePicker({ bundles, onPick, size = "sm", className, disabled }: {
    bundles: Bundle[];
    onPick: (bundle: Bundle, variant: BundleVariant) => void;
    size?: "sm" | "default";
    className?: string;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const usable = bundles.filter(b => b.active && b.variants.some(v => v.items.length));
    if (!usable.length) return null;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size={size} className={cn("gap-1.5", size === "sm" && "h-8", className)} disabled={disabled}>
                    <Layers className="h-4 w-4" />ضيف باندل
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="end" dir="rtl">
                <Command filter={(value, search) => normalizeSearchText(value).includes(normalizeSearchText(search)) ? 1 : 0}>
                    <CommandInput placeholder="دوّر باسم الباندل أو الكود…" />
                    <CommandList className="max-h-72">
                        <CommandEmpty>مفيش باندل بالاسم ده.</CommandEmpty>
                        {usable.map(b => (
                            <CommandGroup key={b.id} heading={b.name}>
                                {b.variants.filter(v => v.items.length).map(v => {
                                    const stock = bundleStock(v);
                                    return (
                                        <CommandItem
                                            key={v.id}
                                            value={`${b.name} ${v.title} ${v.sku || ""}`}
                                            onSelect={() => { onPick(b, v); setOpen(false); }}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-xs font-medium">{bundleLabel(b, v)}</div>
                                                <div className="truncate text-[10px] text-muted-foreground">
                                                    {v.sku && <span className="font-mono">{v.sku} · </span>}
                                                    {v.items.map(i => `${i.variant?.product?.name ?? "منتج"}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(" + ")}
                                                </div>
                                            </div>
                                            <div className="ms-2 shrink-0 text-end">
                                                <div className="text-xs font-semibold">{formatCurrency(bundlePrice(v))}</div>
                                                {stock !== null && (
                                                    <div className={cn("text-[10px]", stock <= 0 ? "font-bold text-red-600" : "text-muted-foreground")}>
                                                        {stock <= 0 ? "منتج فيه خلصان" : `يكفي ${stock}`}
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
            </PopoverContent>
        </Popover>
    );
}

/** The small "from bundle X" tag under an order line. */
export function BundleTag({ label, className }: { label: string; className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-950/60 dark:text-violet-300", className)}>
            <Layers className="h-3 w-3" />من باندل {label}
        </span>
    );
}
