const fs = require('fs');
let content = fs.readFileSync('src/app/(dashboard)/my-hr/page.tsx', 'utf8');

// Add Clock to lucide imports
content = content.replace(
    'import { Loader2, Plus, Calendar } from "lucide-react";',
    'import { Loader2, Plus, Calendar, Clock, LogIn, LogOut } from "lucide-react";'
);

// Add state for attendance
content = content.replace(
    '    const [loading, setLoading] = useState(true);',
    `    const [loading, setLoading] = useState(true);
    
    // Attendance State
    const [todayAttendance, setTodayAttendance] = useState<any>(null);
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [clockingIn, setClockingIn] = useState(false);
    const [clockingOut, setClockingOut] = useState(false);`
);

// Fetch attendance in useEffect
content = content.replace(
    '        if (activeBusiness) {\n            fetchMyRequests();\n        }',
    `        if (activeBusiness) {
            fetchMyRequests();
            fetchTodayAttendance();
        }`
);

// Add fetchTodayAttendance and clockIn/clockOut handlers
const attendanceFunctions = `
    async function fetchTodayAttendance() {
        if (!activeBusiness) return;
        setAttendanceLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = new Date().toISOString().split('T')[0];

        const { data, error } = await supabase
            .from("attendance_logs")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .eq("user_email", user.email)
            .eq("date", today)
            .maybeSingle();

        if (!error && data) {
            setTodayAttendance(data);
        } else {
            setTodayAttendance(null);
        }
        setAttendanceLoading(false);
    }

    async function handleClockIn() {
        if (!activeBusiness) return;
        setClockingIn(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        const { error } = await supabase
            .from("attendance_logs")
            .insert({
                business_id: activeBusiness.id,
                user_email: user.email,
                date: today,
                clock_in_time: now,
                status: 'present'
            });

        setClockingIn(false);
        if (error) {
            toast.error("Failed to clock in: " + error.message);
        } else {
            toast.success("Clocked in successfully!");
            fetchTodayAttendance();
        }
    }

    async function handleClockOut() {
        if (!activeBusiness || !todayAttendance) return;
        setClockingOut(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const now = new Date().toISOString();

        const { error } = await supabase
            .from("attendance_logs")
            .update({
                clock_out_time: now
            })
            .eq("id", todayAttendance.id);

        setClockingOut(false);
        if (error) {
            toast.error("Failed to clock out: " + error.message);
        } else {
            toast.success("Clocked out successfully!");
            fetchTodayAttendance();
        }
    }
`;

content = content.replace(
    '    async function fetchMyRequests() {',
    attendanceFunctions + '\n    async function fetchMyRequests() {'
);

// Add Attendance UI before requests card
const attendanceUI = `
            {/* Attendance Section */}
            <Card className="border-indigo-100 dark:border-indigo-900/50 shadow-sm overflow-hidden relative">
                <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                    <Clock className="w-64 h-64" />
                </div>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                        Today's Attendance
                    </CardTitle>
                    <CardDescription>Record your daily clock in and clock out times.</CardDescription>
                </CardHeader>
                <CardContent>
                    {attendanceLoading ? (
                        <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                    ) : !todayAttendance ? (
                        <div className="flex flex-col items-center justify-center p-6 bg-muted/30 rounded-xl border border-dashed border-muted-foreground/20">
                            <h3 className="text-lg font-medium mb-2">You haven't clocked in today</h3>
                            <p className="text-muted-foreground mb-6 text-center max-w-md">
                                Start your shift by clocking in. Your time will be recorded in the system.
                            </p>
                            <Button size="lg" className="h-14 px-8 rounded-full text-lg shadow-md hover:shadow-lg transition-all" onClick={handleClockIn} disabled={clockingIn}>
                                {clockingIn ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                                Clock In Now
                            </Button>
                        </div>
                    ) : !todayAttendance.clock_out_time ? (
                        <div className="flex flex-col items-center justify-center p-6 bg-green-50 dark:bg-green-950/20 rounded-xl border border-green-200 dark:border-green-900/30">
                            <div className="bg-green-100 dark:bg-green-900/40 p-3 rounded-full mb-4">
                                <Clock className="h-8 w-8 text-green-600 dark:text-green-400" />
                            </div>
                            <h3 className="text-xl font-bold text-green-800 dark:text-green-300 mb-1">You are currently clocked in</h3>
                            <p className="text-green-600/80 dark:text-green-400/80 mb-6 font-mono">
                                Clocked in at: {format(parseISO(todayAttendance.clock_in_time), 'hh:mm a')}
                            </p>
                            <Button size="lg" variant="destructive" className="h-14 px-8 rounded-full text-lg shadow-md hover:shadow-lg transition-all" onClick={handleClockOut} disabled={clockingOut}>
                                {clockingOut ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogOut className="mr-2 h-5 w-5" />}
                                Clock Out (End Shift)
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center p-6 bg-muted/50 rounded-xl border border-muted-foreground/10">
                            <div className="bg-muted p-3 rounded-full mb-4">
                                <Calendar className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-xl font-bold mb-1">Shift Completed</h3>
                            <p className="text-muted-foreground">You have finished your shift for today. Great job!</p>
                            <div className="mt-6 flex gap-8 text-center bg-background p-4 rounded-xl border shadow-sm">
                                <div>
                                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Clocked In</p>
                                    <p className="font-mono font-medium">{format(parseISO(todayAttendance.clock_in_time), 'hh:mm a')}</p>
                                </div>
                                <div className="w-px bg-border"></div>
                                <div>
                                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Clocked Out</p>
                                    <p className="font-mono font-medium">{format(parseISO(todayAttendance.clock_out_time), 'hh:mm a')}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
`;

content = content.replace(
    '            <Card>\n                <CardHeader>\n                    <CardTitle className="flex items-center gap-2">',
    attendanceUI + '\n            <Card>\n                <CardHeader>\n                    <CardTitle className="flex items-center gap-2">'
);

fs.writeFileSync('src/app/(dashboard)/my-hr/page.tsx', content);
