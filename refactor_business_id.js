const fs = require('fs');
const path = require('path');

const files = [
    'src/app/(dashboard)/orders/page.tsx',
    'src/app/(dashboard)/products/page.tsx',
    'src/app/(dashboard)/customers/page.tsx',
    'src/app/(dashboard)/inventory/page.tsx',
    'src/app/(dashboard)/logistics/page.tsx',
    'src/app/(dashboard)/accounting/page.tsx',
    'src/app/(dashboard)/payable/page.tsx',
    'src/app/(dashboard)/purchases/page.tsx',
    'src/app/(dashboard)/ads/page.tsx'
];

files.forEach(file => {
    let content = "";
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch(e) {
        return;
    }
    
    let modified = false;

    // 1. Import useBusiness if not present
    if (!content.includes('useBusiness')) {
        content = content.replace('import { supabase } from "@/lib/supabase";', 'import { supabase } from "@/lib/supabase";\nimport { useBusiness } from "@/contexts/BusinessContext";');
        modified = true;
    }

    // 2. Inject activeBusiness hook into the main component
    const functionMatch = content.match(/export default function \w+\(\) \{/);
    if (functionMatch && !content.includes('const { activeBusiness } = useBusiness();')) {
        content = content.replace(functionMatch[0], `${functionMatch[0]}\n    const { activeBusiness } = useBusiness();`);
        modified = true;
    }

    // 3. Inject dependency into useEffect
    if (content.includes('useEffect(() => {') && content.includes('fetch') && !content.includes('[activeBusiness]')) {
        content = content.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/g, match => {
            return match.replace('[]', '[activeBusiness]');
        });
        modified = true;
    }

    // 4. Inject into select queries
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
