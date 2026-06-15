const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/orders/new/page.tsx', 'utf8');

// Inside handleSave, right before 'const subtotal = calculateSubtotal();'
const actualShippingLogic = `
            // 1.5 Calculate Actual Shipping Cost based on Default Company
            let actual_shipping_cost = 0;
            try {
                const { data: defaultCompany } = await supabase
                    .from('shipping_companies')
                    .select('rates')
                    .eq('business_id', activeBusiness!.id)
                    .eq('is_default', true)
                    .single();

                if (defaultCompany && defaultCompany.rates && defaultCompany.rates[customerGov]) {
                    actual_shipping_cost = Number(defaultCompany.rates[customerGov]);
                } else {
                    const isCairoGiza = customerGov === 'Cairo' || customerGov === 'Giza' || customerGov === 'New Cairo' || customerGov === 'القاهرة' || customerGov === 'الجيزة';
                    actual_shipping_cost = isCairoGiza ? 65 : 75;
                }
            } catch(e) {
                const isCairoGiza = customerGov === 'Cairo' || customerGov === 'Giza' || customerGov === 'New Cairo' || customerGov === 'القاهرة' || customerGov === 'الجيزة';
                actual_shipping_cost = isCairoGiza ? 65 : 75;
            }

            // 2. Create Order
            const subtotal = calculateSubtotal();
            const totalCost = calculateTotalCost();
            const profit = calculateTotal() - totalCost - actual_shipping_cost;
`;

content = content.replace(
    '// 2. Create Order\n            const subtotal = calculateSubtotal();\n            const totalCost = calculateTotalCost();',
    actualShippingLogic
);

// Add actual_shipping_cost and profit to insert
content = content.replace(
    'shipping_cost: shippingCost,',
    'shipping_cost: shippingCost,\n                    actual_shipping_cost: actual_shipping_cost,\n                    profit: profit,'
);

// We need to remove the frontend 'profit' if it was being calculated incorrectly, but profit wasn't explicitly inserted before!
// Wait! `profit: calculateTotal() - totalCost` was it in the original insert?
if (!content.includes('profit: profit,')) {
    console.log("Failed to insert profit.");
}

fs.writeFileSync('src/app/(dashboard)/orders/new/page.tsx', content);
