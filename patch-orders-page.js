const fs = require('fs');

let content = fs.readFileSync('src/app/(dashboard)/orders/page.tsx', 'utf8');

content = content.replace(
    'const [loading, setLoading] = useState(true);',
    'const [loading, setLoading] = useState(true);\n    const [errorMsg, setErrorMsg] = useState<string | null>(null);'
);

content = content.replace(
    'setLoading(true);',
    'setLoading(true);\n            setErrorMsg(null);'
);

content = content.replace(
    'if (error) throw error;',
    'if (error) { setErrorMsg(error.message + " | Details: " + JSON.stringify(error)); throw error; }'
);

content = content.replace(
    '{loading ? (',
    '{errorMsg ? (\n                            <TableRow>\n                                <TableCell colSpan={10} className="h-24 text-center text-red-500 font-bold">\n                                    Error: {errorMsg}\n                                </TableCell>\n                            </TableRow>\n                        ) : loading ? ('
);

fs.writeFileSync('src/app/(dashboard)/orders/page.tsx', content);
