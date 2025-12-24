"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";

const variantSchema = z.object({
    id: z.string().optional(), // Added ID for editing
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

export default function EditProductPage() {
    const router = useRouter();
    const params = useParams(); // Unwrap params
    const id = params?.id as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [initialVariantIds, setInitialVariantIds] = useState<string[]>([]);

    const form = useForm<any>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            description: "",
            variants: [],
        },
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "variants",
    });

    useEffect(() => {
        if (id) {
            fetchProduct();
        }
    }, [id]);

    async function fetchProduct() {
        try {
            const { data: product, error } = await supabase
                .from("products")
                .select(`*, variants(*)`)
                .eq("id", id)
                .single();

            if (error) throw error;
            if (!product) {
                alert("Product not found");
                router.push("/products");
                return;
            }

            form.reset({
                name: product.name,
                description: product.description || "",
                variants: product.variants.map((v: any) => ({
                    id: v.id,
                    title: v.title,
                    sku: v.sku || "",
                    sale_price: v.sale_price,
                    cost_price: v.cost_price,
                    track_inventory: v.track_inventory,
                    stock_qty: v.stock_qty,
                })),
            });

            setInitialVariantIds(product.variants.map((v: any) => v.id));
        } catch (error) {
            console.error("Error fetching product:", error);
            // alert("Error loading product"); // Silent fail or redirect often better UX for now
        } finally {
            setLoading(false);
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        try {
            setSaving(true);

            // 1. Update Product
            const { error: productError } = await supabase
                .from("products")
                .update({
                    name: values.name,
                    description: values.description,
                })
                .eq("id", id);

            if (productError) throw productError;

            // 2. Handle Variants
            // Identify deleted variants
            const currentIds = values.variants.map((v) => v.id).filter(Boolean);
            const toDelete = initialVariantIds.filter((id) => !currentIds.includes(id));

            if (toDelete.length > 0) {
                const { error: deleteError } = await supabase
                    .from("variants")
                    .delete()
                    .in("id", toDelete);
                if (deleteError) throw deleteError;
            }

            // Upsert variants (update existing, insert new)
            // We split them to ensure clean operations:
            // 1. Existing variants (have ID) -> Upsert (Update)
            // 2. New variants (no ID) -> Insert

            const variantsConfigured = values.variants.map((v) => ({
                id: v.id,
                product_id: id,
                title: v.title,
                sku: v.sku,
                sale_price: v.sale_price,
                cost_price: v.cost_price,
                track_inventory: v.track_inventory,
                stock_qty: v.track_inventory ? v.stock_qty : 0,
            }));

            const updates = variantsConfigured.filter(v => v.id);
            const inserts = variantsConfigured.filter(v => !v.id).map(({ id, ...rest }) => rest);

            if (updates.length > 0) {
                const { error: updateError } = await supabase
                    .from("variants")
                    .upsert(updates);
                if (updateError) throw updateError;
            }

            if (inserts.length > 0) {
                const { error: insertError } = await supabase
                    .from("variants")
                    .insert(inserts);
                if (insertError) throw insertError;
            }

            router.push("/products");
            router.refresh();
        } catch (error: any) {
            console.error("Error updating product:", JSON.stringify(error, null, 2));
            alert(`Failed to update product: ${error.message || "Unknown error"}`);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/products">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">Edit Product</h1>
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
                                        sku: "",
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
                                                    <FormLabel>SKU</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="SKU-123" {...field} />
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
                                                        <FormLabel>Track Inventory</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
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
                                                        <FormLabel>Stock Quantity</FormLabel>
                                                        <FormControl>
                                                            <Input type="number" {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}
                                    </div>
                                    <div className="mt-4 flex justify-end">
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => remove(index)}
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" /> Remove
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving} size="lg">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
