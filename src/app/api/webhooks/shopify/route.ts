import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const shopHeader = req.headers.get('x-shopify-shop-domain') || '';
        
        // Find business by shopify_store_domain in theme_config
        const { data: businesses } = await supabase
            .from('businesses')
            .select('id, theme_config');

        const matchedBiz = (businesses || []).find(b => {
            const domain = b.theme_config?.integrations?.platforms?.shopify?.storeDomain || b.theme_config?.shopify_store_domain || '';
            return domain && (domain.includes(shopHeader) || shopHeader.includes(domain));
        });

        const businessId = matchedBiz ? matchedBiz.id : (businesses?.[0]?.id || '');
        if (!businessId) {
            return NextResponse.json({ error: 'Business not found for Shopify store' }, { status: 404 });
        }

        const shopifyOrderId = String(body.id || '');
        const orderName = body.name || `#${body.order_number}`;

        // Customer Info
        const customerObj = body.customer || {};
        const shippingObj = body.shipping_address || body.billing_address || {};

        const customerInfo = {
            name: `${shippingObj.first_name || customerObj.first_name || ''} ${shippingObj.last_name || customerObj.last_name || ''}`.trim() || 'Shopify Customer',
            phone: shippingObj.phone || customerObj.phone || '',
            phone2: '',
            address: `${shippingObj.address1 || ''} ${shippingObj.address2 || ''}`.trim(),
            city: shippingObj.city || '',
            governorate: shippingObj.province || shippingObj.city || ''
        };

        const lineItems = body.line_items || [];
        const totalAmount = Number(body.total_price || 0);
        const shippingCost = Number(body.total_shipping_price_set?.shop_money?.amount || 0);
        const subtotal = totalAmount - shippingCost;

        // Check if order already exists
        const { data: existingOrder } = await supabase
            .from('orders')
            .select('id')
            .eq('shopify_id', shopifyOrderId)
            .maybeSingle();

        let orderId = existingOrder?.id;

        if (!orderId) {
            const { data: newOrder, error: insertError } = await supabase
                .from('orders')
                .insert({
                    business_id: businessId,
                    shopify_id: shopifyOrderId,
                    customer_info: customerInfo,
                    status: 'Waiting',
                    subtotal: subtotal,
                    total_amount: totalAmount,
                    shipping_cost: shippingCost,
                    channel: 'Website',
                    tags: ['shopify', orderName],
                    notes: body.note || ''

                })
                .select('id')
                .single();

            if (insertError) throw insertError;
            orderId = newOrder.id;
        }

        // Process line items
        for (const item of lineItems) {
            const sku = item.sku || '';
            const itemPrice = Number(item.price || 0);
            const quantity = Number(item.quantity || 1);

            // Try to match variant by SKU
            let matchedVariantId: string | null = null;
            if (sku) {
                const { data: v } = await supabase
                    .from('variants')
                    .select('id')
                    .eq('sku', sku)
                    .maybeSingle();
                if (v) matchedVariantId = v.id;
            }

            await supabase
                .from('order_items')
                .insert({
                    order_id: orderId,
                    variant_id: matchedVariantId,
                    quantity: quantity,
                    price_at_sale: itemPrice,
                    unmapped_name: item.name || item.title,
                    unmapped_sku: sku
                });
        }

        return NextResponse.json({ success: true, order_id: orderId });
    } catch (error: any) {
        console.error('Shopify Webhook Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
