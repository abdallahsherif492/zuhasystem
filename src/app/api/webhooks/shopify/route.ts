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
    let requestHeaders: Record<string, string> = {};
    
    try {
        const topic = req.headers.get('x-shopify-topic') || '';
        const shopHeader = req.headers.get('x-shopify-shop-domain') || '';
        const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || '';

        req.headers.forEach((value, key) => {
            requestHeaders[key] = value;
        });

        // Read raw body text for HMAC validation and parsing
        const rawBody = await req.text();

        // 1. Log incoming request to database (best effort)
        let parsedPayloadForLog = null;
        try {
            parsedPayloadForLog = rawBody ? JSON.parse(rawBody) : null;
        } catch(e) {
            parsedPayloadForLog = { raw: rawBody };
        }

        await supabase.from('webhook_logs').insert({
            headers: requestHeaders,
            payload: parsedPayloadForLog
        });

        console.log(`[Shopify Webhook Debug] Received request. Topic: ${topic}, Shop: ${shopHeader}`);

        // HMAC Signature Verification if webhook secret is configured
        const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET;
        if (webhookSecret && hmacHeader) {
            const calculatedHmac = crypto
                .createHmac('sha256', webhookSecret)
                .update(rawBody, 'utf8')
                .digest('base64');

            if (calculatedHmac !== hmacHeader) {
                console.warn('[Shopify Webhook Debug] Invalid HMAC signature for shop:', shopHeader);
                return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
            }
            console.log(`[Shopify Webhook Debug] HMAC signature verified.`);
        } else {
             console.log(`[Shopify Webhook Debug] No HMAC secret configured, skipping signature validation.`);
        }

        // Acknowledge non-order topics or pings with 200 OK so Shopify does not disable webhook
        if (topic && !topic.startsWith('orders/')) {
            console.log(`[Shopify Webhook Debug] Acknowledged ignored topic: ${topic}`);
            return NextResponse.json({ message: `Topic '${topic}' acknowledged` }, { status: 200 });
        }

        let body: any = {};
        try {
            body = JSON.parse(rawBody);
            console.log(`[Shopify Webhook Debug] Successfully parsed JSON payload. Order ID: ${body.id}`);
        } catch (e) {
            console.error('[Shopify Webhook Debug] Failed to parse JSON body');
            return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
        }

        if (!body || !body.id) {
            console.log('[Shopify Webhook Debug] Empty payload or test ping received');
            return NextResponse.json({ message: 'Payload received successfully' }, { status: 200 });
        }

        // Parse businessId from URL query parameter
        const { searchParams } = new URL(req.url);
        const queryBusinessId = searchParams.get('businessId') || searchParams.get('business');
        console.log(`[Shopify Webhook Debug] queryBusinessId from URL: ${queryBusinessId}`);

        let businessId = '';
        if (queryBusinessId) {
            const { data: b, error: bError } = await supabase
                .from('businesses')
                .select('id')
                .eq('id', queryBusinessId)
                .maybeSingle();
            if (bError) console.error(`[Shopify Webhook Debug] Error querying business by ID: ${bError.message}`);
            if (b) {
                businessId = b.id;
                console.log(`[Shopify Webhook Debug] Business found by query ID: ${businessId}`);
            } else {
                 console.log(`[Shopify Webhook Debug] Business NOT found by query ID: ${queryBusinessId}`);
            }
        }

        if (!businessId) {
            console.log(`[Shopify Webhook Debug] Falling back to domain matching...`);
            // Fallback: Find business by shopify_store_domain in theme_config
            const { data: businesses, error: bizError } = await supabase
                .from('businesses')
                .select('id, theme_config');

            if (bizError) {
                console.error('[Shopify Webhook Debug] Error fetching businesses:', bizError.message);
            }

            const matchedBiz = (businesses || []).find(b => {
                const domain = b.theme_config?.integrations?.platforms?.shopify?.storeDomain || b.theme_config?.shopify_store_domain || '';
                const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
                const normalizedShop = shopHeader.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
                return normalizedDomain && (normalizedDomain.includes(normalizedShop) || normalizedShop.includes(normalizedDomain));
            });

            businessId = matchedBiz ? matchedBiz.id : '';
            if (businessId) {
                console.log(`[Shopify Webhook Debug] Business found by domain match: ${businessId}`);
            }
        }

        if (!businessId) {
            console.error('[Shopify Webhook Debug] No business found for query ID:', queryBusinessId, 'or shop domain:', shopHeader);
            return NextResponse.json({ error: 'Business not found for Shopify store' }, { status: 404 });
        }


        const shopifyOrderId = String(body.id || '');
        const orderName = body.name || `#${body.order_number || body.id}`;
        console.log(`[Shopify Webhook Debug] Processing Order: ${orderName}`);

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
        console.log(`[Shopify Webhook Debug] Customer Info parsed: ${JSON.stringify(customerInfo)}`);

        // Create or find customer based on phone number and business ID (matching easyorders logic)
        let customerId = null;
        if (phone) {
            console.log(`[Shopify Webhook Debug] Searching for existing customer with phone: ${phone}`);
            const { data: existingCustomers, error: searchError } = await supabase
                .from('customers')
                .select('id')
                .eq('phone', phone)
                .eq('business_id', businessId)
                .limit(1);

            if (searchError) console.error(`[Shopify Webhook Debug] Error searching customers: ${searchError.message}`);

            if (existingCustomers && existingCustomers.length > 0) {
                customerId = existingCustomers[0].id;
                console.log(`[Shopify Webhook Debug] Existing customer found: ${customerId}`);
            } else {
                console.log(`[Shopify Webhook Debug] Creating new customer...`);
                // Create customer
                const { data: newCustomer, error: createError } = await supabase
                    .from('customers')
                    .insert({
                        business_id: businessId,
                        name: customerName,
                        phone: phone,
                        phone2: '',
                        address: fullAddress,
                        governorate: governorate
                    })
                    .select('id')
                    .single();
                
                if (createError) console.error(`[Shopify Webhook Debug] Error creating customer: ${createError.message}`);
                
                if (newCustomer) {
                    customerId = newCustomer.id;
                    console.log(`[Shopify Webhook Debug] New customer created: ${customerId}`);
                }
            }
        } else {
            console.log(`[Shopify Webhook Debug] No phone number provided, skipping customer creation.`);
        }

        const lineItems = body.line_items || [];
        const totalAmount = Number(body.total_price || 0);

        // Shipping Cost calculation (checking total_shipping_price_set and shipping_lines array)
        let shippingCost = Number(body.total_shipping_price_set?.shop_money?.amount || 0);
        if (shippingCost === 0 && Array.isArray(body.shipping_lines)) {
            shippingCost = body.shipping_lines.reduce((sum: number, line: any) => sum + Number(line.price || 0), 0);
        }
        const subtotal = totalAmount - shippingCost;

        console.log(`[Shopify Webhook Debug] Financials: Total: ${totalAmount}, Subtotal: ${subtotal}, Shipping: ${shippingCost}`);

        // Hardcode payment status to Not Paid (ignoring Shopify financial_status as requested)
        const paymentStatus = 'Not Paid';
        const paidAmount = 0;

        // Check if order already exists
        console.log(`[Shopify Webhook Debug] Checking if order ${shopifyOrderId} already exists...`);
        const { data: existingOrder, error: existingError } = await supabase
            .from('orders')
            .select('id')
            .eq('shopify_id', shopifyOrderId)
            .maybeSingle();

        if (existingError) console.error(`[Shopify Webhook Debug] Error checking existing order: ${existingError.message}`);

        let orderId = existingOrder?.id;
        let isNewOrder = false;

        if (!orderId) {
            isNewOrder = true;
            console.log(`[Shopify Webhook Debug] Inserting new order into database...`);
            const { data: newOrder, error: insertError } = await supabase
                .from('orders')
                .insert({
                    business_id: businessId,
                    customer_id: customerId,
                    shopify_id: shopifyOrderId,
                    customer_info: customerInfo,
                    status: 'Waiting',
                    subtotal: subtotal,
                    total_amount: totalAmount,
                    total_cost: 0,
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
                console.error('[Shopify Webhook Debug] Order Insert Error:', insertError);
                throw insertError;
            }
            orderId = newOrder.id;
            console.log(`[Shopify Webhook Debug] Order successfully inserted with ID: ${orderId}`);
        } else {
             console.log(`[Shopify Webhook Debug] Order already exists with ID: ${orderId}, skipping insert.`);
        }

        // Process line items
        if (isNewOrder) {
            console.log(`[Shopify Webhook Debug] Processing ${lineItems.length} line items...`);
            for (const item of lineItems) {
                const sku = item.sku || '';
                const itemPrice = Number(item.price || 0);
                const quantity = Number(item.quantity || 1);

                // Try to match variant by SKU
                let matchedVariantId: string | null = null;
                if (sku) {
                    const { data: v, error: vError } = await supabase
                        .from('variants')
                        .select('id')
                        .eq('sku', sku)
                        .maybeSingle();
                    if (vError) console.error(`[Shopify Webhook Debug] Error searching for variant sku ${sku}: ${vError.message}`);
                    if (v) matchedVariantId = v.id;
                }

                console.log(`[Shopify Webhook Debug] Inserting line item ${item.title} (SKU: ${sku}). Matched Variant: ${matchedVariantId}`);
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
                    console.error('[Shopify Webhook Debug] Order Item Insert Error:', itemError);
                }
            }

            // Record in Actions Log Audit Trail
            console.log(`[Shopify Webhook Debug] Logging action to Actions Log...`);
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

        console.log(`[Shopify Webhook Debug] Successfully processed order ${orderName} (ID: ${orderId})`);
        return NextResponse.json({ success: true, order_id: orderId }, { status: 200 });

    } catch (error: any) {
        console.error('[Shopify Webhook Debug] Exception caught in POST handler:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }

}
