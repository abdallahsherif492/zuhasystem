export type InventoryItem = {
    variant_id: string;
    qty: number;
    track_inventory: boolean;
    current_stock: number;
};

/**
 * Order statuses in which the goods have physically left the shelf.
 *
 * MUST stay in sync with the SQL function `is_stock_out()` in
 * supabase/migrations/20260730_inventory_ledger.sql — the database is the
 * authority that actually moves stock; this copy exists only so the UI can
 * warn about overselling before a save. Compared lower-cased.
 */
export const STOCK_OUT_STATUSES = [
    "prepared",
    "shipped",
    "delivered",
    "collected",
    "hold to redeliver",
    "returning",
];

/**
 * Validates that tracked items have enough stock. Returns true, or throws.
 *
 * This is an oversell guard only. Stock is mutated exclusively by database
 * triggers (see the inventory ledger migration) so that every path — the
 * courier sync, the CSV importer, bulk actions, order edits — moves stock
 * consistently and writes the audit ledger. Nothing in the app deducts or
 * restocks directly anymore.
 */
export async function validateStock(items: InventoryItem[]) {
    for (const item of items) {
        if (item.track_inventory && item.current_stock < item.qty) {
            throw new Error(`Insufficient stock for item variant ${item.variant_id}. Available: ${item.current_stock}, Requested: ${item.qty}`);
        }
    }
    return true;
}
