"use client"

import { CheckCircle2, Loader2, XCircle } from "lucide-react";

interface ActionFeedbackProps {
    state: 'loading' | 'success' | 'error';
    message: string;
}

export const ActionFeedback = ({ state, message }: ActionFeedbackProps) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-all duration-300">
            <div className="flex flex-col items-center justify-center p-8 bg-card rounded-xl shadow-2xl border border-primary/20 min-w-[280px] animate-in fade-in zoom-in-95 duration-200">
                {state === 'loading' && (
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full border-[6px] border-secondary opacity-30"></div>
                        <div className="absolute inset-0 rounded-full border-[6px] border-primary border-t-transparent animate-spin"></div>
                        {/* Optional: Add a logo or icon in the center if needed */}
                        <div className="w-16 h-16"></div>
                    </div>
                )}
                {state === 'success' && (
                    <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-green-100/50 dark:bg-green-900/20">
                        <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-500 animate-in zoom-in duration-300" />
                    </div>
                )}
                {state === 'error' && (
                    <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-red-100/50 dark:bg-red-900/20">
                        <XCircle className="w-10 h-10 text-red-600 dark:text-red-500 animate-in zoom-in duration-300" />
                    </div>
                )}
                <p className={`mt-6 text-lg font-semibold text-center ${state === 'loading' ? 'animate-pulse text-foreground' : state === 'success' ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                    {message}
                </p>
            </div>
        </div>
    );
};
