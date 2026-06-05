import fs from 'fs';

const files = [
    'src/app/(dashboard)/orders/page.tsx',
    'src/app/(dashboard)/products/page.tsx',
    'src/app/(dashboard)/customers/page.tsx',
    'src/app/(dashboard)/purchases/page.tsx',
    'src/app/(dashboard)/ads/page.tsx',
    'src/app/(dashboard)/accounting/page.tsx',
    'src/app/(dashboard)/insights/page.tsx',
    'src/app/(dashboard)/team/page.tsx'
];

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;

    // Ensure useBusiness is there
    if (!content.includes('useBusiness')) {
        content = content.replace('import { supabase } from "@/lib/supabase";', 'import { supabase } from "@/lib/supabase";\nimport { useBusiness } from "@/contexts/BusinessContext";');
        modified = true;
    }

    // Ensure activeBusiness is extracted
    const funcMatch = content.match(/export default function \w+\(\) \{/);
    if (funcMatch && !content.includes('const { activeBusiness } = useBusiness();')) {
        content = content.replace(funcMatch[0], `${funcMatch[0]}\n    const { activeBusiness } = useBusiness();`);
        modified = true;
    }
    
    // Some files might have the component separate (like OrdersContent)
    const contentFuncMatch = content.match(/function \w+Content\(\) \{/);
    if (contentFuncMatch && !content.includes('const { activeBusiness } = useBusiness();')) {
        content = content.replace(contentFuncMatch[0], `${contentFuncMatch[0]}\n    const { activeBusiness } = useBusiness();`);
        modified = true;
    }

    // Add activeBusiness dependency to fetch
    content = content.replace(/useEffect\(\(\) => \{\s*fetch[^}]*?\}, \[\]\);/g, match => {
        modified = true;
        return match.replace('[]', '[activeBusiness]');
    });

    // Add return if !activeBusiness in fetch
    content = content.replace(/async function fetch\w+\(\) \{/g, match => {
        modified = true;
        return match + '\n        if (!activeBusiness) return;';
    });

    // Inject .eq("business_id", activeBusiness.id) for specific tables
    const tables = ['orders', 'products', 'customers', 'supplier_invoices', 'ads_expenses', 'transactions', 'business_users', 'financial_accounts'];
    for (const table of tables) {
        // Regex to match supabase.from("table").select("something")
        // and supabase.from("table").select(`something`)
        const regex = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)\\.select\\([^)]*\\)`, 'g');
        content = content.replace(regex, match => {
            if (match.includes('business_id')) return match;
            modified = true;
            return match + ".eq('business_id', activeBusiness.id)";
        });
    }

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Updated", file);
    }
}
