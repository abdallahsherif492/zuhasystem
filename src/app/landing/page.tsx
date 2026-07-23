"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { motion, Variants, useScroll, useTransform } from "framer-motion";
import {
  CheckCircle2,
  Package,
  TrendingUp,
  Users,
  ShieldCheck,
  RefreshCw,
  Box,
  Printer,
  XCircle,
  CreditCard,
  Smartphone,
  ChevronDown,
  ArrowLeft
} from "lucide-react";
import { useState, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

// Advanced animations
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 50 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }
};

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.2 } }
};

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }
};

const floatingAnimation = {
  y: ["-10px", "10px"],
  transition: {
    duration: 3,
    repeat: Infinity,
    repeatType: "reverse" as const,
    ease: "easeInOut" as const
  }
};

export default function MarketingLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start start", "end end"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 font-sans overflow-x-hidden" dir="rtl" ref={containerRef}>
      
      {/* Dynamic CSS for Marquee since it's RTL and needs exact control */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes custom-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(50%); } 
        }
        .animate-custom-marquee {
          animation: custom-marquee 25s linear infinite;
        }
        .animate-custom-marquee:hover {
          animation-play-state: paused;
        }
      `}} />

      {/* Header */}
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="px-4 lg:px-8 h-24 flex items-center justify-between border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sticky top-0 z-50 shadow-sm"
      >
        <Link className="flex items-center justify-center" href="/">
          <motion.div whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 400, damping: 10 }} className="relative h-16 w-40 md:h-20 md:w-48">
            <Image src="/logo.png" alt="eCommerx Logo" fill className="object-contain object-right" priority />
          </motion.div>
        </Link>
        <nav className="hidden md:flex gap-8 items-center text-slate-700 dark:text-slate-100">
          {["المميزات", "ليه إحنا؟", "العرض"].map((item, idx) => (
            <Link key={idx} className="text-base font-bold hover:text-primary transition-all hover:scale-105" href={idx === 0 ? "#features" : idx === 1 ? "#why-us" : "#pricing"}>
              {item}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="hidden sm:flex text-base font-bold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800" asChild>
            <Link href="/login">دخول</Link>
          </Button>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button className="bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-primary/25 rounded-full px-6 py-5 text-base" asChild>
              <Link href="/register">ابدأ مجاناً</Link>
            </Button>
          </motion.div>
        </div>
      </motion.header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative w-full py-20 lg:py-32 xl:py-40 overflow-hidden">
          {/* Parallax Background Blobs */}
          <motion.div style={{ y }} className="absolute inset-0 z-0 pointer-events-none">
            <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/4 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[100px] dark:opacity-30" />
            <div className="absolute bottom-0 left-0 translate-y-1/4 -translate-x-1/4 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[100px] dark:opacity-30" />
          </motion.div>

          <div className="container px-4 md:px-6 relative z-10 mx-auto max-w-7xl">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <motion.div 
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
                className="flex flex-col space-y-6 text-right"
              >
                <motion.div variants={fadeInUp} whileHover={{ scale: 1.05 }} className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm md:text-base font-bold text-primary w-fit shadow-sm cursor-default">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-primary mr-2 animate-ping absolute opacity-75"></span>
                  <span className="flex h-2.5 w-2.5 rounded-full bg-primary mr-2 relative"></span>
                  <span className="mr-2">🔥 عرض حصري لفترة محدودة جداً!</span>
                </motion.div>
                
                <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.2] lg:leading-[1.2]">
                  لسه بتدير شغلك بشيتات إكسيل وبتتوه في حسابات الأوردرات؟
                </motion.h1>
                
                <motion.div variants={fadeInUp} className="space-y-4 relative">
                  {/* Decorative line */}
                  <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary to-transparent rounded-full -mr-4 opacity-50"></div>
                  
                  <p className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 leading-relaxed max-w-xl">
                    سيستم <span className="text-primary text-2xl font-black bg-primary/10 px-2 py-1 rounded-md">eCommerx</span> هو العقل المدبر للبزنس بتاعك.. دير مبيعاتك، مخزونك، وحساباتك كلها من شاشة واحدة.
                  </p>
                  <p className="text-base md:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl font-medium">
                    سيستم متكامل بيربط متجرك بكل منصات البيع وأدوات الأتمتة وشركات الشحن في نفس اللحظة. تتبّع كل أوردر بالتفصيل، اطبع بوالص شحن عليها اللوجو بتاعك، ووفّر ساعات من الشغل اليدوي اللي بيلخبط الدنيا.
                  </p>
                </motion.div>
                
                <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 pt-6">
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="w-full sm:w-auto">
                    <Button size="lg" className="w-full h-16 sm:h-18 px-8 text-lg sm:text-xl font-bold rounded-full shadow-2xl shadow-primary/30 bg-primary hover:bg-primary/90 text-white flex items-center gap-3 group" asChild>
                      <Link href="/register">
                        👉 ابدأ شهرك التجريبي ببلاش دلوقتي!
                        <ArrowLeft className="w-6 h-6 group-hover:-translate-x-2 transition-transform" />
                      </Link>
                    </Button>
                  </motion.div>
                </motion.div>
                <motion.p variants={fadeInUp} className="text-sm md:text-base text-slate-500 dark:text-slate-400 font-bold pr-4">
                  (بدون كريديت كارد 💳 - من غير أي التزامات)
                </motion.p>
              </motion.div>

              <motion.div 
                initial="hidden"
                animate="visible"
                variants={scaleIn}
                className="relative mx-auto w-full mt-12 lg:mt-0"
              >
                {/* 
                  The Hero Image:
                  Using aspect-[2880/1446] to ensure the 2880x1446 image is never cropped,
                  and object-contain to make sure the entire image fits beautifully.
                */}
                <motion.div 
                  animate={{ y: [-15, 15] }} 
                  transition={{ repeat: Infinity, duration: 4, repeatType: "reverse", ease: "easeInOut" }}
                  className="relative rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white/40 dark:bg-slate-900/40 p-2 shadow-2xl backdrop-blur-xl"
                >
                  <div className="relative aspect-[2880/1446] w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 shadow-inner">
                    <Image
                      src="/hero-dashboard.png"
                      alt="eCommerx Dashboard Full View"
                      fill
                      className="object-contain"
                      priority
                    />
                  </div>
                  
                  {/* Floating Elements for "Advanced Motion" feel */}
                  <motion.div 
                    animate={{ y: [0, -20, 0], rotate: [0, 5, 0] }} 
                    transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
                    className="absolute -right-4 md:-right-8 top-1/4 rounded-xl bg-white dark:bg-slate-800 p-4 shadow-xl border border-slate-100 dark:border-slate-700 hidden sm:flex items-center gap-4 z-20"
                  >
                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">تم توصيل الطلب</p>
                      <p className="text-xs font-semibold text-slate-500">تم التحديث آلياً</p>
                    </div>
                  </motion.div>

                  <motion.div 
                    animate={{ y: [0, 20, 0], rotate: [0, -5, 0] }} 
                    transition={{ repeat: Infinity, duration: 6, ease: "easeInOut", delay: 1 }}
                    className="absolute -left-4 md:-left-8 bottom-1/4 rounded-xl bg-white dark:bg-slate-800 p-4 shadow-xl border border-slate-100 dark:border-slate-700 hidden sm:flex items-center gap-4 z-20"
                  >
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <RefreshCw className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">جاري المزامنة</p>
                      <p className="text-xs font-semibold text-slate-500">مع Shopify</p>
                    </div>
                  </motion.div>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Integrations Bar - FULLY VISIBLE & ANIMATED */}
        <section className="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-12 overflow-hidden shadow-sm relative z-20">
          <div className="container mx-auto max-w-7xl px-4 text-center mb-10">
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-lg font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 inline-block px-6 py-2 rounded-full"
            >
              سيستم واحد بيربطك بكل دول بضغطة زرار:
            </motion.p>
          </div>
          
          <div className="relative flex w-full overflow-hidden">
             {/* Gradient Overlays for smooth edges */}
             <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-white dark:from-slate-900 to-transparent z-10"></div>
             <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-white dark:from-slate-900 to-transparent z-10"></div>
             
             <div className="flex w-[200%] animate-custom-marquee">
                {/* We render the logos multiple times for seamless scrolling. 
                    Removed grayscale and opacity so they are bright and colorful by default! */}
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex w-1/2 justify-around items-center px-4">
                    <motion.div whileHover={{ scale: 1.15, rotate: 2 }} className="relative h-16 w-36 mx-6 cursor-pointer drop-shadow-md">
                      <Image src="/shopify.png" alt="Shopify" fill className="object-contain" />
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.15, rotate: -2 }} className="relative h-16 w-36 mx-6 cursor-pointer drop-shadow-md">
                      <Image src="/woocommerce.png" alt="WooCommerce" fill className="object-contain" />
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.15, rotate: 2 }} className="relative h-16 w-36 mx-6 cursor-pointer drop-shadow-md">
                      <Image src="/easyorders.png" alt="EasyOrders" fill className="object-contain" />
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.15, rotate: -2 }} className="relative h-16 w-36 mx-6 cursor-pointer drop-shadow-md">
                      <Image src="/vrobo.png" alt="vRobo" fill className="object-contain" />
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.15, rotate: 2 }} className="relative h-16 w-48 mx-6 cursor-pointer drop-shadow-md">
                      <Image src="/shipping-logos.png" alt="Shipping Companies" fill className="object-contain" />
                    </motion.div>
                  </div>
                ))}
             </div>
          </div>
        </section>

        {/* Agitation & Solution */}
        <section className="py-24 lg:py-32 bg-slate-50 dark:bg-slate-950 relative">
          <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-800 to-transparent"></div>
          
          <div className="container px-4 md:px-6 mx-auto max-w-5xl text-center relative z-10">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer}
              className="space-y-20"
            >
              <div className="space-y-12">
                <motion.div variants={fadeInUp} className="inline-block">
                  <h2 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white leading-tight mb-4">
                    مشاكل كل يوم اللي بتسحب من أرباحك ومجهودك:
                  </h2>
                  <div className="h-1.5 w-1/3 bg-red-500 mx-auto rounded-full"></div>
                </motion.div>
                
                <div className="grid sm:grid-cols-2 gap-6 text-right">
                  {[
                    "أوردرات تايهة ومش عارف حالتها إيه مع شركات الشحن.",
                    "بضاعة بتخلص فجأة من غير ما تحس، أو فلوس مركونة في بضاعة مش بتتباع.",
                    "حسابات داخلة في بعض، ومفيش كنترول حقيقي على الموظفين.",
                    "بوالص شحن شكلها عشوائي ومكتوبة بخط الإيد بتضر باسم البراند بتاعك."
                  ].map((problem, idx) => (
                    <motion.div 
                      key={idx} 
                      variants={fadeInUp} 
                      whileHover={{ scale: 1.02, x: -5 }}
                      className="flex items-start gap-4 p-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-red-100 dark:border-red-900/30 shadow-xl shadow-red-500/5 group transition-colors hover:border-red-300 dark:hover:border-red-500/50"
                    >
                      <div className="bg-red-50 dark:bg-red-950/50 p-2 rounded-full shrink-0 group-hover:scale-110 transition-transform">
                        <XCircle className="h-7 w-7 text-red-500 mt-0.5" />
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 font-bold text-lg leading-snug">{problem}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              <motion.div 
                variants={scaleIn} 
                whileHover={{ scale: 1.02 }}
                className="relative p-12 md:p-16 rounded-[2.5rem] bg-gradient-to-tr from-primary via-indigo-600 to-blue-500 text-white shadow-2xl shadow-primary/40 overflow-hidden"
              >
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                
                {/* Animated Background Elements in Solution Box */}
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 50, repeat: Infinity, ease: "linear" }} className="absolute -top-32 -right-32 w-64 h-64 border-[40px] border-white/10 rounded-full blur-sm"></motion.div>
                <motion.div animate={{ rotate: -360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }} className="absolute -bottom-32 -left-32 w-64 h-64 border-[40px] border-white/10 rounded-full blur-sm"></motion.div>

                <div className="relative z-10 flex flex-col items-center space-y-6">
                  <motion.div animate={floatingAnimation} className="p-5 bg-white/20 rounded-3xl backdrop-blur-md mb-2 shadow-inner border border-white/30">
                    <ShieldCheck className="h-16 w-16 text-white drop-shadow-md" />
                  </motion.div>
                  <h3 className="text-4xl md:text-5xl font-black text-white drop-shadow-lg">الحل الجذري؟</h3>
                  <p className="text-2xl md:text-3xl text-white max-w-2xl font-extrabold leading-relaxed drop-shadow-md">
                    eCommerx مش مجرد أداة داتا إنتري..<br/>
                    <span className="text-yellow-300">ده مدير عملياتك الآلي!</span>
                  </p>
                </div>
              </motion.div>

            </motion.div>
          </div>
        </section>

        {/* Core Features */}
        <section id="features" className="py-24 lg:py-32 bg-white dark:bg-slate-900 relative">
          {/* Subtle grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
          
          <div className="container px-4 md:px-6 mx-auto max-w-7xl relative z-10">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <h2 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white inline-block relative">
                المميزات اللي هتغير شغلك
                <div className="absolute -bottom-4 left-0 right-0 h-2 bg-primary/20 rounded-full"></div>
              </h2>
            </motion.div>
            
            <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
              {[
                {
                  icon: RefreshCw,
                  title: "ربط أوتوماتيك مابيفصلش (Auto-Sync)",
                  desc: "انسى الشغل اليدوي تماماً. السيستم بيسحب أوردراتك أوتوماتيك من (شوبيفاي، ووكومرس، إيزي أوردرز) ويربطها بأدوات الأتمتة زي (vRobo)، وبيحدّث حالات الشحن مع كل الشركات في نفس اللحظة من غير ما تتدخل."
                },
                {
                  icon: Box,
                  title: "مخزون وحسابات بتتحسب بالملي",
                  desc: "السيستم مش بس بيعد بضاعتك، ده فيه ذكاء اصطناعي بيقولك \"إمتى تشتري بضاعة قبل ما تخلص\"، وبيكشفلك البضاعة المركونة اللي مجمدة فلوسك عشان تتصرف فيها. ده غير إنه بينظملك حساباتك وصافي أرباحك بدقة."
                },
                {
                  icon: TrendingUp,
                  title: "تراكينج لكل تفصيلة.. ومفيش مجال للتلاعب",
                  desc: "تراك كل أوردر من لحظة ما يدخل لحد ما يتسلم أو يرتجع. السيستم بيسجل كل حركة باسم الموظف اللي عملها، وتقدر تكتب \"نوتس\" جوه الأوردر لخدمة العملاء، وتفتح شات واتساب مع العميل بضغطة واحدة من جوه السيستم."
                },
                {
                  icon: Printer,
                  title: "بوالص شحن شيك عليها اللوجو بتاعك",
                  desc: "خليك براند تقيل قدام عميلك! السيستم بيطبعلك بوالص الشحن (Waybills) وعليها اللوجو الخاص بيك واسم متجرك، عشان العميل يحس إنه بيشتري من براند كبير مش مجرد صفحة على السوشيال ميديا."
                }
              ].map((feature, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, y: 50, scale: 0.95 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ delay: idx * 0.15, duration: 0.6, type: "spring", bounce: 0.4 }}
                  whileHover={{ y: -10, scale: 1.02 }}
                  className="group flex flex-col p-8 md:p-10 border-2 border-slate-100 dark:border-slate-800 rounded-[2rem] bg-slate-50 dark:bg-slate-950 hover:bg-white dark:hover:bg-slate-900 shadow-lg hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-[100px] -z-10 group-hover:scale-125 transition-transform duration-500"></div>
                  
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-8 group-hover:scale-110 group-hover:bg-primary transition-all duration-500 shadow-inner group-hover:shadow-primary/50 group-hover:rotate-6">
                    <feature.icon className="h-8 w-8 text-primary group-hover:text-white transition-colors duration-500" />
                  </div>
                  <h3 className="text-2xl md:text-3xl font-black mb-4 text-slate-900 dark:text-white">{feature.title}</h3>
                  <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed font-bold">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Choose Us & Payment */}
        <section id="why-us" className="py-24 lg:py-32 bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
          <div className="container px-4 md:px-6 mx-auto max-w-7xl">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="space-y-10"
              >
                <h2 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white leading-tight">
                  ليه eCommerx بالذات؟
                </h2>
                
                <div className="space-y-8">
                  {[
                    { title: "متجرك.. ألوانك", desc: "السيستم بيتلوّن حرفياً بألوان متجرك وبيظهر بهويتك." },
                    { title: "سرية تامة وصلاحيات صارمة", desc: "كل موظف بيشوف اللي إنت تسمحله بيه بس. مفيش موظف هيشوف أسعار الجملة أو يقدر يسرب داتا العملاء." },
                    { title: "نظام حضور وانصراف", desc: "راقب أوقات شغل فريقك والشيفتات من جوه الداشبورد." },
                    { title: "سريع ومبيقعش", desc: "مبني بأحدث تكنولوجيا عشان يتحمل ضغط آلاف الأوردرات في ثواني." }
                  ].map((item, idx) => (
                    <motion.div 
                      key={idx} 
                      whileHover={{ x: -10 }}
                      className="flex gap-5 group cursor-default"
                    >
                      <div className="mt-1 h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 group-hover:bg-green-500 transition-colors shadow-sm">
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 group-hover:text-white transition-colors" />
                      </div>
                      <div>
                        <h4 className="text-2xl font-black text-slate-900 dark:text-white group-hover:text-primary transition-colors">{item.title}</h4>
                        <p className="text-lg font-bold text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{item.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Added Payment Gateways */}
                <motion.div 
                  whileHover={{ scale: 1.02 }}
                  className="p-8 rounded-3xl bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 shadow-xl"
                >
                  <h4 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-3 mb-4">
                    <CreditCard className="h-8 w-8 text-primary" />
                    سهولة تامة في الدفع
                  </h4>
                  <p className="text-lg font-bold text-slate-600 dark:text-slate-400 mb-8">
                    ادفع اشتراكك بسهولة عبر تطبيق انستاباي (InstaPay) أو عبر المحافظ الإلكترونية، لتجربة سلسة بدون تعقيدات بنكية.
                  </p>
                  <div className="flex gap-6 items-center">
                    <motion.div whileHover={{ scale: 1.1, rotate: 2 }} className="relative h-16 w-40 bg-white rounded-xl p-2 border-2 border-slate-100 shadow-md flex items-center justify-center cursor-pointer">
                      <Image src="/instapay.png" alt="Instapay" fill className="object-contain p-2" />
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.1, rotate: -2 }} className="relative h-16 w-40 bg-white rounded-xl p-2 border-2 border-slate-100 shadow-md flex items-center justify-center cursor-pointer">
                      <Image src="/wallet.png" alt="Mobile Wallet" fill className="object-contain p-3" />
                    </motion.div>
                  </div>
                </motion.div>

              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.8, rotateY: 15 }}
                whileInView={{ opacity: 1, scale: 1, rotateY: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, type: "spring" }}
                id="pricing"
                className="perspective-1000"
              >
                {/* The Offer Box */}
                <motion.div 
                  whileHover={{ y: -10, boxShadow: "0 25px 50px -12px rgba(99, 102, 241, 0.4)" }}
                  className="relative rounded-[2.5rem] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-10 md:p-12 shadow-2xl text-white overflow-hidden border border-slate-700/50"
                >
                  <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-primary rounded-full blur-[80px] opacity-60 pointer-events-none"></div>
                  <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-64 h-64 bg-blue-500 rounded-full blur-[80px] opacity-40 pointer-events-none"></div>
                  
                  <div className="relative z-10 flex flex-col items-center text-center space-y-8">
                    <motion.div 
                      animate={{ scale: [1, 1.05, 1] }} 
                      transition={{ duration: 2, repeat: Infinity }}
                      className="inline-flex px-6 py-2 rounded-full bg-yellow-400/20 border-2 border-yellow-400 text-yellow-400 font-black text-lg shadow-[0_0_15px_rgba(250,204,21,0.5)]"
                    >
                      🎁 عرض الشركاء الأوائل
                    </motion.div>
                    
                    <h3 className="text-3xl sm:text-4xl md:text-5xl font-black leading-[1.3] text-white">
                      استثمر في كبر متجرك النهاردة..<br/>وجربنا على حسابنا!
                    </h3>
                    
                    <p className="text-xl font-bold text-slate-300 leading-relaxed">
                      عشان إحنا واثقين إن eCommerx هيقلب معاك الشغل 180 درجة، عملنالك عرض لفترة محدودة:
                    </p>
                    
                    <ul className="text-right space-y-4 w-full">
                      {[
                        "شهر كامل مجاني جرب فيه السيستم بكل مميزاته.",
                        "مش هنطلب منك كريديت كارد (ولا هندبسك في أي دفع).",
                        "تجهيز السيستم ليك مجاناً (Onboarding) في دقايق.",
                        "دعم فني معاك خطوة بخطوة."
                      ].map((benefit, idx) => (
                        <motion.li 
                          key={idx} 
                          initial={{ opacity: 0, x: -20 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.3 + (idx * 0.1) }}
                          className="flex items-center gap-4 bg-white/5 hover:bg-white/10 transition-colors rounded-xl p-4 border border-white/10"
                        >
                          <div className="bg-green-500/20 p-1.5 rounded-full shrink-0">
                            <CheckCircle2 className="h-6 w-6 text-green-400" />
                          </div>
                          <span className="font-bold text-lg">{benefit}</span>
                        </motion.li>
                      ))}
                    </ul>
                    
                    <div className="w-full pt-6">
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button size="lg" className="w-full h-20 text-xl md:text-2xl font-black rounded-2xl bg-gradient-to-r from-primary to-indigo-500 hover:from-primary/90 hover:to-indigo-500/90 text-white shadow-xl shadow-primary/40 border-b-4 border-primary-foreground/20" asChild>
                          <Link href="/register">👉 يلا نظبط البزنس؟ حسابك مجاني الآن</Link>
                        </Button>
                      </motion.div>
                      <p className="mt-6 text-base md:text-lg font-black text-slate-300 flex items-center justify-center gap-3">
                        <span className="relative flex h-4 w-4">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
                        </span>
                        العرض ده متاح لفترة محدودة جداً لأول المشتركين!
                      </p>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-24 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="container px-4 md:px-6 mx-auto max-w-4xl">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white">أسئلة بتدور في دماغك</h2>
            </motion.div>
            
            <div className="space-y-6">
              {[
                {
                  q: "هربط السيستم بمتجري إزاي؟ هحتاج مبرمج؟",
                  a: "إطلاقاً! الموضوع كله Copy/Paste لكود واحد بس في دقايق، والسيستم هيشتغل معاك أوتوماتيك."
                },
                {
                  q: "إيه اللي هيحصل بعد الشهر المجاني ما يخلص؟",
                  a: "لما تتأكد إن السيستم وفر عليك وقت ومجهود وفلوس، تقدر وقتها تختار الباقة اللي تناسب حجم شغلك وتدفع بوسائل الدفع العادية بتاعتنا."
                }
              ].map((faq, idx) => (
                <motion.div 
                  key={idx} 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="border-2 border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50 dark:bg-slate-950 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                  <button 
                    onClick={() => toggleFaq(idx)}
                    className="flex justify-between items-center w-full p-8 text-right font-black text-xl md:text-2xl text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-900/50 transition-colors"
                  >
                    {faq.q}
                    <motion.div 
                      animate={{ rotate: openFaq === idx ? 180 : 0 }} 
                      transition={{ type: "spring", stiffness: 200, damping: 15 }}
                      className="bg-slate-200 dark:bg-slate-800 p-2 rounded-full"
                    >
                      <ChevronDown className="h-6 w-6 text-slate-700 dark:text-slate-300" />
                    </motion.div>
                  </button>
                  <motion.div 
                    initial={false}
                    animate={{ height: openFaq === idx ? 'auto' : 0, opacity: openFaq === idx ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="p-8 pt-0 text-xl font-bold text-slate-600 dark:text-slate-400 leading-relaxed border-t-2 border-slate-100 dark:border-slate-800/50 mt-2">
                      {faq.a}
                    </div>
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="w-full py-16 bg-slate-950 text-slate-400 border-t-4 border-primary">
        <div className="container px-4 md:px-6 mx-auto flex flex-col md:flex-row justify-between items-center gap-10">
          <div className="flex flex-col items-center md:items-start gap-6 text-center md:text-right">
            <motion.div whileHover={{ scale: 1.1 }} className="relative h-16 w-40 md:h-20 md:w-48 grayscale brightness-200 opacity-80 hover:opacity-100 hover:grayscale-0 transition-all duration-500 cursor-pointer">
              <Image src="/logo.png" alt="eCommerx Logo" fill className="object-contain object-right" />
            </motion.div>
            <p className="text-lg md:text-xl font-black text-slate-300 max-w-md leading-relaxed">
              "اتصنع بكل فخر عشان يكبر شغل تجار الإي-كوميرس في مصر والوطن العربي"
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-8">
            <Link className="text-lg font-bold hover:text-white transition-colors" href="#">الشروط والأحكام</Link>
            <Link className="text-lg font-bold hover:text-white transition-colors" href="#">سياسة الخصوصية</Link>
            <Link className="text-lg font-bold hover:text-white transition-colors" href="#">كلمنا</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
