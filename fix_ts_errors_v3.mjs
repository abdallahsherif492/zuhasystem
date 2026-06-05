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

  // We find any function or component that doesn't have useBusiness() but uses activeBusiness?.id
  const functionRegex = /(function\s+\w+\s*\([^)]*\)\s*\{|const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{)([\s\S]*?)(?=function\s+\w+\s*\(|const\s+\w+\s*=\s*\(|export default|$)/g;

  content = content.replace(functionRegex, (match, funcDef, funcBody) => {
      if (funcBody.includes('activeBusiness?.id') && !funcBody.includes('const { activeBusiness }')) {
          return `${funcDef}\n    const { activeBusiness } = useBusiness();\n${funcBody}`;
      }
      return match;
  });

  fs.writeFileSync(file, content);
}
console.log("Fixed missing activeBusiness declarations (v3).");
