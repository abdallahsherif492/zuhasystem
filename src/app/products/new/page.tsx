"use client";

import { useState } from "react";
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
import { Trash2, Plus, Loader2 } from "lucide-react";

// Helper to generate random SKU
const generateSKU = () => {
    return 'ZUHA-' + Math.random().toString(36).substring(2, 8).toUpperCase();
};
const variantSchema = z.object({
    title: z.string().min(1, "Title is required (e.g. Red/XL)"),
    sku: z.string().optional(),
    sale_price: z.coerce.number().min(0),
    cost_price: z.coerce.number().min(0),
    track_inventory: z.boolean().default(false),
    stock_qty: z.coerce.number().min(0).default(0),
});

const formSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    description: z.string().optional(),
    variants: z.array(variantSchema).min(1, "At least one variant is required"),
});

export default function NewProductPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

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

    async function onSubmit(values: z.infer<typeof formSchema>) {
        try {
            setLoading(true);

            // 1. Create Product
            const { data: productData, error: productError } = await supabase
                .from("products")
                .insert({
                    name: values.name,
                    description: values.description,
                })
                .select()
                .single();

            if (productError) throw productError;

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
                alert("Product created successfully. \n\n⚠️ Warning: Some variants have a Cost Price of 0. Please update them if this is incorrect.");
            }

            router.push("/products");
            router.refresh();
        } catch (error: any) {
            console.error("Error creating product:", error);
            alert("Failed to create product. See console for details.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Create Product</h1>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Product Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Product Name" {...field} />
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
                                        <FormLabel>Description</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Product Description" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-semibold">Variants</h2>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    append({
                                        title: "",
                                        sku: generateSKU(), // Auto-generate for new variants
                                        sale_price: 0,
                                        cost_price: 0,
                                        track_inventory: false,
                                        stock_qty: 0,
                                    })
                                }
                            >
                                <Plus className="mr-2 h-4 w-4" /> Add Variant
                            </Button>
                        </div>

                        {fields.map((field, index) => (
                            <Card key={field.id}>
                                <CardContent className="pt-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control}
                                            name={`variants.${index}.title`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Variant Title</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="e.g. Red/XL" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`variants.${index}.sku`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>SKU (Auto)</FormLabel>
                                                    <FormControl>
                                                        <div className="flex gap-2">
                                                            <Input placeholder="ZUHA-XXXXXX" {...field} />
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => {
                                                                    form.setValue(`variants.${index}.sku`, generateSKU());
                                                                }}
                                                                title="Regenerate SKU"
                                                            >
                                                                <Loader2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`variants.${index}.sale_price`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Sale Price</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" {...field} />
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
                                                    <FormLabel>Cost Price</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" {...field} />
                                                    </FormControl>
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
                                                        <FormLabel>Open Product</FormLabel>
                                                        <FormDescription>
                                                            If enabled, orders can be placed even with 0 stock (negative stock).
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={!field.value}
                                                            onCheckedChange={(checked) => field.onChange(!checked)}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`variants.${index}.stock_qty`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Stock Quantity</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    {fields.length > 1 && (
                                        <div className="mt-4 flex justify-end">
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => remove(index)}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" /> Remove Variant
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={loading} size="lg">
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Product
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
