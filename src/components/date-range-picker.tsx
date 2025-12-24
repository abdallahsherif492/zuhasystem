"use client"

import * as React from "react"
import { addDays, format, startOfMonth, startOfYear } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"
import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

export function DateRangePicker({
    className,
}: React.HTMLAttributes<HTMLDivElement>) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const fromParam = searchParams.get("from")
    const toParam = searchParams.get("to")

    const [date, setDate] = React.useState<DateRange | undefined>(() => {
        return {
            from: fromParam ? new Date(fromParam) : undefined,
            to: toParam ? new Date(toParam) : undefined,
        }
    })

    // Sync state with URL params when they change (e.g. back button, clear filters)
    React.useEffect(() => {
        const newFrom = fromParam ? new Date(fromParam) : undefined;
        const newTo = toParam ? new Date(toParam) : undefined;

        // Only update if different to avoid loops
        if (
            newFrom?.getTime() !== date?.from?.getTime() ||
            newTo?.getTime() !== date?.to?.getTime()
        ) {
            setDate({ from: newFrom, to: newTo });
        }
    }, [fromParam, toParam]);

    const handleSelect = (range: DateRange | undefined) => {
        setDate(range)

        const params = new URLSearchParams(searchParams.toString())

        if (range?.from) {
            // Use format(date, 'yyyy-MM-dd') to avoid time/timezone issues
            params.set("from", format(range.from, 'yyyy-MM-dd'))
        } else {
            params.delete("from")
        }

        if (range?.to) {
            params.set("to", format(range.to, 'yyyy-MM-dd'))
        } else {
            params.delete("to")
        }

        router.replace(`?${params.toString()}`, { scroll: false })
    }

    const setRange = (days: number) => {
        const today = new Date();
        const fromDate = addDays(today, -days);
        handleSelect({ from: fromDate, to: today });
    }

    const setMonth = () => {
        const today = new Date();
        const fromDate = startOfMonth(today);
        handleSelect({ from: fromDate, to: today });
    }

    const setYear = () => {
        const today = new Date();
        const fromDate = startOfYear(today);
        handleSelect({ from: fromDate, to: today });
    }

    return (
        <div className={cn("grid gap-2", className)}>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                            "w-[300px] justify-start text-left font-normal",
                            !date && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date?.from ? (
                            date.to ? (
                                <>
                                    {format(date.from, "LLL dd, y")} -{" "}
                                    {format(date.to, "LLL dd, y")}
                                </>
                            ) : (
                                format(date.from, "LLL dd, y")
                            )
                        ) : (
                            <span>Pick a date range</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <div className="flex flex-col gap-2 p-2 border-b">
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setRange(0)}>Today</Button>
                            <Button variant="ghost" size="sm" onClick={() => setRange(1)}>Yesterday</Button>
                            <Button variant="ghost" size="sm" onClick={() => setRange(7)}>Last 7 Days</Button>
                            <Button variant="ghost" size="sm" onClick={() => setRange(30)}>Last 30 Days</Button>
                            <Button variant="ghost" size="sm" onClick={setMonth}>This Month</Button>
                            <Button variant="ghost" size="sm" onClick={setYear}>This Year</Button>
                        </div>
                    </div>
                    <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={date?.from}
                        selected={date}
                        onSelect={handleSelect}
                        numberOfMonths={2}
                    />
                </PopoverContent>
            </Popover>
        </div>
    )
}
