"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Loader2, RefreshCw } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { logBusinessAction } from "@/lib/logs/actions-logger";

// Helper to generate random SKU
const generateSKU = () => {
    return 'ECOMMERX-' + Math.random().toString(36).substring(2, 8).toUpperCase();
};

/**
 * New product.
 *
 * Saves exactly what it always saved — a product and one or more variants — but
 * no longer makes a first-time merchant learn what a variant is. Most products
 * have no colours or sizes, so by default there is one set of fields (price,
 * cost, stock) stored as the single "Default" variant, and the variants editor
 * appears only when the product really has options. The form was entirely in
 * English, errors included; it now follows the interface language.
 */
export default function NewProductPage() {
    const { activeBusiness, currentUser } = useBusiness();
    const { t } = useLanguage();

    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [hasOptions, setHasOptions] = useState(false);

    const formSchema = useMemo(() => z.object({
        name: z.string().min(2, t("Product name must be at least 2 characters")),
        description: z.string().optional(),
        variants: z.array(z.object({
            title: z.string().min(1, t("Write the option name, e.g. Red / XL")),
            sku: z.string().optional(),
            sale_price: z.coerce.number().min(0, t("Price cannot be negative")),
            cost_price: z.coerce.number().min(0, t("Cost cannot be negative")),
            track_inventory: z.boolean().default(false),
            stock_qty: z.coerce.number().min(0, t("Stock cannot be negative")).default(0),
        })).min(1, t("Add at least one option")),
    }), [t]);

    const form = useForm<any>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            description: "",
            variants: [
                {
                    title: "Default",
                    sku: generateSKU(),
                    sale_price: 0,
                    cost_price: 0,
                    track_inventory: false,
                    stock_qty: 0,
                },
            ],
        } as any,
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "variants",
    });

    function toggleOptions(on: boolean) {
        setHasOptions(on);
        const first = form.getValues("variants.0.title");
        if (on && first === "Default") form.setValue("variants.0.title", "");
        if (!on) {
            // Back to one plain product: keep the first option's numbers, drop the rest.
            for (let i = fields.length - 1; i > 0; i--) remove(i);
            form.setValue("variants.0.title", "Default");
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!activeBusiness) return;
        try {
            setLoading(true);

            // 1. Create Product
            const { data: productData, error: productError } = await supabase
                .from("products")
                .insert({
                    business_id: activeBusiness.id,
                    name: values.name,
                    description: values.description,
                })
                .select()
                .single();

            if (productError) throw productError;

            logBusinessAction({
                businessId: activeBusiness.id,
                userEmail: currentUser?.email || "Staff",
                actionType: "create",
                entityType: "product",
                entityId: productData.id,
                entityName: productData.name,
                changes: [
                    { field: "Product Name", old_value: null, new_value: productData.name },
                    { field: "Variants", old_value: null, new_value: `${values.variants.length} variants` }
                ]
            });


            // 2. Create Variants
            const variantsToInsert = values.variants.map((v) => ({
                product_id: productData.id,
                title: v.title,
                sku: v.sku,
                sale_price: v.sale_price,
                cost_price: v.cost_price,
                track_inventory: v.track_inventory,
                stock_qty: v.track_inventory ? v.stock_qty : 0,
            }));

            const { error: variantsError } = await supabase
                .from("variants")
                .insert(variantsToInsert);

            if (variantsError) throw variantsError;

            const zeroCostVariants = variantsToInsert.filter(v => v.cost_price === 0);
            if (zeroCostVariants.length > 0) {
                alert(t("Product saved. Note: the cost is 0 — add it so profit is calculated correctly."));
            }

            router.push("/products");
            router.refresh();
        } catch (error: any) {
            console.error("Error creating product:", error);
            alert(t("The product was not saved. Try again."));
        } finally {
            setLoading(false);
        }
    }

    const optionFields = (index: number) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hasOptions && (
                <FormField
                    control={form.control}
                    name={`variants.${index}.title`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("Option name")}</FormLabel>
                            <FormControl>
                                <Input placeholder={t("e.g. Red / XL")} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
            <FormField
                control={form.control}
                name={`variants.${index}.sale_price`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("Selling price")}</FormLabel>
                        <FormControl>
                            <Input type="number" inputMode="decimal" step="0.01" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name={`variants.${index}.cost_price`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("What it costs you")}</FormLabel>
                        <FormControl>
                            <Input type="number" inputMode="decimal" step="0.01" {...field} />
                        </FormControl>
                        <FormDescription>{t("Used to calculate your real profit.")}</FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name={`variants.${index}.sku`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("Product code (SKU)")}</FormLabel>
                        <FormControl>
                            <div className="flex gap-2">
                                <Input dir="ltr" placeholder="ECOMMERX-XXXXXX" {...field} />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        form.setValue(`variants.${index}.sku`, generateSKU());
                                    }}
                                    title={t("New code")}
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            </div>
                        </FormControl>
                        <FormDescription>{t("Made for you. If the product is on EasyOrders, use the same code there so its orders match automatically.")}</FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name={`variants.${index}.track_inventory`}
                render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                            <FormLabel>{t("Track stock")}</FormLabel>
                            <FormDescription>
                                {t("Off: the product can be sold without counting pieces.")}
                            </FormDescription>
                        </div>
                        <FormControl>
                            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                    </FormItem>
                )}
            />
            {form.watch(`variants.${index}.track_inventory`) && (
                <FormField
                    control={form.control}
                    name={`variants.${index}.stock_qty`}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("Pieces in stock")}</FormLabel>
                            <FormControl>
                                <Input type="number" inputMode="numeric" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t("Add a product")}</h1>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Product details")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("Product name")}</FormLabel>
                                        <FormControl>
                                            <Input placeholder={t("e.g. Acrylic makeup organizer")} {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("Short description in Arabic (optional)")}</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder={t("The first line is printed on the waybill for the courier.")} {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="flex flex-row items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium">{t("Does this product come in colours or sizes?")}</p>
                                    <p className="text-sm text-muted-foreground">{t("Turn on only if each option has its own price or stock.")}</p>
                                </div>
                                <Switch checked={hasOptions} onCheckedChange={toggleOptions} />
                            </div>
                        </CardContent>
                    </Card>

                    {!hasOptions ? (
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("Price and stock")}</CardTitle>
                            </CardHeader>
                            <CardContent>{optionFields(0)}</CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-semibold">{t("Colours / sizes")}</h2>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        append({
                                            title: "",
                                            sku: generateSKU(), // Auto-generate for new variants
                                            sale_price: form.getValues("variants.0.sale_price") || 0,
                                            cost_price: form.getValues("variants.0.cost_price") || 0,
                                            track_inventory: false,
                                            stock_qty: 0,
                                        })
                                    }
                                >
                                    <Plus className="me-2 h-4 w-4" /> {t("Add an option")}
                                </Button>
                            </div>

                            {fields.map((field, index) => (
                                <Card key={field.id}>
                                    <CardContent className="pt-6">
                                        {optionFields(index)}
                                        {fields.length > 1 && (
                                            <div className="mt-4 flex justify-end">
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => remove(index)}
                                                >
                                                    <Trash2 className="me-2 h-4 w-4" /> {t("Remove option")}
                                                </Button>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end">
                        <Button type="submit" disabled={loading} size="lg" className="min-h-11 w-full sm:w-auto">
                            {loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                            {t("Save product")}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
