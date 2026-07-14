const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

const executePendingStr = `
    const executeMoveToPending = async (order: Order, accountName?: string) => {
        setSaving(order.id);
        try {
            await handleUpdateOrder(order.id, { status: 'Pending' });
            
            // Create transaction if paid
            if (accountName && order.paid_amount > 0) {
                await supabase.from('transactions').insert({
                    business_id: activeBusiness?.id,
                    transaction_date: new Date().toISOString().split('T')[0],
                    type: 'revenue',
                    category: 'orders_collection',
                    amount: order.paid_amount,
                    description: \`Payment collection for Order \${order.easyorders_id || order.id.slice(0,8)}\`,
                    account_name: accountName
                });
            }
            
            toast.success(t("Order moved to Pending successfully"));
            setOrders(orders.filter(o => o.id !== order.id));
            setTreasuryModalOpen(false);
            setPendingOrder(null);
            setTransactionAccount("");
        } catch (error) {
            console.error("Error moving to pending:", error);
            toast.error(t("Failed to move order"));
        } finally {
            setSaving(null);
        }
    };
`;
code = code.replace('const handleMoveToPending = async (order: Order) => {', executePendingStr + '\n    const handleMoveToPending = async (order: Order) => {');

const oldHandleMove = `
        setSaving(order.id);
        try {
            await handleUpdateOrder(order.id, { status: 'Pending' });
            toast.success(t("Order moved to Pending successfully"));
            setOrders(orders.filter(o => o.id !== order.id));
        } catch (error) {
            console.error("Error moving to pending:", error);
            toast.error(t("Failed to move order"));
        } finally {
            setSaving(null);
        }
`;
const newHandleMove = `
        if (order.payment_status === 'Paid' || order.payment_status === 'Partially Paid') {
            setPendingOrder(order);
            setTreasuryModalOpen(true);
        } else {
            executeMoveToPending(order);
        }
`;
code = code.replace(oldHandleMove, newHandleMove);


const modalStr = `
            {/* Treasury Transaction Modal */}
            <AlertDialog open={treasuryModalOpen} onOpenChange={setTreasuryModalOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Payment Collection</AlertDialogTitle>
                        <AlertDialogDescription>
                            This order has a payment of {formatCurrency(pendingOrder?.paid_amount || 0)}. Select the treasury account to deposit this amount into.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Select Account</Label>
                            <Select value={transactionAccount} onValueChange={setTransactionAccount}>
                                <SelectTrigger><SelectValue placeholder="Choose Account" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Mohamed Adel">Mohamed Adel</SelectItem>
                                    <SelectItem value="Abdallah Sherif">Abdallah Sherif</SelectItem>
                                    <SelectItem value="Split">Split (50/50)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => { setPendingOrder(null); setTransactionAccount(""); }}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            disabled={!transactionAccount || saving === pendingOrder?.id}
                            onClick={() => pendingOrder && executeMoveToPending(pendingOrder, transactionAccount)}
                        >
                            {saving === pendingOrder?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm & Deposit
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
`;
code = code.replace('{orders.length === 0 ? (', modalStr + '\n            {orders.length === 0 ? (');

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done 4');
