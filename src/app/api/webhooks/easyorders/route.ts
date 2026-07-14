import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Dictionary for Governorate mapping (Arabic to English)
const GOVERNORATE_MAPPING: Record<string, string> = {
    'القاهرة': 'Cairo',
    'الاسكندرية': 'Alexandria',
    'الإسكندرية': 'Alexandria',
    'الجيزة': 'Giza',
    'القليوبية': 'Qalyubia',
    'الدقهلية': 'Dakahlia',
    'الشرقية': 'Al Sharqia',
    'المنوفية': 'Monufia',
    'الغربية': 'Gharbia',
    'البحيرة': 'Beheira',
    'كفر الشيخ': 'Kafr El Sheikh',
    'دمياط': 'Damietta',
    'بورسعيد': 'Port Said',
    'الإسماعيلية': 'Ismailia',
    'الاسماعيلية': 'Ismailia',
    'السويس': 'Suez',
    'مطروح': 'Matrouh',
    'البحر الأحمر': 'Red Sea',
    'البحر الاحمر': 'Red Sea',
    'شمال سيناء': 'North Sinai',
    'جنوب سيناء': 'South Sinai',
    'بني سويف': 'Beni Suef',
    'المنيا': 'Minya',
    'الفيوم': 'Faiyum',
    'أسيوط': 'Asyut',
    'اسيوط': 'Asyut',
    'سوهاج': 'Sohag',
    'قنا': 'Qena',
    'الأقصر': 'Luxor',
    'الاقصر': 'Luxor',
    'أسوان': 'Aswan',
    'اسوان': 'Aswan',
    'الوادي الجديد': 'New Valley'
};

