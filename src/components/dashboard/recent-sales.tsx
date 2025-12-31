import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

interface RecentSalesProps {
    orders: any[];
}

export function RecentSales({ orders }: RecentSalesProps) {
    return (
        <div className="space-y-8">
            {orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent sales.</p>
            ) : (
                orders.map((order) => {
                    // Fallback if customer info is missing (should be joined or in customer_info)
                    const customerName = order.customer_info?.name || "Guest Customer";
                    const customerEmail = order.customer_info?.email || "No email";
                    const initials = customerName
                        .split(" ")
                        .map((n: string) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();

                    return (
                        <div key={order.id} className="flex items-center">
                            <Avatar className="h-9 w-9">
                                <AvatarImage src="/avatars/01.png" alt="Avatar" />
                                <AvatarFallback>{initials}</AvatarFallback>
                            </Avatar>
                            <div className="ml-4 space-y-1">
                                <p className="text-sm font-medium leading-none">{customerName}</p>
                                <p className="text-sm text-muted-foreground">{customerEmail}</p>
                            </div>
                            <div className="ml-auto font-medium flex flex-col items-end gap-1">
                                <span>{formatCurrency(order.total_amount)}</span>
                                <Badge variant={order.status === "Delivered" ? "default" : "secondary"} className="text-[10px] px-1 py-0 h-5">
                                    {order.status}
                                </Badge>
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}
