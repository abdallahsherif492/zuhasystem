"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, Calendar, Clock, LogIn, LogOut } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

type HRRequest = {
    id: string;
    request_type: string;
    start_time: string;
    end_time: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string;
    created_at: string;
};

export default function MyHRPage() {
    const { activeBusiness, shiftStart, shiftEnd, weekendDays } = useBusiness();
    const [requests, setRequests] = useState<HRRequest[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Attendance State
    const [todayAttendance, setTodayAttendance] = useState<any>(null);
    const [attendanceHistory, setAttendanceHistory] = useState<any[]>([]);
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [clockingIn, setClockingIn] = useState(false);
    const [clockingOut, setClockingOut] = useState(false);
    
    // Form state
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [requestType, setRequestType] = useState("leave");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [reason, setReason] = useState("");

    useEffect(() => {
        if (activeBusiness) {
            fetchMyRequests();
            fetchTodayAttendance();
        }
    }, [activeBusiness]);


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

    async function fetchMyRequests() {
        if (!activeBusiness) return;
        setLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
            .from("hr_requests")
            .select("*")
            .eq("business_id", activeBusiness.id)
            .eq("user_email", user.email)
            .order("created_at", { ascending: false });

        if (!error && data) {
            setRequests(data as HRRequest[]);
        }
        setLoading(false);
    }

    async function handleSubmitRequest(e: React.FormEvent) {
        e.preventDefault();
        if (!activeBusiness) return;
        setSaving(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Construct ISO strings
        let startIso = new Date(startDate).toISOString();
        let endIso = new Date(endDate).toISOString();

        if (requestType === "permission") {
            // Both are local datetime strings, we can directly parse
            startIso = new Date(startDate).toISOString();
            endIso = new Date(endDate).toISOString();
        }

        const { error } = await supabase
            .from("hr_requests")
            .insert({
                business_id: activeBusiness.id,
                user_email: user.email,
                request_type: requestType,
                start_time: startIso,
                end_time: endIso,
                reason: reason
            });

        setSaving(false);
        if (error) {
            toast.error("Failed to submit request: " + error.message);
        } else {
            toast.success("Request submitted successfully.");
            setIsAddOpen(false);
            setReason("");
            setStartDate("");
            setEndDate("");
            fetchMyRequests();
        }
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">My HR & Requests</h1>
                    <p className="text-muted-foreground mt-1">Submit and track your leave and permission requests.</p>
                </div>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> New Request
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Submit HR Request</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSubmitRequest} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Request Type</label>
                                <Select value={requestType} onValueChange={setRequestType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="leave">Leave / Day Off (إجازة)</SelectItem>
                                        <SelectItem value="permission">Hours Permission (إذن ساعات)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            
                            {requestType === "leave" ? (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Start Date</label>
                                        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">End Date</label>
                                        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Start Time</label>
                                        <Input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">End Time</label>
                                        <Input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} required />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Reason</label>
                                <Textarea 
                                    placeholder="Explain why you need this time off..." 
                                    value={reason} 
                                    onChange={e => setReason(e.target.value)} 
                                    required 
                                />
                            </div>

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                                <Button type="submit" disabled={saving}>
                                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Submit
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>



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

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-primary" />
                        My Request History
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Date / Time</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Submitted On</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {requests.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="text-center">No requests found.</TableCell></TableRow>
                                ) : requests.map((req) => (
                                    <TableRow key={req.id}>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize">
                                                {req.request_type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {req.request_type === 'leave' ? (
                                                <>
                                                    {format(parseISO(req.start_time), 'MMM dd, yyyy')} <br />
                                                    <span className="text-xs text-muted-foreground">to {format(parseISO(req.end_time), 'MMM dd, yyyy')}</span>
                                                </>
                                            ) : (
                                                <>
                                                    {format(parseISO(req.start_time), 'MMM dd, yyyy')} <br />
                                                    <span className="text-xs text-muted-foreground">
                                                        {format(parseISO(req.start_time), 'hh:mm a')} - {format(parseISO(req.end_time), 'hh:mm a')}
                                                    </span>
                                                </>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={req.reason}>
                                            {req.reason || "-"}
                                        </TableCell>
                                        <TableCell>
                                            {req.status === 'pending' && <Badge variant="secondary" className="bg-orange-100 text-orange-700">Pending</Badge>}
                                            {req.status === 'approved' && <Badge variant="default" className="bg-green-500">Approved</Badge>}
                                            {req.status === 'rejected' && <Badge variant="destructive">Rejected</Badge>}
                                        </TableCell>
                                        <TableCell>{format(parseISO(req.created_at), 'MMM dd, yyyy')}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
