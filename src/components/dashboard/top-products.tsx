import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatCurrency } from "@/lib/utils";
import { Package } from "lucide-react";

interface TopProduct {
    variant_id: string;
    product_name: string;
    total_sold: number;
    total_revenue: number;
}

interface TopProductsProps {
    products: TopProduct[];
}

export function TopProducts({ products }: TopProductsProps) {
    return (
        <div className="space-y-8">
            {products.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data available.</p>
            ) : (
                products.map((product, index) => (
                    <div key={product.variant_id} className="flex items-center">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary font-bold text-xs">
                            #{index + 1}
                        </div>
                        <div className="ml-4 space-y-1">
                            <p className="text-sm font-medium leading-none truncate max-w-[180px]" title={product.product_name}>
                                {product.product_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {product.total_sold} units sold
                            </p>
                        </div>
                        <div className="ml-auto font-medium">
                            {formatCurrency(product.total_revenue)}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
