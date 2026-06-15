const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/my-hr/page.tsx', 'utf8');

// 1. Get shift vars from useBusiness()
content = content.replace(
    'const { activeBusiness } = useBusiness();',
    'const { activeBusiness, shiftStart, shiftEnd, weekendDays } = useBusiness();'
);

// 2. Add Shift Information UI
const shiftInfoUI = `
            {/* Shift Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
                            <Clock className="h-4 w-4" /> Shift Start
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-mono font-bold text-blue-900 dark:text-blue-100">{shiftStart || 'Not set'}</p>
                    </CardContent>
                </Card>
                <Card className="bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-900/30">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                            <LogOut className="h-4 w-4" /> Shift End
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-mono font-bold text-indigo-900 dark:text-indigo-100">{shiftEnd || 'Not set'}</p>
                    </CardContent>
                </Card>
                <Card className="bg-orange-50/50 dark:bg-orange-900/10 border-orange-100 dark:border-orange-900/30">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm text-orange-700 dark:text-orange-300 flex items-center gap-2">
                            <Calendar className="h-4 w-4" /> Weekends
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {weekendDays && weekendDays.length > 0 ? weekendDays.map(day => (
                                <Badge key={day} variant="outline" className="bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border-orange-200 dark:border-orange-800">{day}</Badge>
                            )) : <span className="text-muted-foreground text-sm">Not set</span>}
                        </div>
                    </CardContent>
                </Card>
            </div>
`;

content = content.replace(
    '            {/* Attendance Section */}',
    shiftInfoUI + '\n            {/* Attendance Section */}'
);

fs.writeFileSync('src/app/(dashboard)/my-hr/page.tsx', content);
