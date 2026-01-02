import { supabase } from "./supabase";

export type InventoryItem = {
    variant_id: string;
    qty: number;
    track_inventory: boolean;
    current_stock: number;
};

/**
 * Validates if the order can be placed based on stock and track_inventory settings.
 * Returns true if valid, throws error if invalid.
 */
export async function validateStock(items: InventoryItem[]) {
    for (const item of items) {
        if (item.track_inventory && item.current_stock < item.qty) {
            throw new Error(`Insufficient stock for item variant ${item.variant_id}. Available: ${item.current_stock}, Requested: ${item.qty}`);
        }
    }
    return true;
}

/**
 * Deducts stock for a list of items and logs transactions.
 */
export async function deductStock(
    items: { variant_id: string; qty: number }[],
    orderId: string,
    note: string = "Order Creation",
    type: string = "sale"
) {
    for (const item of items) {
        // 1. Decrement Stock
        const { error: updateError } = await supabase.rpc('decrement_stock', {
            row_id: item.variant_id,
            amount: item.qty
        });

        // 2. Log Transaction
        if (!updateError) {
            await supabase.from('inventory_transactions').insert({
                variant_id: item.variant_id,
                quantity_change: -item.qty,
                transaction_type: type,
                reference_id: orderId,
                note: note
            });
        }
    }
}

/**
 * Restocks items for a returned order.
 */
export async function restockItems(
    items: { variant_id: string; qty: number }[],
    orderId: string,
    note: string = "Order Returned"
) {
    for (const item of items) {
        // 1. Increment Stock
        const { error: updateError } = await supabase.rpc('increment_stock', {
            row_id: item.variant_id,
            amount: item.qty
        });

        // 2. Log Transaction
        if (!updateError) {
            await supabase.from('inventory_transactions').insert({
                variant_id: item.variant_id,
                quantity_change: item.qty,
                transaction_type: 'return',
                reference_id: orderId,
                note: note
            });
        }
    }
}
