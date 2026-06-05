import fs from 'fs';

const files = [
  'src/app/(dashboard)/accounting/page.tsx',
  'src/app/(dashboard)/customers/[id]/page.tsx',
  'src/app/(dashboard)/insights/actual-returns/page.tsx',
  'src/app/(dashboard)/insights/products-analysis/page.tsx',
  'src/app/(dashboard)/insights/revenues/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // We want to delete `const { activeBusiness } = useBusiness();` if it appears inside an `async function ... {` block.
  // The easiest way is to use a replacer that only keeps the hook at the top level of the component.
  
  // Since we know the hook is exactly `    const { activeBusiness } = useBusiness();`
  // We can just find all occurrences. The first occurrence in the component is correct.
  // If it's directly following `async function`, we delete it.
  
  content = content.replace(/async\s+function\s+\w+\([^)]*\)\s*\{\s*const\s+\{\s*activeBusiness\s*\}\s*=\s*useBusiness\(\);/g, (match) => {
    return match.replace(/const\s+\{\s*activeBusiness\s*\}\s*=\s*useBusiness\(\);/, '');
  });

  fs.writeFileSync(file, content);
  console.log(`Fixed hooks in ${file}`);
}
