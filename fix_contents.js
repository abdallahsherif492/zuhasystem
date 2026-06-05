const fs = require('fs');

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

    // Check if there's a Content component that uses activeBusiness but doesn't declare it
    if (content.match(/function \w+Content\(\) \{/)) {
        if (!content.match(/function \w+Content\(\) \{\s*const \{ activeBusiness \} = useBusiness\(\);/)) {
            content = content.replace(/(function \w+Content\(\) \{)/, '$1\n    const { activeBusiness } = useBusiness();');
            modified = true;
        }
    }
    
    // Also move imports from the bottom to the top just in case
    if (content.includes('import { cn } from "@/lib/utils";') && content.lastIndexOf('import { cn }') > content.length / 2) {
        content = content.replace('// Helper for cn (copying plain classnames without library if utility not imported, but we have it)\nimport { cn } from "@/lib/utils";', '');
        content = content.replace('// Helper for cn\nimport { cn } from "@/lib/utils";', '');
        content = content.replace('import { cn } from "@/lib/utils";', '');
        
        if (!content.includes('import { cn } from "@/lib/utils";')) {
            content = content.replace('import { useState', 'import { cn } from "@/lib/utils";\nimport { useState');
            modified = true;
        }
    }
    
    if (content.includes('import { Suspense } from "react";') && content.lastIndexOf('import { Suspense }') > content.length / 2) {
        content = content.replace('import { Suspense } from "react";', '');
        if (!content.includes('Suspense')) {
            content = content.replace('import { useEffect', 'import { useEffect, Suspense');
        }
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Fixed", file);
    }
}
