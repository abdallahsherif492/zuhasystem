const fs = require('fs');

function formatTime(file) {
    let content = fs.readFileSync(file, 'utf8');

    // Add a helper function to format time
    const helper = `
function formatTime12(timeString: string | null) {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':');
        const h = parseInt(hours, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return \`\${h12.toString().padStart(2, '0')}:\${minutes} \${ampm}\`;
    } catch (e) {
        return timeString;
    }
}
`;

    if (!content.includes('formatTime12')) {
        content = content.replace('export default function ', helper + '\nexport default function ');
    }

    // Replace shiftStart and shiftEnd occurrences in JSX
    if (file.includes('my-hr')) {
        content = content.replace(/{shiftStart \|\| 'Not set'}/g, "{formatTime12(shiftStart)}");
        content = content.replace(/{shiftEnd \|\| 'Not set'}/g, "{formatTime12(shiftEnd)}");
    } else if (file.includes('[email]')) {
        content = content.replace(/{employeeInfo\?\.shift_start \|\| 'N\/A'}/g, "{formatTime12(employeeInfo?.shift_start)}");
        content = content.replace(/{employeeInfo\?\.shift_end \|\| 'N\/A'}/g, "{formatTime12(employeeInfo?.shift_end)}");
    } else if (file.includes('team/attendance/page.tsx')) {
        content = content.replace(/{record\.shiftStart \? record\.shiftStart : "No schedule"}/g, '{record.shiftStart ? formatTime12(record.shiftStart) : "No schedule"}');
    }

    fs.writeFileSync(file, content);
}

formatTime('src/app/(dashboard)/my-hr/page.tsx');
formatTime('src/app/(dashboard)/team/attendance/[email]/page.tsx');
formatTime('src/app/(dashboard)/team/attendance/page.tsx');
