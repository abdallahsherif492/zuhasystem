"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, CalendarClock, Clock, UserX, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { format, differenceInMinutes, parseISO, isSameDay, startOfDay } from "date-fns";

type BusinessUser = {
    user_email: string;
    role: string;
    shift_start: string | null;
    shift_end: string | null;
    weekend_days: string[];
};

type Shift = {
    id: string;
    user_email: string;
    clock_in_time: string;
    clock_out_time: string | null;
};

type AttendanceRecord = {
    email: string;
    role: string;
    status: 'Present' | 'Absent' | 'Weekend';
    clockIn: string | null;
    clockOut: string | null;
    delayMinutes: number;
    shiftStart: string | null;
};


function formatTime12(timeString: string | null) {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':');
        const h = parseInt(hours, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
    } catch (e) {
        return timeString;
    }
}

export default function AttendancePage() {
    const { activeBusiness } = useBusiness();
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

    useEffect(() => {
        if (activeBusiness && date) {
            fetchAttendance();
        }
    }, [activeBusiness, date]);

    async function fetchAttendance() {
        if (!activeBusiness) return;
        setLoading(true);

        const targetDate = parseISO(date);
        const dayOfWeek = format(targetDate, "EEEE"); // e.g., "Monday"

        // 1. Fetch Users
        const { data: usersData } = await supabase
            .from("business_users")
            .select("user_email, role, shift_start, shift_end, weekend_days")
            .eq("business_id", activeBusiness.id);

        // 2. Fetch Shifts for the selected date
        const targetDateObj = new Date(date);
        const prevDateStr = new Date(targetDateObj.getTime() - 86400000).toISOString().split('T')[0];
        const nextDateStr = new Date(targetDateObj.getTime() + 86400000).toISOString().split('T')[0];

        const { data: shiftsData } = await supabase
            .from("attendance_logs")
            .select("id, user_email, clock_in_time, clock_out_time, date")
            .eq("business_id", activeBusiness.id)
            .in("date", [prevDateStr, date, nextDateStr]);

        const users = (usersData || []) as BusinessUser[];

        const attendance: AttendanceRecord[] = users.map(user => {
            const userEmail = user.user_email.toLowerCase();
            const userShift = shiftsData?.find(s => {
                if (s.user_email.toLowerCase() !== userEmail) return false;
                if (s.date && s.date.startsWith(date)) return true;
                if (s.clock_in_time) {
                    const clockInStr = format(parseISO(s.clock_in_time), 'yyyy-MM-dd');
                    if (clockInStr === date) return true;
                    
                    const clockIn = parseISO(s.clock_in_time);
                    if (user.shift_start) {
                        const [sh] = user.shift_start.split(':').map(Number);
                        if (sh >= 12 && clockIn.getHours() < 12) {
                            const prevDay = new Date(clockIn);
                            prevDay.setDate(prevDay.getDate() - 1);
                            if (format(prevDay, 'yyyy-MM-dd') === date) return true;
                        }
                    }
                }
                return false;
            });
            const isWeekend = (user.weekend_days || []).includes(dayOfWeek);
            
            let status: 'Present' | 'Absent' | 'Weekend' = 'Absent';
            let delayMinutes = 0;

            if (userShift) {
                status = 'Present';
                if (user.shift_start) {
                    // Calculate delay
                    const expectedClockIn = parseISO(`${date}T${user.shift_start}`);
                    const actualClockIn = parseISO(userShift.clock_in_time);
                    
                    const diff = differenceInMinutes(actualClockIn, expectedClockIn);
                    if (diff > 0) {
                        delayMinutes = diff;
                    }
                }
            } else if (isWeekend) {
                status = 'Weekend';
            } else {
                // If the selected date is in the future, don't mark as absent yet
                if (targetDate > new Date()) {
                    status = 'Weekend'; // Just placeholder for future
                } else {
                    status = 'Absent';
                }
            }

            return {
                email: user.user_email,
                role: user.role,
                status,
                clockIn: userShift?.clock_in_time || null,
                clockOut: userShift?.clock_out_time || null,
                delayMinutes,
                shiftStart: user.shift_start
            };
        });

        setRecords(attendance);
        setLoading(false);
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Attendance & Tracking</h1>
                    <p className="text-muted-foreground mt-1">Monitor staff attendance, delays, and absences.</p>
                </div>
                <div className="flex items-center gap-2 bg-background border rounded-md px-3 py-1">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    <Input 
                        type="date" 
                        value={date} 
                        onChange={(e) => setDate(e.target.value)} 
                        className="border-0 shadow-none h-8 w-[150px] focus-visible:ring-0"
                    />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Present Today</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{records.filter(r => r.status === 'Present').length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Absent</CardTitle>
                        <UserX className="h-4 w-4 text-destructive" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-destructive">{records.filter(r => r.status === 'Absent' && new Date(date) <= new Date()).length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Late Arrivals</CardTitle>
                        <CalendarClock className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{records.filter(r => r.delayMinutes > 0).length}</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Attendance Records</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Staff Member</TableHead>
                                    <TableHead>Expected Shift</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Clock In</TableHead>
                                    <TableHead>Clock Out</TableHead>
                                    <TableHead className="text-right">Delay</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {records.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center">No records found.</TableCell></TableRow>
                                ) : records.map((record) => (
                                    <TableRow key={record.email}>
                                        <TableCell>
                                            <div className="font-medium">{record.email}</div>
                                            <div className="text-xs text-muted-foreground uppercase">{record.role}</div>
                                        </TableCell>
                                        <TableCell>{record.shiftStart ? formatTime12(record.shiftStart) : "No schedule"}</TableCell>
                                        <TableCell>
                                            {record.status === 'Present' && <Badge variant="default" className="bg-green-500 hover:bg-green-600">Present</Badge>}
                                            {record.status === 'Absent' && <Badge variant="destructive">Absent</Badge>}
                                            {record.status === 'Weekend' && <Badge variant="secondary">Weekend/Off</Badge>}
                                        </TableCell>
                                        <TableCell>{record.clockIn ? format(parseISO(record.clockIn), 'hh:mm a') : '-'}</TableCell>
                                        <TableCell>{record.clockOut ? format(parseISO(record.clockOut), 'hh:mm a') : '-'}</TableCell>
                                        <TableCell className="text-right">
                                            {record.delayMinutes > 0 ? (
                                                <span className="text-orange-500 font-medium">{record.delayMinutes} mins</span>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" asChild>
                                                <Link href={`/team/attendance/${encodeURIComponent(record.email)}`}>
                                                    <ArrowRight className="h-4 w-4" />
                                                </Link>
                                            </Button>
                                        </TableCell>
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
