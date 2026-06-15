const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/team/attendance/page.tsx', 'utf8');

content = content.replace(
    'import { Loader2, CalendarClock, Clock, UserX } from "lucide-react";',
    'import { Loader2, CalendarClock, Clock, UserX, ArrowRight } from "lucide-react";\nimport { Button } from "@/components/ui/button";\nimport Link from "next/link";'
);

// Add an empty table head for the button
content = content.replace(
    '<TableHead className="text-right">Delay</TableHead>\n                                </TableRow>',
    '<TableHead className="text-right">Delay</TableHead>\n                                    <TableHead></TableHead>\n                                </TableRow>'
);

// Add the button
content = content.replace(
    '                                        </TableCell>\n                                    </TableRow>',
    '                                        </TableCell>\n                                        <TableCell>\n                                            <Button variant="ghost" size="sm" asChild>\n                                                <Link href={`/team/attendance/${encodeURIComponent(record.email)}`}>\n                                                    <ArrowRight className="h-4 w-4" />\n                                                </Link>\n                                            </Button>\n                                        </TableCell>\n                                    </TableRow>'
);

fs.writeFileSync('src/app/(dashboard)/team/attendance/page.tsx', content);
