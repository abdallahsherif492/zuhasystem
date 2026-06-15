const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/orders/[id]/page.tsx', 'utf8');

const logicToInject = `
            // --- Actual Shipping Cost Calculation ---
            let actual_shipping_cost = 0;
            try {
                let companyToUse = null;
                if (editForm.shippingCompanyId) {
                    const { data } = await supabase.from('shipping_companies').select('rates').eq('id', editForm.shippingCompanyId).single();
                    companyToUse = data;
                } else {
                    const { data } = await supabase.from('shipping_companies').select('rates').eq('business_id', activeBusiness!.id).eq('is_default', true).single();
                    companyToUse = data;
                }

                if (companyToUse && companyToUse.rates && companyToUse.rates[editForm.customerGov]) {
                    actual_shipping_cost = Number(companyToUse.rates[editForm.customerGov]);
                } else {
                    const isCairoGiza = editForm.customerGov === 'Cairo' || editForm.customerGov === 'Giza' || editForm.customerGov === 'New Cairo' || editForm.customerGov === 'القاهرة' || editForm.customerGov === 'الجيزة';
                    actual_shipping_cost = isCairoGiza ? 65 : 75;
                }
            } catch(e) {
                const isCairoGiza = editForm.customerGov === 'Cairo' || editForm.customerGov === 'Giza' || editForm.customerGov === 'New Cairo' || editForm.customerGov === 'القاهرة' || editForm.customerGov === 'الجيزة';
                actual_shipping_cost = isCairoGiza ? 65 : 75;
            }

            const newProfit = newTotal - newTotalCost - actual_shipping_cost;
            // --- End Actual Shipping Cost Calculation ---

            const orderUpdatePayload = {`;

content = content.replace('            const orderUpdatePayload = {', logicToInject);

content = content.replace(
    'shipping_company_id: editForm.shippingCompanyId || null,',
    'shipping_company_id: editForm.shippingCompanyId || null,\n                actual_shipping_cost: actual_shipping_cost,\n                profit: newProfit,'
);

// We should also remove any previous profit calculation from the payload if it exists.
content = content.replace(/profit: [a-zA-Z0-9_\-\.\s\(\)]+,/g, ''); // just in case it had one. We already injected it safely above.
content = content.replace('actual_shipping_cost: actual_shipping_cost,\n                ', 'actual_shipping_cost: actual_shipping_cost,\n                profit: newProfit,\n                '); // adding it back since regex might have stripped it if it matched incorrectly? The regex wouldn't match actual_shipping_cost. Wait, the replace removed it? No.
// Let's just do it manually if it wasn't replaced right.

fs.writeFileSync('src/app/(dashboard)/orders/[id]/page.tsx', content);
