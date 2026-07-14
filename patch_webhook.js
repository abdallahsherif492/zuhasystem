const fs = require('fs');
let code = fs.readFileSync('src/app/api/webhooks/easyorders/route.ts', 'utf8');

const oldMapLogic = `        const variantsMap = new Map();
        if (allVariants) {
            allVariants.forEach(v => {
                if (v.sku) variantsMap.set(v.sku.toLowerCase(), v);
            });
        }`;

const newMapLogic = `        // Helper to normalize strings for better matching
        const normalizeStr = (str) => (str || "").toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        const variantsMap = new Map();
        if (allVariants) {
            allVariants.forEach(v => {
                if (v.sku) variantsMap.set(normalizeStr(v.sku), v);
            });
        }`;
code = code.replace(oldMapLogic, newMapLogic);

const oldSkuExtract = `            // EasyOrders puts sku in product.sku or variant.taager_code
            let itemSku = (item.variant?.taager_code || item.product?.sku || item.sku || "").toString().toLowerCase();`;

const newSkuExtract = `            // EasyOrders puts sku in product.sku or variant.taager_code
            let itemSku = normalizeStr(item.variant?.taager_code || item.product?.sku || item.sku || "");`;
code = code.replace(oldSkuExtract, newSkuExtract);

fs.writeFileSync('src/app/api/webhooks/easyorders/route.ts', code);
console.log('done webhook mapping patch');
