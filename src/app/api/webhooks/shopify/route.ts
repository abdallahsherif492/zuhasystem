import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logBusinessAction } from '@/lib/logs/actions-logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
const supabase = createClient(supabaseUrl, supabaseKey);

// GET handler for health checks and verification
export async function GET() {
    return NextResponse.json({ message: 'Shopify Webhook Endpoint Active' }, { status: 200 });
}

export async function POST(req: Request) {
    try {
        const topic = req.headers.get('x-shopify-topic') || '';
        const shopHeader = req.headers.get('x-shopify-shop-domain') || '';
        const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || '';

        // Read raw body text for HMAC validation and parsing
        const rawBody = await req.text();

        // HMAC Signature Verification if webhook secret is configured
        const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET;
        if (webhookSecret && hmacHeader) {
            const calculatedHmac = crypto
                .createHmac('sha256', webhookSecret)
                .update(rawBody, 'utf8')
                .digest('base64');

            if (calculatedHmac !== hmacHeader) {
                console.warn('[Shopify Webhook] Invalid HMAC signature for shop:', shopHeader);
                return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
            }
        }

        // Acknowledge non-order topics or pings with 200 OK so Shopify does not disable webhook
        if (topic && !topic.startsWith('orders/')) {
            console.log(`[Shopify Webhook] Acknowledged ignored topic: ${topic}`);
            return NextResponse.json({ message: `Topic '${topic}' acknowledged` }, { status: 200 });
        }

        let body: any = {};
        try {
            body = JSON.parse(rawBody);
        } catch (e) {
            console.error('[Shopify Webhook] Failed to parse JSON body');
            return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
        }

        if (!body || !body.id) {
            console.log('[Shopify Webhook] Empty payload or test ping received');
            return NextResponse.json({ message: 'Payload received successfully' }, { status: 200 });
        }

        // Find business by shopify_store_domain in theme_config
        const { data: businesses, error: bizError } = await supabase
            .from('businesses')
            .select('id, theme_config');

        if (bizError) {
            console.error('[Shopify Webhook] Error fetching businesses:', bizError.message);
        }

        const matchedBiz = (businesses || []).find(b => {
            const domain = b.theme_config?.integrations?.platforms?.shopify?.storeDomain || b.theme_config?.shopify_store_domain || '';
            const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
            const normalizedShop = shopHeader.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
            return normalizedDomain && (normalizedDomain.includes(normalizedShop) || normalizedShop.includes(normalizedDomain));
        });

        const businessId = matchedBiz ? matchedBiz.id : (businesses?.[0]?.id || '');
        if (!businessId) {
            console.error('[Shopify Webhook] No business found for shop:', shopHeader);
            return NextResponse.json({ error: 'Business not found for Shopify store' }, { status: 404 });
        }

        const shopifyOrderId = String(body.id || '');
        const orderName = body.name || `#${body.order_number || body.id}`;

        // Customer Info parsing across available address and customer objects
        const customerObj = body.customer || {};
        const shippingObj = body.shipping_address || body.billing_address || customerObj.default_address || {};
        const billingObj = body.billing_address || {};

        const firstName = shippingObj.first_name || customerObj.first_name || '';
        const lastName = shippingObj.last_name || customerObj.last_name || '';
        const customerName = `${firstName} ${lastName}`.trim() || customerObj.email || 'Shopify Customer';

        const phone = shippingObj.phone || billingObj.phone || customerObj.phone || customerObj.default_address?.phone || '';
        const addressLine1 = shippingObj.address1 || '';
        const addressLine2 = shippingObj.address2 || '';
        const fullAddress = `${addressLine1} ${addressLine2}`.trim();
        const city = shippingObj.city || billingObj.city || '';
        const governorate = shippingObj.province || shippingObj.city || billingObj.province || '';

        const customerInfo = {
            name: customerName,
            phone: phone,
            phone2: '',
            address: fullAddress,
            city: city,
            governorate: governorate
        };

        const lineItems = body.line_items || [];
        const totalAmount = Number(body.total_price || 0);

        // Shipping Cost calculation (checking total_shipping_price_set and shipping_lines array)
        let shippingCost = Number(body.total_shipping_price_set?.shop_money?.amount || 0);
        if (shippingCost === 0 && Array.isArray(body.shipping_lines)) {
            shippingCost = body.shipping_lines.reduce((sum: number, line: any) => sum + Number(line.price || 0), 0);
        }
        const subtotal = totalAmount - shippingCost;

        // Payment status mapping
        const financialStatus = (body.financial_status || '').toLowerCase();
        let paymentStatus = 'Not Paid';
        let paidAmount = 0;

        if (financialStatus === 'paid') {
            paymentStatus = 'Paid';
            paidAmount = totalAmount;
        } else if (financialStatus === 'partially_paid') {
            paymentStatus = 'Partially Paid';
            paidAmount = Number(body.total_outstanding ? totalAmount - Number(body.total_outstanding) : 0);
        }

        // Check if order already exists
        const { data: existingOrder } = await supabase
            .from('orders')
            .select('id')
            .eq('shopify_id', shopifyOrderId)
            .maybeSingle();

        let orderId = existingOrder?.id;
        let isNewOrder = false;

        if (!orderId) {
            isNewOrder = true;
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
                    channel: 'Shopify',
                    tags: ['shopify', orderName],
                    notes: body.note || '',
                    payment_status: paymentStatus,
                    paid_amount: paidAmount,
                    created_at: body.created_at ? new Date(body.created_at).toISOString() : new Date().toISOString()
                })
                .select('id')
                .single();

            if (insertError) {
                console.error('[Shopify Webhook] Order Insert Error:', insertError);
                throw insertError;
            }
            orderId = newOrder.id;
        }

        // Process line items
        if (isNewOrder) {
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

                const { error: itemError } = await supabase
                    .from('order_items')
                    .insert({
                        business_id: businessId,
                        order_id: orderId,
                        variant_id: matchedVariantId,
                        quantity: quantity,
                        price_at_sale: itemPrice,
                        unmapped_name: item.name || item.title || 'Shopify Product',
                        unmapped_sku: sku
                    });

                if (itemError) {
                    console.error('[Shopify Webhook] Order Item Insert Error:', itemError);
                }
            }

            // Record in Actions Log Audit Trail
            logBusinessAction({
                businessId: businessId,
                userEmail: 'Shopify Webhook',
                actionType: 'create',
                entityType: 'order',
                entityId: orderId,
                entityName: `Shopify Order ${orderName} (${customerName})`,
                changes: [
                    { field: 'Channel', old_value: null, new_value: 'Shopify' },
                    { field: 'Total Amount', old_value: null, new_value: `${totalAmount} EGP` },
                    { field: 'Customer', old_value: null, new_value: `${customerName} (${phone})` },
                    { field: 'Status', old_value: null, new_value: 'Waiting' }
                ]
            });
        }

        console.log(`[Shopify Webhook] Successfully processed order ${orderName} (ID: ${orderId})`);
        return NextResponse.json({ success: true, order_id: orderId }, { status: 200 });

    } catch (error: any) {
        console.error('[Shopify Webhook] Exception:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
