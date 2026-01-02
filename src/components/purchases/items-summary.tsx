import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

interface SummaryProps {
    orders: any[];
}

export function ItemsSummary({ orders }: SummaryProps) {
    // Aggregate items
    const summary = orders.reduce((acc: any, order: any) => {
        order.items.forEach((item: any) => {
            const key = `${item.variant.product.name}-${item.variant.title}`;
            if (!acc[key]) {
                acc[key] = {
                    productName: item.variant.product.name,
                    variantTitle: item.variant.title,
                    totalQuantity: 0,
                    costPrice: item.variant.cost_price || 0,
                    stockQty: item.variant.stock_qty || 0,
                };
            }
            acc[key].totalQuantity += item.quantity;
            // Note: stock_qty is static per variant, just take the one from the item reference.
        });
        return acc;
    }, {});

    const summaryList = Object.values(summary).sort((a: any, b: any) => a.productName.localeCompare(b.productName));
    const grandTotalCost = summaryList.reduce((sum: number, item: any) => sum + (item.totalQuantity * item.costPrice), 0);

    if (summaryList.length === 0) return null;

    return (
        <Card className="bg-blue-50/50 border-blue-100 mb-6">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-lg text-blue-900">Required Items Summary (Pick List)</CardTitle>
                <div className="text-lg font-bold text-blue-900">
                    Total Cost: {formatCurrency(grandTotalCost)}
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border bg-white">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product Name</TableHead>
                                <TableHead>Variant</TableHead>
                                <TableHead className="text-right">Total Qty</TableHead>
                                <TableHead className="text-right">In Stock</TableHead>
                                <TableHead className="text-right">To Buy</TableHead>
                                <TableHead className="text-right">Unit Cost</TableHead>
                                <TableHead className="text-right">Cost To Buy</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {summaryList.map((item: any, idx: number) => {
                                const netNeeded = Math.max(0, item.totalQuantity - item.stockQty);
                                const hasStock = item.stockQty >= item.totalQuantity;

                                return (
                                    <TableRow key={idx}>
                                        <TableCell className="font-medium">{item.productName}</TableCell>
                                        <TableCell>{item.variantTitle}</TableCell>
                                        <TableCell className="text-right font-bold text-blue-600">
                                            {item.totalQuantity}
                                        </TableCell>
                                        <TableCell className="text-right text-gray-600">
                                            {item.stockQty}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {hasStock ? (
                                                <span className="text-green-600 font-bold flex justify-end items-center gap-1">
                                                    <CheckCircle2 className="h-4 w-4" /> Covered
                                                </span>
                                            ) : (
                                                <span className="text-red-600 font-bold">
                                                    {netNeeded}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {formatCurrency(item.costPrice)}
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(netNeeded * item.costPrice)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

import { CheckCircle2 } from "lucide-react";
