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

    const tables = ['orders', 'products', 'customers', 'supplier_invoices', 'ads_expenses', 'transactions', 'business_users', 'financial_accounts'];
    for (const table of tables) {
        // Multi-line select regex: .from("table").select(`something`)
        const regex = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)\\.select\\([\\s\\S]*?\\)`, 'g');
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
