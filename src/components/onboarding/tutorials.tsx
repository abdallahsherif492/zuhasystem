"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PlayCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
import { supportMessages, supportWhatsappLink } from "@/lib/support";
import { TUTORIALS, TUTORIAL_PLAYLIST_URL, tutorialEmbedUrl, tutorialsForPath, type Tutorial } from "@/lib/tutorials";

/**
 * Tutorial videos, as the first answer to "how do I…".
 *
 * New signups messaged us on WhatsApp before trying anything, for questions
 * the videos answer in two minutes. So everywhere a new store might get stuck
 * the video comes first, and WhatsApp is a small line underneath it for
 * whoever watched and is still stuck.
 */

function Player({ tutorial, autoplay }: { tutorial: Tutorial; autoplay?: boolean }) {
    return (
        <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
            <iframe
                key={tutorial.n}
                src={tutorialEmbedUrl(tutorial, autoplay)}
                title={tutorial.title}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
            />
        </div>
    );
}

function Chapters({ list, current, onPick }: { list: Tutorial[]; current: number; onPick: (t: Tutorial) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {list.map(t => (
                <button
                    key={t.n}
                    type="button"
                    onClick={() => onPick(t)}
                    className={cn(
                        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                        t.n === current ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary hover:bg-primary/5",
                    )}
                >
                    <span className="tabular-nums opacity-70">{t.n}.</span>
                    <span>{t.title}</span>
                </button>
            ))}
        </div>
    );
}

/** The quiet fallback under a video: for whoever watched it and is still stuck. */
export function StillStuckLink({ topic, className }: { topic?: string; className?: string }) {
    const { activeBusiness } = useBusiness();
    const message = `${supportMessages.help(activeBusiness?.name)}${topic ? ` شفت فيديو "${topic}" ولسه محتاج مساعدة.` : ""}`;
    return (
        <p className={cn("text-xs text-muted-foreground", className)}>
            شفت الفيديو ولسه محتاج مساعدة؟{" "}
            <a href={supportWhatsappLink(message)} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                كلّمنا واتساب
            </a>
        </p>
    );
}

/**
 * All the tutorials, at the top of "Start here" — the page a new store lands
 * on right after signing up, so the videos are the first thing it sees.
 */
export function TutorialPlaylist() {
    const [current, setCurrent] = useState<Tutorial>(TUTORIALS[0]);
    return (
        <section id="tutorials" dir="rtl" className="scroll-mt-24 space-y-3 rounded-2xl border-2 border-primary/30 bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold"><PlayCircle className="h-5 w-5 text-primary" />ابدأ من هنا: اتفرج على الشرح</h2>
                    <p className="text-sm text-muted-foreground">
                        فيديوهات قصيرة بتمشي معاك خطوة بخطوة من التسجيل لحد الشحن. ابدأ بالأول وكمّل بالترتيب — أغلب الأسئلة إجابتها هنا.
                    </p>
                </div>
                <a href={TUTORIAL_PLAYLIST_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    افتحها على يوتيوب <ExternalLink className="h-3.5 w-3.5" />
                </a>
            </div>
            <Player tutorial={current} />
            <p className="font-semibold">{current.n}. {current.title}</p>
            <Chapters list={TUTORIALS} current={current.n} onPick={setCurrent} />
            <StillStuckLink topic={current.title} className="pt-1" />
        </section>
    );
}

/** A dialog playing one of `list`, with the rest of `list` one tap away. */
function TutorialDialog({ list, open, onOpenChange, subtitle }: {
    list: Tutorial[];
    open: boolean;
    onOpenChange: (v: boolean) => void;
    subtitle: string;
}) {
    const [picked, setPicked] = useState<number | null>(null);
    const current = list.find(t => t.n === picked) || list[0];
    return (
        <Dialog open={open} onOpenChange={v => { if (!v) setPicked(null); onOpenChange(v); }}>
            <DialogContent className="max-w-3xl" dir="rtl">
                <DialogHeader>
                    <DialogTitle>{current.n}. {current.title}</DialogTitle>
                    <DialogDescription>{subtitle}</DialogDescription>
                </DialogHeader>
                {open && <Player tutorial={current} autoplay />}
                {list.length > 1 && (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">فيديوهات تانية عن نفس الموضوع:</p>
                        <Chapters list={list} current={current.n} onPick={t => setPicked(t.n)} />
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <a href="/getting-started#tutorials" className="text-sm text-primary hover:underline">كل فيديوهات الشرح</a>
                    <StillStuckLink topic={current.title} />
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** A button that opens specific videos — e.g. "how to connect EasyOrders" beside that form. */
export function TutorialVideoButton({ numbers, label, className }: { numbers: number[]; label: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const list = numbers.map(n => TUTORIALS.find(t => t.n === n)).filter((t): t is Tutorial => !!t);
    if (!list.length) return null;
    return (
        <>
            <Button type="button" variant="outline" className={cn("min-h-11 gap-1.5 border-primary/30 text-primary hover:bg-primary/5", className)} onClick={() => setOpen(true)}>
                <PlayCircle className="h-4 w-4" /><span>{label}</span>
            </Button>
            <TutorialDialog list={list} open={open} onOpenChange={setOpen} subtitle="الفيديو ده بيشرح الخطوة دي بالظبط." />
        </>
    );
}

/**
 * "Video" in the header of every page that has one: opens the video made for
 * this page, with the others that touch it one tap away.
 */
export function PageTutorialButton() {
    const pathname = usePathname();
    const list = tutorialsForPath(pathname);
    const [open, setOpen] = useState(false);
    if (!list.length) return null;
    return (
        <>
            <Button
                variant="outline"
                className="min-h-11 shrink-0 gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
                onClick={() => setOpen(true)}
                title={list[0].title}
            >
                <PlayCircle className="h-4 w-4" />
                <span>فيديو الشرح</span>
            </Button>
            <TutorialDialog list={list} open={open} onOpenChange={setOpen} subtitle="شرح الصفحة اللي انت فيها." />
        </>
    );
}

/**
 * For a store still setting up: a video button pinned to the corner of every
 * screen, where the WhatsApp button used to be. It opens this page's video, or
 * the first one on pages that have none.
 */
export function TutorialFloatingButton() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const forPage = tutorialsForPath(pathname);
    const list = forPage.length ? forPage : TUTORIALS;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="fixed bottom-24 left-6 z-50 inline-flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground shadow-xl transition-transform hover:scale-105 print:hidden"
            >
                <PlayCircle className="h-6 w-6" />
                <span className="hidden sm:inline">{forPage.length ? "شرح الصفحة بالفيديو" : "فيديوهات الشرح"}</span>
            </button>
            <TutorialDialog list={list} open={open} onOpenChange={setOpen} subtitle={forPage.length ? "شرح الصفحة اللي انت فيها." : "ابدأ بالأول وكمّل بالترتيب."} />
        </>
    );
}
