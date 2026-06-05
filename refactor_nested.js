const fs = require('fs');
const path = require('path');

const files = [
    'src/app/(dashboard)/orders/[id]/page.tsx',
    'src/app/(dashboard)/orders/new/page.tsx',
    'src/app/(dashboard)/products/[id]/page.tsx',
    'src/app/(dashboard)/products/new/page.tsx',
    'src/app/(dashboard)/insights/page.tsx',
    'src/app/(dashboard)/shipping/[id]/page.tsx',
    'src/app/(dashboard)/shipping/update/page.tsx'
];

files.forEach(file => {
    let content = "";
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch(e) {
        return;
    }
    
    let modified = false;

    if (!content.includes('useBusiness')) {
        content = content.replace('import { supabase } from "@/lib/supabase";', 'import { supabase } from "@/lib/supabase";\nimport { useBusiness } from "@/contexts/BusinessContext";');
        modified = true;
    }

    const functionMatch = content.match(/export default function \w+\([^)]*\) \{/);
    if (functionMatch && !content.includes('const { activeBusiness } = useBusiness();')) {
        content = content.replace(functionMatch[0], `${functionMatch[0]}\n    const { activeBusiness } = useBusiness();`);
        modified = true;
    }

    const tables = ['orders', 'products', 'customers', 'variants', 'transactions', 'supplier_invoices', 'ads_expenses', 'shipping_companies'];
    tables.forEach(table => {
        const regex = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)\\.select\\([^)]*\\)`, 'g');
        content = content.replace(regex, match => {
            if (match.includes('business_id')) return match;
            return match + '.eq("business_id", activeBusiness?.id)';
        });
    });

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Updated", file);
    }
});
