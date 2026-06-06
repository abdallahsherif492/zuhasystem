const fs = require('fs');
let content = fs.readFileSync('src/app/(marketing)/page.tsx', 'utf8');

content = content.replace(
    '<LogoutButton />\\n                    <Button size="lg" className="h-14 px-8 text-lg rounded-full" asChild>',
    '<LogoutButton size="lg" variant="outline" className="h-14 px-8 text-lg rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 hover:border-red-300" />\\n                    <Button size="lg" className="h-14 px-8 text-lg rounded-full" asChild>'
);

fs.writeFileSync('src/app/(marketing)/page.tsx', content);
