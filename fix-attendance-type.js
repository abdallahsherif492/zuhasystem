const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/team/attendance/page.tsx', 'utf8');

content = content.replace(
    '    clock_in: string;',
    '    clock_in_time: string;'
);

content = content.replace(
    '    clock_out: string | null;',
    '    clock_out_time: string | null;'
);

fs.writeFileSync('src/app/(dashboard)/team/attendance/page.tsx', content);
