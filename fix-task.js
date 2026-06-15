const fs = require('fs');
let content = fs.readFileSync('/Users/abdallahsmacbook/.gemini/antigravity/brain/3bae6dec-f3dd-4bb9-a76f-014871efa4ad/task.md', 'utf8');

content = content.replace(
    /- `\[ \]` \*\*HR Dashboards\*\*/g,
    '- `[x]` **HR Dashboards**'
);
content = content.replace(
    /- `\[ \]` Create `\/src\/app\/\(dashboard\)\/team\/attendance\/page\.tsx` for Owner\/Admin to view attendance and calculate delays\/absences dynamically\./g,
    '- `[x]` Create `/src/app/(dashboard)/team/attendance/page.tsx` for Owner/Admin to view attendance and calculate delays/absences dynamically.'
);
content = content.replace(
    /- `\[ \]` Create `\/src\/app\/\(dashboard\)\/team\/requests\/page\.tsx` to manage leave\/permission requests\./g,
    '- `[x]` Create `/src/app/(dashboard)/team/requests/page.tsx` to manage leave/permission requests.'
);
content = content.replace(
    /- `\[ \]` \*\*Employee Portal\*\*/g,
    '- `[x]` **Employee Portal**'
);
content = content.replace(
    /- `\[ \]` Update shift tracker to display shift timing\./g,
    '- `[x]` Update shift tracker to display shift timing.'
);
content = content.replace(
    /- `\[ \]` Create a widget or page for employees to submit leave\/permission requests\./g,
    '- `[x]` Create a widget or page for employees to submit leave/permission requests.'
);
content = content.replace(
    /- `\[ \]` \*\*Testing & Polish\*\*/g,
    '- `[x]` **Testing & Polish**'
);
content = content.replace(
    /- `\[ \]` Test invite flow and restriction of pages\./g,
    '- `[x]` Test invite flow and restriction of pages.'
);
content = content.replace(
    /- `\[ \]` Test attendance tracking and delay calculations\./g,
    '- `[x]` Test attendance tracking and delay calculations.'
);

fs.writeFileSync('/Users/abdallahsmacbook/.gemini/antigravity/brain/3bae6dec-f3dd-4bb9-a76f-014871efa4ad/task.md', content);
