const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

// Editable Shipping Cost
const oldShippingStr = `<span className="text-sm font-normal text-muted-foreground">Shipping: {formatCurrency(order.shipping_cost)}</span>`;
const newShippingStr = `<div className="flex items-center gap-2">
                                                <span className="text-sm font-normal text-muted-foreground">Shipping:</span>
                                                <Input 
                                                    type="number"
                                                    className="w-24 h-8"
                                                    value={order.shipping_cost}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        const newTotal = order.order_items.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + val;
                                                        updateOrderField(order, 'shipping_cost', val);
                                                        updateOrderField(order, 'total_amount', newTotal);
                                                    }}
                                                />
                                            </div>`;
code = code.replace(oldShippingStr, newShippingStr);

// Payment Status and Paid Amount
const oldPaymentStr = `<div className="flex justify-between items-center pt-2 mt-4 border-t">
                                            <Label>{t("Payment Status")}</Label>
                                            <Select value={order.payment_status || "Not Paid"} onValueChange={(val) => updateOrderField(order, 'payment_status', val)}>
                                                <SelectTrigger className="w-[150px] h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Not Paid">Not Paid</SelectItem>
                                                    <SelectItem value="Paid">Paid</SelectItem>
                                                    <SelectItem value="Partial">Partial</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>`;

const newPaymentStr = `<div className="flex flex-col gap-3 pt-2 mt-4 border-t">
                                            <div className="flex justify-between items-center">
                                                <Label>{t("Payment Status")}</Label>
                                                <Select value={order.payment_status === 'Partial' ? 'Partially Paid' : (order.payment_status || "Not Paid")} onValueChange={(val) => {
                                                    updateOrderField(order, 'payment_status', val);
                                                    if (val === 'Paid') updateOrderField(order, 'paid_amount', order.total_amount);
                                                    if (val === 'Not Paid') updateOrderField(order, 'paid_amount', 0);
                                                }}>
                                                    <SelectTrigger className="w-[150px] h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="Not Paid">Not Paid</SelectItem>
                                                        <SelectItem value="Partially Paid">Partially Paid</SelectItem>
                                                        <SelectItem value="Paid">Paid</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            {order.payment_status === 'Partially Paid' && (
                                                <div className="flex justify-between items-center">
                                                    <Label>{t("Paid Amount")}</Label>
                                                    <Input 
                                                        type="number" 
                                                        className="w-[150px] h-8" 
                                                        value={order.paid_amount || 0}
                                                        onChange={(e) => updateOrderField(order, 'paid_amount', parseFloat(e.target.value) || 0)}
                                                    />
                                                </div>
                                            )}
                                        </div>`;
code = code.replace(oldPaymentStr, newPaymentStr);


fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done 2');
