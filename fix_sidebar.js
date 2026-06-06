const fs = require('fs');
let content = fs.readFileSync('src/components/layout/sidebar.tsx', 'utf8');

const hrBlock = `                        <Link href="/my-hr">
                            <Button
                                variant={pathname.startsWith("/my-hr") ? "secondary" : "ghost"}
                                className="w-full justify-start h-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                                size="sm"
                            >
                                <Calendar className="mr-2 h-3 w-3" />
                                My HR
                            </Button>
                        </Link>
`;

content = content.replace(hrBlock, '');

const newHrBlock = `            <Link href="/my-hr">
                <Button
                    variant={pathname.startsWith("/my-hr") ? "secondary" : "ghost"}
                    className="w-full justify-start"
                >
                    <Calendar className="mr-2 h-4 w-4" />
                    My HR
                </Button>
            </Link>
`;

content = content.replace(
    '            {canAccess("/dashboard") && (',
    newHrBlock + '            {canAccess("/dashboard") && ('
);

fs.writeFileSync('src/components/layout/sidebar.tsx', content);
