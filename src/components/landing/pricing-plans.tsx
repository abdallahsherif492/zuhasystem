"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { trackLead } from "@/lib/meta-pixel";
import { cn } from "@/lib/utils";

interface Package {
    id: string;
    name: string;
    duration_months: number;
    price: number;
    is_active: boolean;
}

// `-u-nu-latn` keeps Western digits (3,000) instead of the Arabic-Indic ones
// ar-EG defaults to (٣٬٠٠٠), which is what Egyptian price tags actually use.
const egp = new Intl.NumberFormat("ar-EG-u-nu-latn", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
});

/** Price per month, used both for the "أوفر" badge and the sub-label. */
const monthlyRate = (pkg: Package) =>
    pkg.duration_months > 0 ? Number(pkg.price) / pkg.duration_months : Number(pkg.price);

/**
 * Renders the subscription packages a System Admin defined in
 * System Admin > Pricing. Reads the same `packages` table the tenant billing
 * screen uses, so prices on the marketing page can never drift from the ones
 * customers actually get charged.
 *
 * Renders nothing when no active package exists, leaving the free-trial offer
 * as the only call to action.
 */
export function PricingPlans() {
    const [packages, setPackages] = useState<Package[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const fetchPackages = async () => {
            const { data, error } = await supabase
                .from("packages")
                .select("id, name, duration_months, price, is_active")
                .eq("is_active", true)
                .order("duration_months", { ascending: true });

            if (cancelled) return;
            if (!error && data) setPackages(data as Package[]);
            setLoading(false);
        };

        fetchPackages();
        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (packages.length === 0) return null;

    // Longest commitment is the best deal per month — highlight it.
    const bestValueId = packages.reduce((best, pkg) =>
        monthlyRate(pkg) < monthlyRate(best) ? pkg : best
    ).id;

    return (
        <section id="plans" className="py-24 lg:py-32 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
            <div className="container px-4 md:px-6 mx-auto max-w-7xl">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16 space-y-4"
                >
                    <h2 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white">
                        اختار الباقة اللي تناسب شغلك
                    </h2>
                    <p className="text-lg md:text-xl font-bold text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
                        كل الباقات فيها كل مميزات السيستم من غير أي حدود. الفرق بس في مدة الاشتراك — وكل ما المدة تطول، السعر الشهري يقل.
                    </p>
                </motion.div>

                <div className={cn(
                    "grid gap-8 max-w-6xl mx-auto",
                    packages.length === 1 ? "max-w-md" : packages.length === 2 ? "sm:grid-cols-2 max-w-3xl" : "sm:grid-cols-2 lg:grid-cols-3"
                )}>
                    {packages.map((pkg, idx) => {
                        const isBestValue = pkg.id === bestValueId && packages.length > 1;

                        return (
                            <motion.div
                                key={pkg.id}
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: idx * 0.1 }}
                                whileHover={{ y: -8 }}
                                className={cn(
                                    "relative flex flex-col rounded-[2rem] p-8 border-2 shadow-lg transition-colors",
                                    isBestValue
                                        ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-primary text-white shadow-2xl shadow-primary/25"
                                        : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                                )}
                            >
                                {isBestValue && (
                                    <div className="absolute -top-4 right-8 px-4 py-1.5 rounded-full bg-yellow-400 text-slate-900 font-black text-sm shadow-lg">
                                        ⭐ الأوفر
                                    </div>
                                )}

                                <h3 className={cn(
                                    "text-2xl font-black",
                                    isBestValue ? "text-white" : "text-slate-900 dark:text-white"
                                )}>
                                    {pkg.name}
                                </h3>

                                <div className="mt-6 flex items-baseline gap-2 flex-wrap">
                                    <span className={cn(
                                        "text-4xl md:text-5xl font-black",
                                        isBestValue ? "text-white" : "text-slate-900 dark:text-white"
                                    )}>
                                        {egp.format(Number(pkg.price))}
                                    </span>
                                    <span className={cn(
                                        "text-base font-bold",
                                        isBestValue ? "text-slate-300" : "text-slate-500 dark:text-slate-400"
                                    )}>
                                        / {pkg.duration_months === 1 ? "شهر" : `${pkg.duration_months} شهور`}
                                    </span>
                                </div>

                                {pkg.duration_months > 1 && (
                                    <p className={cn(
                                        "mt-2 text-sm font-bold",
                                        isBestValue ? "text-primary-foreground/80" : "text-primary"
                                    )}>
                                        يعني {egp.format(monthlyRate(pkg))} في الشهر
                                    </p>
                                )}

                                <ul className="mt-8 space-y-3 flex-1">
                                    {[
                                        "كل مميزات السيستم من غير حدود",
                                        "ربط مع منصات البيع وشركات الشحن",
                                        "عدد مستخدمين وصلاحيات مرنة",
                                        "دعم فني ومتابعة مستمرة",
                                    ].map((feature, i) => (
                                        <li key={i} className="flex items-center gap-3">
                                            <CheckCircle2 className={cn(
                                                "h-5 w-5 shrink-0",
                                                isBestValue ? "text-green-400" : "text-green-600 dark:text-green-400"
                                            )} />
                                            <span className={cn(
                                                "font-bold text-sm",
                                                isBestValue ? "text-slate-200" : "text-slate-700 dark:text-slate-300"
                                            )}>
                                                {feature}
                                            </span>
                                        </li>
                                    ))}
                                </ul>

                                <Button
                                    size="lg"
                                    className={cn(
                                        "mt-8 w-full h-14 text-lg font-black rounded-2xl group",
                                        isBestValue
                                            ? "bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/30"
                                            : "bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900"
                                    )}
                                    asChild
                                >
                                    <Link
                                        href={`/register?plan=${pkg.id}`}
                                        onClick={() => trackLead("Pricing Plan CTA", {
                                            content_category: "Landing Page",
                                            content_ids: [pkg.id],
                                            plan_name: pkg.name,
                                            value: Number(pkg.price),
                                            currency: "EGP",
                                        })}
                                    >
                                        ابدأ بالباقة دي
                                        <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                                    </Link>
                                </Button>
                            </motion.div>
                        );
                    })}
                </div>

                <p className="text-center mt-12 text-base font-bold text-slate-500 dark:text-slate-400">
                    كل الأسعار بالجنيه المصري • ابدأ بشهر تجريبي مجاني من غير كريديت كارد
                </p>
            </div>
        </section>
    );
}
