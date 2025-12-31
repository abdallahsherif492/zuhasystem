import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
                    totalQuantity: 0
                };
            }
            acc[key].totalQuantity += item.quantity;
        });
        return acc;
    }, {});

    const summaryList = Object.values(summary).sort((a: any, b: any) => a.productName.localeCompare(b.productName));

    if (summaryList.length === 0) return null;

    return (
        <Card className="bg-blue-50/50 border-blue-100 mb-6">
            <CardHeader className="pb-2">
                <CardTitle className="text-lg text-blue-900">Required Items Summary (Pick List)</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border bg-white">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product Name</TableHead>
                                <TableHead>Variant</TableHead>
                                <TableHead className="text-right">Total Qty</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {summaryList.map((item: any, idx: number) => (
                                <TableRow key={idx}>
                                    <TableCell className="font-medium">{item.productName}</TableCell>
                                    <TableCell>{item.variantTitle}</TableCell>
                                    <TableCell className="text-right font-bold text-blue-600">
                                        {item.totalQuantity}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
