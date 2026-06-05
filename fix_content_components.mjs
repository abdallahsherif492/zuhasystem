import fs from 'fs';

const files = [
  'src/app/(dashboard)/accounting/page.tsx',
  'src/app/(dashboard)/insights/actual-returns/page.tsx',
  'src/app/(dashboard)/insights/products-analysis/page.tsx',
  'src/app/(dashboard)/insights/revenues/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Find something like `function SomethingContent() {` or `function SomethingContent({ ... }) {`
  content = content.replace(/function\s+\w+Content\s*\([^)]*\)\s*\{/, (match) => {
    return match + `\n    const { activeBusiness } = useBusiness();\n`;
  });

  fs.writeFileSync(file, content);
  console.log(`Fixed Content component in ${file}`);
}
