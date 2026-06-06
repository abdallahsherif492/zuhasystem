const fs = require('fs');
let content = fs.readFileSync('src/contexts/BusinessContext.tsx', 'utf8');

content = content.replace(
    /if \(pathname !== '\/onboarding' && !pathname\.startsWith\('\/system-admin'\)\) \{\s*router\.push\('\/onboarding'\);\s*\}/,
    `const skipped = typeof window !== 'undefined' ? localStorage.getItem('skipOnboarding') : null;
        if (pathname !== '/onboarding' && !pathname.startsWith('/system-admin') && !skipped) {
          router.push('/onboarding');
        }`
);

fs.writeFileSync('src/contexts/BusinessContext.tsx', content);
