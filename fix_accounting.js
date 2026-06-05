const fs = require('fs');
const file = 'src/app/(dashboard)/accounting/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Move bottom imports to top
content = content.replace('import { Suspense } from "react";', '');
content = content.replace('import { cn } from "@/lib/utils";', '');
content = content.replace('// Helper for cn (copying plain classnames without library if utility not imported, but we have it)', '');

// Add them to top
content = content.replace('import { useEffect, useState } from "react";', 'import { useEffect, useState, Suspense } from "react";\nimport { cn } from "@/lib/utils";');

// Inject activeBusiness to AccountingContent
content = content.replace('function AccountingContent() {', 'function AccountingContent() {\n    const { activeBusiness } = useBusiness();');

// Remove activeBusiness from AccountingPage
content = content.replace('export default function AccountingPage() {\n    const { activeBusiness } = useBusiness();', 'export default function AccountingPage() {');

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed accounting/page.tsx");
