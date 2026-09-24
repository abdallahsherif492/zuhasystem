"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PlayCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TUTORIALS, TUTORIAL_PLAYLIST_URL, tutorialEmbedUrl, tutorialsForPath, type Tutorial } from "@/lib/tutorials";

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

/**
 * All the tutorials, at the top of "Start here" — the page a new store lands
 * on right after signing up, so the videos are the first thing it sees.
 */
export function TutorialPlaylist() {
    const [current, setCurrent] = useState<Tutorial>(TUTORIALS[0]);
    return (
        <section id="tutorials" dir="rtl" className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold"><PlayCircle className="h-5 w-5 text-primary" />اتفرج على الشرح الأول</h2>
                    <p className="text-sm text-muted-foreground">فيديوهات قصيرة، كل واحد بيشرح خطوة من أول التسجيل لحد الشحن.</p>
                </div>
                <a href={TUTORIAL_PLAYLIST_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    افتحها على يوتيوب <ExternalLink className="h-3.5 w-3.5" />
                </a>
            </div>
            <Player tutorial={current} />
            <p className="font-semibold">{current.n}. {current.title}</p>
            <Chapters list={TUTORIALS} current={current.n} onPick={setCurrent} />
        </section>
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
    const [picked, setPicked] = useState<number | null>(null);
    if (!list.length) return null;
    const current = list.find(t => t.n === picked) || list[0];

    return (
        <>
            <Button
                variant="outline"
                className="min-h-11 shrink-0 gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
                onClick={() => { setPicked(null); setOpen(true); }}
                title={current.title}
            >
                <PlayCircle className="h-4 w-4" />
                <span>فيديو الشرح</span>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-3xl" dir="rtl">
                    <DialogHeader>
                        <DialogTitle>{current.n}. {current.title}</DialogTitle>
                        <DialogDescription>شرح الصفحة اللي انت فيها.</DialogDescription>
                    </DialogHeader>
                    {open && <Player tutorial={current} autoplay />}
                    {list.length > 1 && (
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">فيديوهات تانية عن الصفحة دي:</p>
                            <Chapters list={list} current={current.n} onPick={t => setPicked(t.n)} />
                        </div>
                    )}
                    <a href="/getting-started#tutorials" className="text-sm text-primary hover:underline">كل فيديوهات الشرح</a>
                </DialogContent>
            </Dialog>
        </>
    );
}
