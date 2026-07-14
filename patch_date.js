const fs = require('fs');
let code = fs.readFileSync('src/app/api/webhooks/easyorders/route.ts', 'utf8');

const oldInsert = `                business_id: businessId,
                customer_id: customerId,
                customer_info: customerInfo,`;

const newInsert = `                business_id: businessId,
                customer_id: customerId,
                customer_info: customerInfo,
                created_at: payload.created_at || payload.date || payload.order_date || new Date().toISOString(),`;

code = code.replace(oldInsert, newInsert);

fs.writeFileSync('src/app/api/webhooks/easyorders/route.ts', code);
console.log('done patch date');
