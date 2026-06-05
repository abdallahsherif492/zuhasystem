import fs from 'fs';

const files = [
  'src/app/(dashboard)/accounting/page.tsx',
  'src/app/(dashboard)/customers/[id]/page.tsx',
  'src/app/(dashboard)/insights/actual-returns/page.tsx',
  'src/app/(dashboard)/insights/products-analysis/page.tsx',
  'src/app/(dashboard)/insights/revenues/page.tsx',
  'src/app/(dashboard)/orders/[id]/invoice/page.tsx',
  'src/app/(dashboard)/orders/print/page.tsx',
  'src/app/(dashboard)/shipping/[id]/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Add import if missing
  if (!content.includes('useBusiness')) {
    content = content.replace(/(import.*from ['"].*['"];?\n)(?!import)/, `$1import { useBusiness } from "@/contexts/BusinessContext";\n`);
  }

  // Add activeBusiness if missing inside the default export component
  if (!content.includes('const { activeBusiness }')) {
    content = content.replace(/export default function[^{]+\{\n/, (match) => {
      return match + `    const { activeBusiness } = useBusiness();\n`;
    });
  }

  fs.writeFileSync(file, content);
  console.log(`Fixed ${file}`);
}
