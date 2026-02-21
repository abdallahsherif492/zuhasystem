"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Users, Search, Loader2, Download } from "lucide-react";
import { MultiSelect, Option } from "@/components/ui/multi-select";
import { Checkbox } from "@/components/ui/checkbox";
import * as XLSX from "xlsx";

const GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Dakahlia", "Red Sea", "Beheira", "Fayoum",
    "Gharbiya", "Ismailia", "Monufia", "Minya", "Qaliubiya", "New Valley", "Suez",
    "Aswan", "Assiut", "Beni Suef", "Port Said", "Damietta", "Sharkia", "South Sinai",
    "Kafr Al Sheikh", "Matrouh", "Luxor", "Qena", "North Sinai", "Sohag"
].sort();

const GOV_OPTIONS: Option[] = [
    { label: "All Except Cairo & Giza", value: "ALL_EXCEPT_CAIRO_GIZA" },
    ...GOVERNORATES.map(g => ({ label: g, value: g }))
];

export default function CustomersPage() {
    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    // Filters
    const [selectedGovs, setSelectedGovs] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
    const [minOrders, setMinOrders] = useState<string>("");

    // Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        try {
            setLoading(true);

            // Fetch Products for the filter
            const { data: pData } = await supabase.from('products').select('id, name');
            if (pData) setProducts(pData);

            // Fetch Customers using the new RPC
            const { data: cData, error } = await supabase.rpc('get_customers_with_stats');

            if (error) throw error;
            setCustomers(cData || []);
        } catch (error) {
            console.error("Error fetching customers:", error);
        } finally {
            setLoading(false);
        }
    }

    const filteredCustomers = customers.filter(
        (customer) => {
            // Search Text
            const matchesSearch = customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customer.phone?.includes(searchTerm) ||
                customer.email?.toLowerCase().includes(searchTerm.toLowerCase());

            if (!matchesSearch) return false;

            // Governorate Filter
            let matchesGov = true;
            if (selectedGovs.length > 0) {
                if (selectedGovs.includes("ALL_EXCEPT_CAIRO_GIZA")) {
                    matchesGov = customer.governorate !== "Cairo" && customer.governorate !== "Giza";
                } else {
                    matchesGov = selectedGovs.includes(customer.governorate || "");
                }
            }
            if (!matchesGov) return false;

            // Product Filter
            if (selectedProducts.length > 0) {
                // ordered_products is an array of variant_ids or product_ids depending on the RPC
                // We modified the SQL script to return product_ids: `ARRAY_AGG(DISTINCT v.product_id)`
                const custProducts = customer.ordered_products || [];
                // Check if the customer has ordered ANY of the selected products
                const hasOrderedSelectedProduct = selectedProducts.some(pId => custProducts.includes(pId));
                if (!hasOrderedSelectedProduct) {
                    return false;
                }
            }

            // Min Orders Filter
            if (minOrders && parseInt(minOrders) > 0) {
                if ((customer.total_orders || 0) < parseInt(minOrders)) {
                    return false;
                }
            }

            return true;
        }
    );

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(filteredCustomers.map(c => c.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const newSelected = new Set(selectedIds);
        if (checked) {
            newSelected.add(id);
        } else {
            newSelected.delete(id);
        }
        setSelectedIds(newSelected);
    };

    const exportToExcel = () => {
        const idsToExport = selectedIds.size > 0 ? Array.from(selectedIds) : filteredCustomers.map(c => c.id);
        const customersToExport = customers.filter(c => idsToExport.includes(c.id));

        const exportData = customersToExport.map(c => ({
            "Name": c.name,
            "Phone": c.phone,
            "Email": c.email || "-",
            "Governorate": c.governorate || "-",
            "Total Orders": c.total_orders || 0,
            "Registration Date": new Date(c.created_at).toLocaleDateString()
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");
        XLSX.writeFile(workbook, `customers_export_${selectedIds.size > 0 ? 'selected' : 'all'}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const productOptions: Option[] = products.map(p => ({ label: p.name, value: p.id }));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
                <Button onClick={exportToExcel}>
                    <Download className="mr-2 h-4 w-4" />
                    Export {selectedIds.size > 0 ? 'Selected' : 'All Filtered'}
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, phone, or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full"
                    />
                </div>
                <div>
                    <MultiSelect
                        options={GOV_OPTIONS}
                        selected={selectedGovs}
                        onChange={setSelectedGovs}
                        placeholder="Filter by Governorate"
                    />
                </div>
                <div>
                    <Input
                        type="number"
                        placeholder="Min Orders Count"
                        value={minOrders}
                        onChange={(e) => setMinOrders(e.target.value)}
                        min="0"
                    />
                </div>
                <div>
                    <MultiSelect
                        options={productOptions}
                        selected={selectedProducts}
                        onChange={setSelectedProducts}
                        placeholder="Filter by Product"
                    />
                </div>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px]">
                                <Checkbox
                                    checked={filteredCustomers.length > 0 && selectedIds.size === filteredCustomers.length}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead>Registration Date</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Governorate</TableHead>
                            <TableHead>Total Orders</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filteredCustomers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    No customers found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredCustomers.map((customer) => (
                                <TableRow key={customer.id} data-state={selectedIds.has(customer.id) ? "selected" : ""}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedIds.has(customer.id)}
                                            onCheckedChange={(c) => handleSelectRow(customer.id, c as boolean)}
                                        />
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {new Date(customer.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="font-medium text-primary">
                                        <Link href={`/customers/${customer.id}`} className="hover:underline">
                                            {customer.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell>{customer.phone}</TableCell>
                                    <TableCell>{customer.governorate || "-"}</TableCell>
                                    <TableCell>
                                        {customer.total_orders || 0}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Link href={`/customers/${customer.id}`}>
                                            <Button variant="ghost" size="sm">
                                                View
                                            </Button>
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
