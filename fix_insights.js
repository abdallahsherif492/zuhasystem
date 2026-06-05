const fs = require('fs');
const file = 'src/app/(dashboard)/insights/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Move bottom imports to top
content = content.replace('import { cn } from "@/lib/utils";', '');
content = content.replace('// Helper for cn', '');

// Add them to top
content = content.replace('import { useEffect, useState } from "react";', 'import { useEffect, useState } from "react";\nimport { cn } from "@/lib/utils";');

// Inject activeBusiness to InsightsContent
content = content.replace('function InsightsContent() {', 'function InsightsContent() {\n    const { activeBusiness } = useBusiness();');

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed insights/page.tsx");
