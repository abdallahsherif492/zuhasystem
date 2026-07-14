const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

code = code.replace(
    'payment_status: string;',
    'payment_status: string;\n    paid_amount: number;'
);

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done 5');
