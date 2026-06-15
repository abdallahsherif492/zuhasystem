const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/my-hr/page.tsx', 'utf8');

// Add state for attendance history
content = content.replace(
    'const [todayAttendance, setTodayAttendance] = useState<any>(null);',
    'const [todayAttendance, setTodayAttendance] = useState<any>(null);\n    const [attendanceHistory, setAttendanceHistory] = useState<any[]>([]);'
);

// Add fetch inside fetchTodayAttendance
const fetchHistoryLogic = `
        const { data: historyData } = await supabase
            .from("attendance_logs")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .eq("user_email", user.email)
            .order("date", { ascending: false })
            .limit(30);
            
        if (historyData) {
            setAttendanceHistory(historyData);
        }
`;

content = content.replace(
    '        setAttendanceLoading(false);\n    }',
    '        ' + fetchHistoryLogic + '\n        setAttendanceLoading(false);\n    }'
);

// Add the History Table UI
const historyTableUI = `
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-primary" />
                        My Attendance History
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {attendanceLoading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Clock In</TableHead>
                                    <TableHead>Clock Out</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {attendanceHistory.length === 0 ? (
                                    <TableRow><TableCell colSpan={4} className="text-center">No attendance records found.</TableCell></TableRow>
                                ) : attendanceHistory.map((record) => (
                                    <TableRow key={record.id}>
                                        <TableCell className="font-medium">{format(parseISO(record.date), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>{record.clock_in_time ? format(parseISO(record.clock_in_time), 'hh:mm a') : '-'}</TableCell>
                                        <TableCell>{record.clock_out_time ? format(parseISO(record.clock_out_time), 'hh:mm a') : '-'}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize">
                                                {record.status || 'Present'}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
`;

content = content.replace(
    '            <Card>\n                <CardHeader>\n                    <CardTitle className="flex items-center gap-2">\n                        <Calendar className="h-5 w-5 text-primary" />\n                        My Request History',
    historyTableUI + '\n            <Card>\n                <CardHeader>\n                    <CardTitle className="flex items-center gap-2">\n                        <Calendar className="h-5 w-5 text-primary" />\n                        My Request History'
);

fs.writeFileSync('src/app/(dashboard)/my-hr/page.tsx', content);
