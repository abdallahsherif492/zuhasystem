export interface Product {
    id: string;
    name: string;
    description: string | null;
    category_id: string | null;
    created_at: string;
}

export interface Variant {
    id: string;
    product_id: string;
    sku: string | null;
    title: string;
    sale_price: number;
    cost_price: number;
    track_inventory: boolean;
    stock_qty: number;
}

export interface ProductWithVariants extends Product {
    variants: Variant[];
}
