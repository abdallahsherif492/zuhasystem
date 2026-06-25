"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Clock, UserX, CalendarClock } from "lucide-react";
import { format, parseISO, differenceInMinutes, eachDayOfInterval, formatISO, isBefore, endOfDay } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { use } from "react";

type AttendanceRecord = {
    date: string;
    status: 'Present' | 'Absent' | 'Weekend' | 'Future';
    clockIn: string | null;
    clockOut: string | null;
    delayMinutes: number;
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

export default function EmployeeAttendancePage({ params }: { params: Promise<{ email: string }> }) {
    const resolvedParams = use(params);
    const email = decodeURIComponent(resolvedParams.email);
    const { activeBusiness } = useBusiness();
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    
    // Default to current month
    const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [employeeInfo, setEmployeeInfo] = useState<any>(null);

    useEffect(() => {
        if (activeBusiness && email) {
            fetchEmployeeAttendance();
        }
    }, [activeBusiness, email, startDate, endDate]);

    async function fetchEmployeeAttendance() {
        if (!activeBusiness) return;
        setLoading(true);

        try {
            // 1. Fetch employee shift settings
            const { data: userRow, error: userError } = await supabase
                .from("business_users")
                .select("role, shift_start, shift_end, weekend_days")
                .eq("business_id", activeBusiness.id)
                .ilike("user_email", email)
                .single();

            if (userError) throw userError;
            setEmployeeInfo(userRow);

            const { data: logsData, error: logsError } = await supabase
                .from("attendance_logs")
                .select("*")
                .eq("business_id", activeBusiness.id)
                .ilike("user_email", email);

            if (logsError) throw logsError;

            // 3. Process each day in the interval
            const startD = new Date(startDate);
            const endD = new Date(endDate);
            const today = new Date();
            
            // Only generate days if dates are valid and start <= end
            if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || startD > endD) {
                setRecords([]);
                setLoading(false);
                return;
            }

            const days = eachDayOfInterval({ start: startD, end: endD });
            
            const processedRecords: AttendanceRecord[] = days.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const dayOfWeek = format(day, 'EEEE');
                
                const log = logsData?.find(l => {
                    if (l.date && l.date.startsWith(dateStr)) return true;
                    if (l.clock_in_time) {
                        const clockInStr = format(parseISO(l.clock_in_time), 'yyyy-MM-dd');
                        if (clockInStr === dateStr) return true;
                        
                        // Handle overnight shift logic (e.g. clocked in at 1 AM for previous day's shift)
                        const clockIn = parseISO(l.clock_in_time);
                        if (userRow.shift_start) {
                            const [sh] = userRow.shift_start.split(':').map(Number);
                            if (sh >= 12 && clockIn.getHours() < 12) {
                                // clocked in AM but shift is PM, likely belongs to previous day
                                const prevDay = new Date(clockIn);
                                prevDay.setDate(prevDay.getDate() - 1);
                                if (format(prevDay, 'yyyy-MM-dd') === dateStr) return true;
                            }
                        }
                    }
                    return false;
                });
                const isWeekend = (userRow.weekend_days || []).includes(dayOfWeek);
                
                let status: 'Present' | 'Absent' | 'Weekend' | 'Future' = 'Absent';
                let delayMinutes = 0;

                // Determine status
                if (log) {
                    status = 'Present';
                    // Calculate delay if shift_start exists
                    if (userRow.shift_start && log.clock_in_time) {
                        const expectedClockIn = parseISO(`${dateStr}T${userRow.shift_start}`);
                        const actualClockIn = parseISO(log.clock_in_time);
                        const diff = differenceInMinutes(actualClockIn, expectedClockIn);
                        if (diff > 0) delayMinutes = diff;
                    }
                } else if (isWeekend) {
                    status = 'Weekend';
                } else if (day > endOfDay(today)) {
                    status = 'Future';
                } else {
                    status = 'Absent';
                }

                return {
                    date: dateStr,
                    status,
                    clockIn: log?.clock_in_time || null,
                    clockOut: log?.clock_out_time || null,
                    delayMinutes
                };
            });

            // Sort descending (newest first)
            processedRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            
            setRecords(processedRecords);
        } catch (error) {
            console.error("Failed to fetch employee attendance:", error);
        } finally {
            setLoading(false);
        }
    }

    // Stats
    const presentCount = records.filter(r => r.status === 'Present').length;
    const absentCount = records.filter(r => r.status === 'Absent').length;
    const totalDelay = records.reduce((acc, r) => acc + r.delayMinutes, 0);

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/team/attendance"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Employee Report</h1>
                    <p className="text-muted-foreground mt-1">{email}</p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/50 p-4 rounded-xl border">
                <div className="text-sm">
                    <span className="text-muted-foreground mr-2">Shift:</span>
                    <span className="font-medium font-mono">{formatTime12(employeeInfo?.shift_start)} - {formatTime12(employeeInfo?.shift_end)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-background border rounded-md px-3 py-1">
                        <span className="text-xs text-muted-foreground">From</span>
                        <Input 
                            type="date" 
                            value={startDate} 
                            onChange={(e) => setStartDate(e.target.value)} 
                            className="border-0 shadow-none h-8 w-[130px] focus-visible:ring-0 p-0"
                        />
                    </div>
                    <div className="flex items-center gap-2 bg-background border rounded-md px-3 py-1">
                        <span className="text-xs text-muted-foreground">To</span>
                        <Input 
                            type="date" 
                            value={endDate} 
                            onChange={(e) => setEndDate(e.target.value)} 
                            className="border-0 shadow-none h-8 w-[130px] focus-visible:ring-0 p-0"
                        />
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Days Present</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{presentCount}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Days Absent</CardTitle>
                        <UserX className="h-4 w-4 text-destructive" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-destructive">{absentCount}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Delay</CardTitle>
                        <CalendarClock className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">
                            {totalDelay > 60 
                                ? `${Math.floor(totalDelay / 60)}h ${totalDelay % 60}m`
                                : `${totalDelay} mins`}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Clock In</TableHead>
                                    <TableHead>Clock Out</TableHead>
                                    <TableHead className="text-right">Delay</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {records.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="text-center">No records in this range.</TableCell></TableRow>
                                ) : records.map((record) => (
                                    <TableRow key={record.date}>
                                        <TableCell>
                                            <div className="font-medium">{format(parseISO(record.date), 'MMM dd, yyyy')}</div>
                                            <div className="text-xs text-muted-foreground">{format(parseISO(record.date), 'EEEE')}</div>
                                        </TableCell>
                                        <TableCell>
                                            {record.status === 'Present' && <Badge variant="default" className="bg-green-500">Present</Badge>}
                                            {record.status === 'Absent' && <Badge variant="destructive">Absent</Badge>}
                                            {record.status === 'Weekend' && <Badge variant="secondary">Weekend</Badge>}
                                            {record.status === 'Future' && <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">N/A</Badge>}
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