export async function POST(request: Request) {
    let rawBody = "";
    let requestHeaders: Record<string, string> = {};
    
    try {
        const { searchParams } = new URL(request.url);
        const businessId = searchParams.get('business');
        const token = searchParams.get('token');

        // Extract headers for debugging
        request.headers.forEach((value, key) => {
            requestHeaders[key] = value;
        });

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        
        const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false }
        });

        // Try reading body early
        rawBody = await request.text();

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

        if (!businessId || !token) {
            return NextResponse.json({ success: false, error: 'Missing business or token query parameters in the URL' }, { status: 200 });
        }

        // 2. Verify token
        const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('theme_config')
            .eq('id', businessId)
            .single();

        if (businessError || !business) {
            return NextResponse.json({ success: false, error: 'Business not found. Check if the business ID in URL is correct.' }, { status: 200 });
        }

        if (business.theme_config?.easyorders_token !== token) {
            return NextResponse.json({ success: false, error: 'Invalid token. Please regenerate your Webhook URL in settings and update EasyOrders.' }, { status: 200 });
        }

        // 3. Parse Payload
        let payload;
        try {
            payload = JSON.parse(rawBody);
        } catch (e) {
            return NextResponse.json({ success: false, error: 'Invalid JSON payload structure received' }, { status: 200 });
        }
        
        // Ignore status update events for now
        if (payload.event_type === 'order-status-update') {
            return NextResponse.json({ success: true, message: 'Status update ignored' }, { status: 200 });
        }
        
        // Basic check to prevent duplicate webhooks if easyorders provides an ID
        const easyOrderId = payload.id?.toString() || payload.order_id?.toString() || null;
        if (!easyOrderId) {
            return NextResponse.json({ error: 'Missing order ID' }, { status: 400 });
        }

        const { data: existingOrder } = await supabase
            .from('orders')
            .select('id')
            .eq('easyorders_id', easyOrderId)
            .eq('business_id', businessId)
            .maybeSingle();

        if (existingOrder) {
            return NextResponse.json({ message: 'Order already processed' }, { status: 200 });
        }

        // 3. Customer Info Mapping
        const customerName = payload.full_name || payload.customer_name || payload.customer?.name || "Unknown Customer";
        const phone1 = payload.phone || payload.customer?.phone || "";
        const phone2 = payload.phone2 || payload.customer?.phone2 || "";
        const address = payload.address || payload.shipping?.address || "";
        const rawGov = payload.government || payload.governorate || payload.shipping?.city || payload.city || "";
        const mappedGov = GOVERNORATE_MAPPING[rawGov.trim()] || rawGov;

        const customerInfo = {
            name: customerName,
            phone: phone1,
            phone2: phone2,
            address: address,
            governorate: mappedGov,
            raw_easyorders_gov: rawGov
        };

        // Let's create or find the customer based on phone number and business ID
        let customerId = null;
        if (phone1) {
            const { data: existingCustomers } = await supabase
                .from('customers')
                .select('id')
                .eq('phone', phone1)
                .eq('business_id', businessId)
                .limit(1);

            if (existingCustomers && existingCustomers.length > 0) {
                customerId = existingCustomers[0].id;
            } else {
                // Create customer
                const { data: newCustomer } = await supabase
                    .from('customers')
                    .insert({
                        business_id: businessId,
                        name: customerName,
                        phone: phone1,
                        phone2: phone2,
                        address: address,
                        governorate: mappedGov,
                        total_orders: 0,
                        total_spent: 0
                    })
                    .select('id')
                    .single();
                
                if (newCustomer) {
                    customerId = newCustomer.id;
                }
            }
        }

        // 4. Calculate Shipping and Total
        const shippingCost = parseFloat(payload.shipping_cost || payload.shipping || 0);
        let calculatedSubtotal = 0;
        let calculatedTotalCost = 0;

        // Extract items
        const rawItems = payload.cart_items || payload.items || payload.line_items || [];
        
        // We need to fetch all variants to match SKUs
        const { data: allVariants } = await supabase
            .from('variants')
            .select('id, sku, sale_price, cost_price, title, product_id')
            .eq('business_id', businessId);

        const variantsMap = new Map();
        if (allVariants) {
            allVariants.forEach(v => {
                if (v.sku) variantsMap.set(v.sku.toLowerCase(), v);
            });
        }

        const processedItems = [];

        for (const item of rawItems) {
            // EasyOrders puts sku in product.sku or variant.taager_code
            let itemSku = (item.variant?.taager_code || item.product?.sku || item.sku || "").toString().toLowerCase();
            const itemQty = parseInt(item.quantity || item.qty || 1);
            let itemPrice = parseFloat(item.price || 0);
            const itemName = item.product?.name || item.name || item.title || "Unknown Item";

            const matchedVariant = itemSku ? variantsMap.get(itemSku) : null;
            
            let variantId = null;
            let costAtSale = 0;

            if (matchedVariant) {
                variantId = matchedVariant.id;
                costAtSale = matchedVariant.cost_price || 0;
                // We use the price from the payload, but if it's 0 or missing we could fallback to matchedVariant.sale_price
                if (!itemPrice && matchedVariant.sale_price) {
                    itemPrice = matchedVariant.sale_price;
                }
            }

            calculatedSubtotal += (itemPrice * itemQty);
            calculatedTotalCost += (costAtSale * itemQty);

            processedItems.push({
                variant_id: variantId,
                quantity: itemQty,
                price_at_sale: itemPrice,
                cost_at_sale: costAtSale,
                unmapped_name: !variantId ? itemName : null,
                unmapped_sku: !variantId ? item.sku : null
            });
        }

        const totalAmount = calculatedSubtotal + shippingCost;

        // 5. Create Order
        const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert({
                business_id: businessId,
                customer_id: customerId,
                customer_info: customerInfo,
                status: 'Waiting',
                channel: 'Website',
                tags: ['easyorders'],
                subtotal: calculatedSubtotal,
                shipping_cost: shippingCost,
                total_amount: totalAmount,
                total_cost: calculatedTotalCost,
                easyorders_id: easyOrderId,
                payment_status: 'Not Paid',
                paid_amount: 0
            })
            .select('id')
            .single();

        if (orderError) {
            console.error("Order Insert Error:", orderError);
            return NextResponse.json({ success: false, error: 'Failed to create order in database', details: orderError.message }, { status: 200 });
        }

        // 6. Create Order Items
        const itemsToInsert = processedItems.map(item => ({
            ...item,
            order_id: newOrder.id
        }));

        if (itemsToInsert.length > 0) {
            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(itemsToInsert);

            if (itemsError) {
                console.error("Order Items Insert Error:", itemsError);
            }
        }

        return NextResponse.json({ success: true, order_id: newOrder.id }, { status: 200 });

    } catch (error: any) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ success: false, error: 'Internal Server Error', details: error?.message || String(error) }, { status: 200 });
    }
}
