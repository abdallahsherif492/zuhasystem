"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, CalendarClock, Clock, UserX, ArrowRight, CheckCircle2, AlertTriangle, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { format, differenceInMinutes, parseISO } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type BusinessUser = {
    user_email: string;
    role: string;
    shift_start: string | null;
    shift_end: string | null;
    weekend_days: string[];
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
    const { t } = useLanguage();
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
        const dayOfWeek = format(targetDate, "EEEE");

        // 1. Fetch Users
        const { data: usersData } = await supabase
            .from("business_users")
            .select("user_email, role, shift_start, shift_end, weekend_days")
            .eq("business_id", activeBusiness.id);

        // 2. Fetch Shifts for the selected date window based on clock_in_time
        const targetDateObj = new Date(date);
        const prevDateStr = new Date(targetDateObj.getTime() - 86400000).toISOString().split('T')[0];
        const nextDateStr = new Date(targetDateObj.getTime() + 86400000 * 2).toISOString().split('T')[0];

        const { data: shiftsData } = await supabase
            .from("attendance_logs")
            .select("id, user_email, clock_in_time, clock_out_time, date")
            .eq("business_id", activeBusiness.id)
            .gte("clock_in_time", prevDateStr)
            .lt("clock_in_time", nextDateStr);

        const users = (usersData || []) as BusinessUser[];

        const attendance: AttendanceRecord[] = users.map(user => {
            const userEmail = (user.user_email || "").toLowerCase().trim();
            const userShifts = shiftsData?.filter(s => (s.user_email || "").toLowerCase().trim() === userEmail) || [];
            
            userShifts.sort((a, b) => new Date(b.clock_in_time).getTime() - new Date(a.clock_in_time).getTime());

            const userShift = userShifts.find(s => {
                if (!s.clock_in_time) return false;
                
                const clockIn = parseISO(s.clock_in_time);
                const clockInStr = format(clockIn, 'yyyy-MM-dd');
                let shiftDateStr = clockInStr;
                
                if (user.shift_start) {
                    const [sh] = user.shift_start.split(':').map(Number);
                    if (sh >= 12 && clockIn.getHours() < 12) {
                        const prevDay = new Date(clockIn);
                        prevDay.setDate(prevDay.getDate() - 1);
                        shiftDateStr = format(prevDay, 'yyyy-MM-dd');
                    }
                }
                
                return shiftDateStr === date;
            });
            const isWeekend = (user.weekend_days || []).includes(dayOfWeek);
            
            let status: 'Present' | 'Absent' | 'Weekend' = 'Absent';
            let delayMinutes = 0;

            if (userShift) {
                status = 'Present';
                if (user.shift_start) {
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
                if (targetDate > new Date()) {
                    status = 'Weekend';
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

    const presentCount = records.filter(r => r.status === 'Present').length;
    const absentCount = records.filter(r => r.status === 'Absent' && new Date(date) <= new Date()).length;
    const lateCount = records.filter(r => r.delayMinutes > 0).length;

    return (
        <div className="space-y-6 max-w-6xl mx-auto font-sans">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
                        <CalendarClock className="h-7 w-7 text-primary" />
                        {t("Attendance & Tracking")}
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">{t("Monitor staff attendance, delays, and absences.")}</p>
                </div>
                <div className="flex items-center gap-2 bg-background border rounded-xl px-3 py-1.5 shadow-sm">
                    <Calendar className="h-4 w-4 text-primary" />
                    <Input 
                        type="date" 
                        value={date} 
                        onChange={(e) => setDate(e.target.value)} 
                        className="border-0 shadow-none h-8 w-[140px] text-xs font-semibold focus-visible:ring-0"
                    />
                </div>
            </div>

            {/* Summary KPI Cards */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t("Present Today")}</CardTitle>
                        <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-emerald-900 dark:text-emerald-100">{presentCount}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent border-red-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">{t("Absent")}</CardTitle>
                        <div className="p-2 rounded-full bg-red-500/20 text-red-600">
                            <UserX className="h-4 w-4" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-red-900 dark:text-red-100">{absentCount}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">{t("Late Arrivals")}</CardTitle>
                        <div className="p-2 rounded-full bg-amber-500/20 text-amber-600">
                            <AlertTriangle className="h-4 w-4" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black text-amber-900 dark:text-amber-100">{lateCount}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Attendance Table Card */}
            <Card className="shadow-sm border border-border/60">
                <CardHeader className="border-b pb-4">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                        <CalendarClock className="h-5 w-5 text-primary" />
                        {t("Attendance Records")}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/40 text-xs">
                                    <TableHead>{t("Staff Member")}</TableHead>
                                    <TableHead>{t("Expected Shift")}</TableHead>
                                    <TableHead>{t("Status")}</TableHead>
                                    <TableHead>{t("Clock In")}</TableHead>
                                    <TableHead>{t("Clock Out")}</TableHead>
                                    <TableHead>{t("Delay")}</TableHead>
                                    <TableHead className="text-right">{t("Actions")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="divide-y">
                                {records.length === 0 ? (
                                    <TableRow><TableCell colSpan={7} className="text-center p-8 text-xs text-muted-foreground">{t("No records found.")}</TableCell></TableRow>
                                ) : records.map((record) => {
                                    const emailPrefix = record.email.substring(0, 2).toUpperCase();

                                    return (
                                        <TableRow key={record.email} className="hover:bg-muted/20 text-xs">
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-8 w-8 bg-primary/10 text-primary border border-primary/20">
                                                        <AvatarFallback className="font-bold text-xs">{emailPrefix}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-semibold text-xs text-foreground">{record.email}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase">{record.role}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {record.shiftStart ? (
                                                    <Badge variant="outline" className="text-[10px] font-mono gap-1">
                                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                                        {formatTime12(record.shiftStart)}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-[11px] text-muted-foreground">{t("No schedule")}</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {record.status === 'Present' && (
                                                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold">
                                                        {t("Present")}
                                                    </Badge>
                                                )}
                                                {record.status === 'Absent' && (
                                                    <Badge className="bg-red-500/10 text-red-600 border-red-500/20 font-bold">
                                                        {t("Absent")}
                                                    </Badge>
                                                )}
                                                {record.status === 'Weekend' && (
                                                    <Badge variant="secondary" className="text-[10px]">
                                                        {t("Weekend/Off")}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {record.clockIn ? format(parseISO(record.clockIn), 'hh:mm a') : '—'}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {record.clockOut ? format(parseISO(record.clockOut), 'hh:mm a') : '—'}
                                            </TableCell>
                                            <TableCell>
                                                {record.delayMinutes > 0 ? (
                                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold text-[10px]">
                                                        {record.delayMinutes} {t("mins late")}
                                                    </Badge>
                                                ) : record.status === 'Present' ? (
                                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                                                        {t("On Time")}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                                                    <Link href={`/team/attendance/${encodeURIComponent(record.email)}`}>
                                                        <ArrowRight className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
                                                    </Link>
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
