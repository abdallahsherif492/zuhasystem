const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

// Check if Suspense is imported
if (!code.includes('Suspense')) {
    code = code.replace(
        'import { useEffect, useState, useMemo } from "react";',
        'import { useEffect, useState, useMemo, Suspense } from "react";'
    );
}

// Rename EasyOrdersPage to EasyOrdersContent
code = code.replace(
    'export default function EasyOrdersPage() {',
    'function EasyOrdersContent() {'
);

// Add default export at the end
code = code + `

export default function EasyOrdersPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <EasyOrdersContent />
        </Suspense>
    );
}
`;

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done patching easy orders suspense');
