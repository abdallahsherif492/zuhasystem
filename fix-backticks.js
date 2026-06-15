const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/team/attendance/[email]/page.tsx', 'utf8');

// The original file has escaped backticks literally in the string: \`
content = content.replace(/\\`/g, '`');
// Same for \${
content = content.replace(/\\\${/g, '${');

fs.writeFileSync('src/app/(dashboard)/team/attendance/[email]/page.tsx', content);
