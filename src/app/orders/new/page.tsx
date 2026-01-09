"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { deductStock, validateStock } from "@/lib/inventory";
import { ProductWithVariants, Variant } from "@/types";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2, Trash2, ShoppingCart, Search, PlusCircle, UserPlus, Calculator, Calendar as CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";

interface CartItem {
    variantId: string;
    productName: string;
    variantTitle: string;
    sale_price: number;
    cost_price: number;
    quantity: number;
    maxStock: number;
    trackInventory: boolean;
}

const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
];

const CHANNELS = ["Facebook", "Instagram", "Tiktok", "Website"];

export default function NewOrderPage() {
    const router = useRouter();
    const [products, setProducts] = useState<ProductWithVariants[]>([]);
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // Customer State
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerPhone2, setCustomerPhone2] = useState("");
    const [customerAddress, setCustomerAddress] = useState("");
    const [customerGov, setCustomerGov] = useState("");
    const [isNewCustomer, setIsNewCustomer] = useState(true);
    const [existingCustomers, setExistingCustomers] = useState<any[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

    // Order Details State
    const [channel, setChannel] = useState("Facebook");
    const [shippingCost, setShippingCost] = useState(0);
    const [discount, setDiscount] = useState(0);
    const [tags, setTags] = useState("");
    const [notes, setNotes] = useState("");
    const [orderDate, setOrderDate] = useState<Date>(new Date());

    // Cart Selection State
    const [selectedProduct, setSelectedProduct] = useState<string>("");
    const [selectedVariant, setSelectedVariant] = useState<string>("");
    const [quantity, setQuantity] = useState<number>(1);
    const [customPrice, setCustomPrice] = useState<number>(0);

    const activeProduct = products.find((p) => p.id === selectedProduct);
    const activeVariant = activeProduct?.variants.find(
        (v) => v.id === selectedVariant
    );

    useEffect(() => {
        if (activeVariant) {
            setCustomPrice(activeVariant.sale_price);
        }
    }, [activeVariant]);

    useEffect(() => {
        fetchProducts();
        searchCustomers("");
    }, []);

    // Update Shipping when Gov changes
    useEffect(() => {
        if (!customerGov) {
            setShippingCost(0);
            return;
        }
        if (customerGov === "Cairo" || customerGov === "Giza") {
            setShippingCost(45);
        } else {
            setShippingCost(80);
        }
    }, [customerGov]);

    async function fetchProducts() {
        try {
            const { data, error } = await supabase
                .from("products")
                .select(`*, variants (*)`)
                .order("name");
            if (error) throw error;
            setProducts(data || []);
        } catch (error) {
            console.error("Error fetching products:", error);
        } finally {
            setLoading(false);
        }
    }

    async function searchCustomers(query: string) {
        // Simple fetch all (assuming small DB), ideal is server-side search

        const { data } = await supabase
            .from("customers")
            .select("id, name, phone, phone2, address, governorate")
            .ilike("name", `%${query}%`)
            .limit(10);
        setExistingCustomers(data || []);
    }

    function handleCustomerSelect(customerId: string) {
        if (customerId === "new") {
            setIsNewCustomer(true);
            setSelectedCustomerId(null);
            setCustomerName("");
            setCustomerPhone("");
            setCustomerPhone2("");
            setCustomerAddress("");
            setCustomerGov("");
            return;
        }
        const cust = existingCustomers.find(c => c.id === customerId);
        if (cust) {
            setIsNewCustomer(false);
            setSelectedCustomerId(cust.id);
            setCustomerName(cust.name);
            setCustomerPhone(cust.phone || "");
            setCustomerPhone2(cust.phone2 || "");
            setCustomerAddress(cust.address || "");
            setCustomerGov(cust.governorate || "");
        }
    }



    const addItemToCart = () => {
        if (!activeProduct || !activeVariant) return;

        if (activeVariant.track_inventory && activeVariant.stock_qty < quantity) {
            alert(`Insufficient stock. Available: ${activeVariant.stock_qty}`);
            return;
        }

        const existingItemIndex = cart.findIndex(
            (item) => item.variantId === activeVariant.id
        );

        if (existingItemIndex >= 0) {
            const newCart = [...cart];
            const newQuantity = newCart[existingItemIndex].quantity + quantity;

            if (activeVariant.track_inventory && activeVariant.stock_qty < newQuantity) {
                alert(`Insufficient stock. Available: ${activeVariant.stock_qty}`);
                return;
            }
            newCart[existingItemIndex].quantity = newQuantity;
            setCart(newCart);
        } else {
            setCart([
                ...cart,
                {
                    variantId: activeVariant.id,
                    productName: activeProduct.name,
                    variantTitle: activeVariant.title,
                    sale_price: customPrice,
                    cost_price: activeVariant.cost_price,
                    quantity: quantity,
                    maxStock: activeVariant.stock_qty,
                    trackInventory: activeVariant.track_inventory,
                },
            ]);
        }
        setQuantity(1);
        setSelectedVariant("");
    };

    const removeFromCart = (index: number) => {
        const newCart = [...cart];
        newCart.splice(index, 1);
        setCart(newCart);
    };

    const calculateSubtotal = () => {
        return cart.reduce((acc, item) => acc + item.sale_price * item.quantity, 0);
    };

    const calculateTotalCost = () => {
        return cart.reduce((acc, item) => acc + item.cost_price * item.quantity, 0);
    };

    const calculateTotal = () => {
        return Math.max(0, calculateSubtotal() + shippingCost - discount);
    };

    // ... existing imports

    // ... existing imports

    const handleSubmitOrder = async () => {
        if (cart.length === 0) return;
        if (!customerName || !customerPhone) {
            alert("Please enter customer name and phone.");
            return;
        }

        setSubmitting(true);

        try {
            // 0. Validate Stock Server-Side (Safety Check)
            // Fetch latest variant info to ensure we aren't using stale UI data
            const variantIds = cart.map(c => c.variantId);
            const { data: latestVariants } = await supabase.from('variants').select('id, stock_qty, track_inventory').in('id', variantIds);

            if (latestVariants) {
                const inventoryItems = cart.map(item => {
                    const v = latestVariants.find(lv => lv.id === item.variantId);
                    return {
                        variant_id: item.variantId,
                        qty: item.quantity,
                        track_inventory: v?.track_inventory ?? false,
                        current_stock: v?.stock_qty ?? 0
                    };
                });
                await validateStock(inventoryItems);
            }

            // 0.5. Determine Initial Status
            // If all items are in stock (current_stock >= qty), auto-set to "Prepared".
            // Otherwise, keep as "Pending" (so it goes to Purchases).
            let initialStatus = "Pending";
            if (latestVariants) {
                const allInStock = cart.every(item => {
                    const v = latestVariants.find(lv => lv.id === item.variantId);
                    return (v?.stock_qty || 0) >= item.quantity;
                });

                if (allInStock && cart.length > 0) {
                    initialStatus = "Prepared";
                }
            }

            // 1. Create or Update Customer
            let custId = selectedCustomerId;
            if (isNewCustomer || !custId) {
                const { data: newCust, error: custError } = await supabase
                    .from("customers")
                    .insert({
                        name: customerName,
                        phone: customerPhone,
                        phone2: customerPhone2,
                        address: customerAddress,
                        governorate: customerGov
                    })
                    .select()
                    .single();

                if (custError) throw custError;
                custId = newCust.id;
            } else {
                await supabase.from("customers").update({
                    address: customerAddress,
                    governorate: customerGov,
                    phone2: customerPhone2 // Update phone2 if needed
                }).eq("id", custId);
            }

            // 2. Create Order
            const subtotal = calculateSubtotal();
            const totalCost = calculateTotalCost();

            const { data: orderData, error: orderError } = await supabase
                .from("orders")
                .insert({
                    customer_id: custId,
                    customer_info: { name: customerName, phone: customerPhone, phone2: customerPhone2, address: customerAddress, governorate: customerGov },
                    total_amount: calculateTotal(),
                    total_cost: totalCost,
                    subtotal: subtotal,
                    discount: discount,
                    shipping_cost: shippingCost,
                    status: initialStatus,
                    channel: channel,
                    tags: tags.split(",").map(t => t.trim()).filter(Boolean),
                    notes: notes,
                    created_at: orderDate.toISOString()
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 3. Create Order Items
            const itemsData = cart.map(item => ({
                order_id: orderData.id,
                variant_id: item.variantId,
                quantity: item.quantity,
                price_at_sale: item.sale_price,
                cost_at_sale: item.cost_price,
            }));

            const { error: itemsError } = await supabase.from("order_items").insert(itemsData);
            if (itemsError) throw itemsError;

            // 4. Deduct Stock (Always deduct, regardless of track_inventory setting, as per user request)
            // The validation step above ensures we don't violate track_inventory=true constraints.
            await deductStock(cart.map(c => ({ variant_id: c.variantId, qty: c.quantity })), orderData.id);

            router.push("/orders");
            router.refresh();
        } catch (error: any) {
            console.error("Error processing order:", error);
            alert("Failed to place order: " + error.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

                {/* Customer Details */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5" />
                            Customer Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-4 items-end">
                            <div className="flex-1 flex flex-col space-y-2">
                                <Label>Search Existing Customer</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            className={cn(
                                                "w-full justify-between",
                                                !selectedCustomerId && !isNewCustomer ? "text-muted-foreground" : ""
                                            )}
                                        >
                                            {isNewCustomer
                                                ? "Create New Customer"
                                                : selectedCustomerId
                                                    ? existingCustomers.find((c) => c.id === selectedCustomerId)?.name
                                                    : "Search customer..."}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[400px] p-0">
                                        <Command>
                                            <CommandInput placeholder="Search customer name..." onValueChange={searchCustomers} />
                                            <CommandList>
                                                <CommandEmpty>No customer found.</CommandEmpty>
                                                <CommandGroup>
                                                    <CommandItem
                                                        onSelect={() => handleCustomerSelect("new")}
                                                        className="text-primary font-bold"
                                                    >
                                                        <PlusCircle className="mr-2 h-4 w-4" />
                                                        Create New Customer
                                                    </CommandItem>
                                                    {existingCustomers.map((customer) => (
                                                        <CommandItem
                                                            key={customer.id}
                                                            value={customer.name}
                                                            onSelect={() => handleCustomerSelect(customer.id)}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    selectedCustomerId === customer.id
                                                                        ? "opacity-100"
                                                                        : "opacity-0"
                                                                )}
                                                            />
                                                            {customer.name} - {customer.phone}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Full Name</Label>
                                <Input
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="Enter customer name"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Phone Number</Label>
                                <Input
                                    value={customerPhone}
                                    onChange={(e) => setCustomerPhone(e.target.value)}
                                    placeholder="01xxxxxxxxx"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Phone 2 (Optional)</Label>
                                <Input
                                    value={customerPhone2}
                                    onChange={(e) => setCustomerPhone2(e.target.value)}
                                    placeholder="01xxxxxxxxx"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Governorate</Label>
                                <Select value={customerGov} onValueChange={setCustomerGov}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Governorate" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {GOVERNORATES.map(g => (
                                            <SelectItem key={g} value={g}>{g}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Address</Label>
                                <Input
                                    value={customerAddress}
                                    onChange={(e) => setCustomerAddress(e.target.value)}
                                    placeholder="Full street address"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Product Selection */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5" />
                            Add Products
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col space-y-2">
                                <Label>Product</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            className={cn(
                                                "w-full justify-between",
                                                !selectedProduct ? "text-muted-foreground" : ""
                                            )}
                                        >
                                            {selectedProduct
                                                ? products.find((p) => p.id === selectedProduct)?.name
                                                : "Select product..."}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[300px] p-0">
                                        <Command>
                                            <CommandInput placeholder="Search product..." />
                                            <CommandList>
                                                <CommandEmpty>No product found.</CommandEmpty>
                                                <CommandGroup>
                                                    {products.map((product) => (
                                                        <CommandItem
                                                            key={product.id}
                                                            value={product.name}
                                                            onSelect={(currentValue) => {
                                                                setSelectedProduct(product.id === selectedProduct ? "" : product.id)
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    selectedProduct === product.id
                                                                        ? "opacity-100"
                                                                        : "opacity-0"
                                                                )}
                                                            />
                                                            {product.name}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            <div className="flex flex-col space-y-2">
                                <Label>Variant</Label>
                                <Select
                                    onValueChange={setSelectedVariant}
                                    value={selectedVariant}
                                    disabled={!selectedProduct}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Variant" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {activeProduct?.variants.map((v) => (
                                            <SelectItem key={v.id} value={v.id}>
                                                {v.title} - {formatCurrency(v.sale_price)}
                                                {v.track_inventory ? ` (${v.stock_qty})` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex items-end gap-4">
                            <div className="w-32">
                                <Label className="text-xs">Qty</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={quantity}
                                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                                    placeholder="Qty"
                                />
                            </div>
                            <div className="w-32">
                                <Label className="text-xs">Price (Unit)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={customPrice}
                                    onChange={(e) => setCustomPrice(parseFloat(e.target.value) || 0)}
                                    placeholder="Price"
                                />
                            </div>
                            <Button onClick={addItemToCart} disabled={!selectedVariant}>
                                Add Item
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Cart Table */}
                <Card>
                    <CardContent className="pt-6">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead>Price</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Total</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cart.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                            No items selected.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    cart.map((item, index) => (
                                        <TableRow key={`${item.variantId}-${index}`}>
                                            <TableCell>
                                                <div className="font-medium">{item.productName}</div>
                                                <div className="text-xs text-muted-foreground">{item.variantTitle}</div>
                                            </TableCell>
                                            <TableCell>{formatCurrency(item.sale_price)}</TableCell>
                                            <TableCell>{item.quantity}</TableCell>
                                            <TableCell>{formatCurrency(item.sale_price * item.quantity)}</TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="sm" onClick={() => removeFromCart(index)}>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Order Settings & Summary (Sidebar) */}
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Calculator className="h-5 w-5" />
                            Order Settings
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Channel</Label>
                            <Select value={channel} onValueChange={setChannel}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Order Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !orderDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {orderDate ? format(orderDate, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={orderDate}
                                        onSelect={(d) => {
                                            if (d) {
                                                // Set to noon to avoid timezone issues shifting it to previous day
                                                const newDate = new Date(d);
                                                newDate.setHours(12, 0, 0, 0);
                                                setOrderDate(newDate);
                                            }
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea
                                placeholder="Add any special instructions or notes about this order..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Tags (comma separated)</Label>
                            <Input
                                placeholder="e.g. vip, urgent"
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Discount amount (EGP)</Label>
                            <Input
                                type="number"
                                min="0"
                                value={discount}
                                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Shipping Fees (EGP)</Label>
                            <Input
                                type="number"
                                min="0"
                                value={shippingCost}
                                onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Auto-set: {customerGov === "Cairo" || customerGov === "Giza" ? "45" : "80"} if valid gov.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-muted/20">
                    <CardHeader>
                        <CardTitle>Order Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span>Subtotal</span>
                            <span>{formatCurrency(calculateSubtotal())}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                            <span>Shipping</span>
                            <span>{formatCurrency(shippingCost)}</span>
                        </div>
                        <div className="flex justify-between text-green-600">
                            <span>Discount</span>
                            <span>- {formatCurrency(discount)}</span>
                        </div>
                        <div className="border-t pt-2 mt-2 flex justify-between text-lg font-bold">
                            <span>Total</span>
                            <span>{formatCurrency(calculateTotal())}</span>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button
                            className="w-full"
                            size="lg"
                            onClick={handleSubmitOrder}
                            disabled={cart.length === 0 || submitting}
                        >
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create Order
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
