const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/team/attendance/page.tsx', 'utf8');

// Replace the table name and columns
content = content.replace(
    /from\("user_shifts"\)\n\s*\.select\("id, user_email, clock_in, clock_out"\)/g,
    'from("attendance_logs")\n            .select("id, user_email, clock_in_time, clock_out_time")'
);

content = content.replace(
    /\.gte\("clock_in",/g,
    '.gte("clock_in_time",'
);

content = content.replace(
    /\.lt\("clock_in",/g,
    '.lt("clock_in_time",'
);

content = content.replace(
    /const userShift = shifts\.find\(s => s\.user_email === user\.user_email\);/g,
    'const userShift = shifts.find(s => s.user_email === user.user_email) as any;'
);

content = content.replace(
    /actualClockIn = parseISO\(userShift\.clock_in\);/g,
    'actualClockIn = parseISO(userShift.clock_in_time);'
);

content = content.replace(
    /clockIn: userShift\?\.clock_in \|\| null,/g,
    'clockIn: userShift?.clock_in_time || null,'
);

content = content.replace(
    /clockOut: userShift\?\.clock_out \|\| null,/g,
    'clockOut: userShift?.clock_out_time || null,'
);

fs.writeFileSync('src/app/(dashboard)/team/attendance/page.tsx', content);
