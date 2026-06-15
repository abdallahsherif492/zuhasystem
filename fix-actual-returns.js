const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/insights/actual-returns/page.tsx', 'utf8');

// 1. Update the select clause to include actual_shipping_cost
content = content.replace(
    ".select('created_at, total_amount, total_cost, shipping_cost, status, customer_info')",
    ".select('created_at, total_amount, total_cost, shipping_cost, actual_shipping_cost, status, customer_info')"
);

// 2. Replace the hardcoded courierRate calculation
const hardcodedLogic = `                const gov = String(o.customer_info?.governorate || '');
                const isCairoGiza = gov === 'Cairo' || gov === 'Giza' || gov === 'New Cairo' || gov === 'القاهرة' || gov === 'الجيزة';
                const courierRate = isCairoGiza ? 65 : 75;`;

const newLogic = `                const courierRate = Number(o.actual_shipping_cost) || 0;`;

content = content.replace(hardcodedLogic, newLogic);

// 3. Update the UI text that says "(65/75 EGP per order)"
content = content.replace(
    "- Courier Fees (65/75 EGP per order)",
    "- Courier Fees (Actual Cost)"
);

fs.writeFileSync('src/app/(dashboard)/insights/actual-returns/page.tsx', content);
