"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { motion, Variants } from "framer-motion";
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
  ChevronDown
} from "lucide-react";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

// Utility for fade in animation
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.2 } }
};

export default function MarketingLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 font-sans" dir="rtl">
      {/* Header */}
      <header className="px-4 lg:px-8 h-24 flex items-center justify-between border-b bg-white/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-50 shadow-sm">
        <Link className="flex items-center justify-center" href="/">
          <div className="relative h-16 w-40 md:h-20 md:w-48">
            <Image src="/logo.png" alt="eCommerx Logo" fill className="object-contain object-right" priority />
          </div>
        </Link>
        <nav className="hidden md:flex gap-8 items-center text-slate-700 dark:text-slate-100">
          <Link className="text-base font-semibold hover:text-primary transition-colors" href="#features">
            المميزات
          </Link>
          <Link className="text-base font-semibold hover:text-primary transition-colors" href="#why-us">
            ليه إحنا؟
          </Link>
          <Link className="text-base font-semibold hover:text-primary transition-colors" href="#pricing">
            العرض
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="hidden sm:flex text-base font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800" asChild>
            <Link href="/login">دخول</Link>
          </Button>
          <Button className="bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-primary/20 rounded-full px-6 py-5 text-base" asChild>
            <Link href="/register">ابدأ مجاناً</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {/* Hero Section */}
        <section className="relative w-full py-20 lg:py-32 xl:py-40 overflow-hidden">
          {/* Background Decorative Blobs */}
          <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/3 w-96 h-96 bg-primary/20 rounded-full blur-3xl opacity-50 dark:opacity-20 pointer-events-none" />
          <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 w-[500px] h-[500px] bg-blue-400/20 rounded-full blur-3xl opacity-50 dark:opacity-20 pointer-events-none" />

          <div className="container px-4 md:px-6 relative z-10 mx-auto max-w-7xl">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <motion.div 
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
                className="flex flex-col space-y-6 text-right"
              >
                <motion.div variants={fadeInUp} className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm md:text-base font-bold text-primary w-fit">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-primary mr-2 animate-pulse"></span>
                  <span className="mr-2">🔥 عرض حصري لفترة محدودة جداً!</span>
                </motion.div>
                
                <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.2]">
                  لسه بتدير شغلك بشيتات إكسيل وبتتوه في حسابات الأوردرات؟
                </motion.h1>
                
                <motion.div variants={fadeInUp} className="space-y-4">
                  <p className="text-lg md:text-xl font-medium text-slate-700 dark:text-slate-200 leading-relaxed max-w-xl">
                    سيستم <span className="font-bold text-primary text-xl">eCommerx</span> هو العقل المدبر للبزنس بتاعك.. دير مبيعاتك، مخزونك، وحساباتك كلها من شاشة واحدة.
                  </p>
                  <p className="text-base md:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                    سيستم متكامل بيربط متجرك بكل منصات البيع وأدوات الأتمتة وشركات الشحن في نفس اللحظة. تتبّع كل أوردر بالتفصيل، اطبع بوالص شحن عليها اللوجو بتاعك، ووفّر ساعات من الشغل اليدوي اللي بيلخبط الدنيا.
                  </p>
                </motion.div>
                
                <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 pt-4">
                  <Button size="lg" className="h-14 sm:h-16 px-8 text-lg sm:text-xl font-bold rounded-full shadow-xl shadow-primary/25 hover:scale-105 transition-transform" asChild>
                    <Link href="/register">👉 ابدأ شهرك التجريبي ببلاش دلوقتي!</Link>
                  </Button>
                </motion.div>
                <motion.p variants={fadeInUp} className="text-sm md:text-base text-slate-500 dark:text-slate-400 font-semibold">
                  (بدون كريديت كارد 💳 - من غير أي التزامات)
                </motion.p>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="relative mx-auto w-full max-w-[600px] lg:max-w-none mt-10 lg:mt-0"
              >
                <div className="relative rounded-2xl border border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/50 p-2 shadow-2xl backdrop-blur-sm">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
                    <Image
                      src="/hero-dashboard.png"
                      alt="eCommerx Dashboard Interface"
                      fill
                      className="object-cover"
                      priority
                    />
                  </div>
                  
                  {/* Floating Elements for "Motion" feel */}
                  <motion.div 
                    animate={{ y: [0, -10, 0] }} 
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                    className="absolute -right-4 md:-right-8 top-1/4 rounded-xl bg-white dark:bg-slate-800 p-4 shadow-xl border border-slate-100 dark:border-slate-700 hidden sm:flex items-center gap-4"
                  >
                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">تم توصيل الطلب</p>
                      <p className="text-xs font-semibold text-slate-500">تم التحديث آلياً</p>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Integrations Bar */}
        <section className="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-10 overflow-hidden">
          <div className="container mx-auto max-w-7xl px-4 text-center mb-8">
            <p className="text-base font-bold text-slate-500 dark:text-slate-400">
              سيستم واحد بيربطك بكل دول بضغطة زرار:
            </p>
          </div>
          
          {/* Marquee Container */}
          <div className="relative flex w-full overflow-hidden">
             <div className="flex w-max animate-marquee space-x-12 space-x-reverse px-6">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="flex space-x-16 space-x-reverse items-center justify-center">
                    <div className="relative h-12 w-32 grayscale hover:grayscale-0 transition-all opacity-60 hover:opacity-100"><Image src="/shopify.png" alt="Shopify" fill className="object-contain" /></div>
                    <div className="relative h-12 w-32 grayscale hover:grayscale-0 transition-all opacity-60 hover:opacity-100"><Image src="/woocommerce.png" alt="WooCommerce" fill className="object-contain" /></div>
                    <div className="relative h-12 w-32 grayscale hover:grayscale-0 transition-all opacity-60 hover:opacity-100"><Image src="/easyorders.png" alt="EasyOrders" fill className="object-contain" /></div>
                    <div className="relative h-12 w-32 grayscale hover:grayscale-0 transition-all opacity-60 hover:opacity-100"><Image src="/vrobo.png" alt="vRobo" fill className="object-contain" /></div>
                    <div className="relative h-12 w-32 grayscale hover:grayscale-0 transition-all opacity-60 hover:opacity-100"><Image src="/shipping-logos.png" alt="Shipping Companies" fill className="object-contain" /></div>
                  </div>
                ))}
             </div>
          </div>
        </section>

        {/* Agitation & Solution */}
        <section className="py-20 lg:py-24 bg-slate-50 dark:bg-slate-950">
          <div className="container px-4 md:px-6 mx-auto max-w-5xl text-center">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer}
              className="space-y-16"
            >
              <div className="space-y-8">
                <motion.h2 variants={fadeInUp} className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white leading-tight">
                  مشاكل كل يوم اللي بتسحب من أرباحك ومجهودك:
                </motion.h2>
                
                <div className="grid sm:grid-cols-2 gap-4 text-right">
                  {[
                    "أوردرات تايهة ومش عارف حالتها إيه مع شركات الشحن.",
                    "بضاعة بتخلص فجأة من غير ما تحس، أو فلوس مركونة في بضاعة مش بتتباع.",
                    "حسابات داخلة في بعض، ومفيش كنترول حقيقي على الموظفين.",
                    "بوالص شحن شكلها عشوائي ومكتوبة بخط الإيد بتضر باسم البراند بتاعك."
                  ].map((problem, idx) => (
                    <motion.div key={idx} variants={fadeInUp} className="flex items-start gap-3 p-5 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30">
                      <XCircle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-slate-800 dark:text-slate-200 font-semibold text-lg leading-snug">{problem}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              <motion.div variants={fadeInUp} className="relative p-10 md:p-14 rounded-3xl bg-primary text-white shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                <div className="relative z-10 flex flex-col items-center space-y-4">
                  <div className="p-4 bg-white/20 rounded-2xl backdrop-blur-md mb-2">
                    <ShieldCheck className="h-12 w-12 text-white" />
                  </div>
                  <h3 className="text-3xl md:text-4xl font-extrabold text-white">الحل الجذري؟</h3>
                  <p className="text-xl md:text-2xl text-white max-w-2xl font-bold leading-relaxed">
                    eCommerx مش مجرد أداة داتا إنتري..<br/>ده مدير عملياتك الآلي!
                  </p>
                </div>
              </motion.div>

            </motion.div>
          </div>
        </section>

        {/* Core Features */}
        <section id="features" className="py-20 lg:py-24 bg-white dark:bg-slate-900">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">المميزات اللي هتغير شغلك</h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8">
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
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ delay: idx * 0.1, duration: 0.5 }}
                  className="group flex flex-col p-8 border border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50 dark:bg-slate-950 hover:bg-white dark:hover:bg-slate-900 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary transition-all duration-300">
                    <feature.icon className="h-7 w-7 text-primary group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white">{feature.title}</h3>
                  <p className="text-lg text-slate-700 dark:text-slate-300 leading-relaxed font-medium">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Choose Us & Payment */}
        <section id="why-us" className="py-20 lg:py-24 bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="space-y-8"
              >
                <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  ليه eCommerx بالذات؟
                </h2>
                
                <div className="space-y-6">
                  {[
                    { title: "متجرك.. ألوانك", desc: "السيستم بيتلوّن حرفياً بألوان متجرك وبيظهر بهويتك." },
                    { title: "سرية تامة وصلاحيات صارمة", desc: "كل موظف بيشوف اللي إنت تسمحله بيه بس. مفيش موظف هيشوف أسعار الجملة أو يقدر يسرب داتا العملاء." },
                    { title: "نظام حضور وانصراف", desc: "راقب أوقات شغل فريقك والشيفتات من جوه الداشبورد." },
                    { title: "سريع ومبيقعش", desc: "مبني بأحدث تكنولوجيا عشان يتحمل ضغط آلاف الأوردرات في ثواني." }
                  ].map((item, idx) => (
                    <div key={idx} className="flex gap-4">
                      <div className="mt-1 h-6 w-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <h4 className="text-xl font-bold text-slate-900 dark:text-white">{item.title}</h4>
                        <p className="text-base md:text-lg font-medium text-slate-700 dark:text-slate-300 mt-1">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Added Payment Gateways */}
                <div className="pt-8 border-t border-slate-200 dark:border-slate-800">
                  <h4 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                    <CreditCard className="h-6 w-6 text-primary" />
                    سهولة تامة في الدفع
                  </h4>
                  <p className="text-base font-medium text-slate-700 dark:text-slate-300 mb-6">
                    ادفع اشتراكك بسهولة عبر تطبيق انستاباي (InstaPay) أو عبر المحافظ الإلكترونية، لتجربة سلسة بدون تعقيدات بنكية.
                  </p>
                  <div className="flex gap-4 items-center">
                    <div className="relative h-12 w-32 bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex items-center justify-center hover:scale-105 transition-transform cursor-pointer">
                      <Image src="/instapay.png" alt="Instapay" fill className="object-contain p-1" />
                    </div>
                    <div className="relative h-12 w-32 bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex items-center justify-center hover:scale-105 transition-transform cursor-pointer">
                      <Image src="/wallet.png" alt="Mobile Wallet" fill className="object-contain p-2" />
                    </div>
                  </div>
                </div>

              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                id="pricing"
              >
                {/* The Offer Box */}
                <div className="relative rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 md:p-10 shadow-2xl text-white overflow-hidden border border-slate-700">
                  <div className="absolute top-0 right-0 -translate-y-10 translate-x-10 w-40 h-40 bg-primary rounded-full blur-3xl opacity-50"></div>
                  
                  <div className="relative z-10 flex flex-col items-center text-center space-y-6">
                    <div className="inline-flex px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-white font-bold text-sm md:text-base">
                      🎁 عرض الشركاء الأوائل
                    </div>
                    
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-extrabold leading-tight text-white">
                      استثمر في كبر متجرك النهاردة..<br/>وجربنا على حسابنا!
                    </h3>
                    
                    <p className="text-lg font-medium text-slate-200">
                      عشان إحنا واثقين إن eCommerx هيقلب معاك الشغل 180 درجة، عملنالك عرض لفترة محدودة:
                    </p>
                    
                    <ul className="text-right space-y-3 w-full max-w-sm">
                      {[
                        "شهر كامل مجاني جرب فيه السيستم بكل مميزاته.",
                        "مش هنطلب منك كريديت كارد (ولا هندبسك في أي دفع).",
                        "تجهيز السيستم ليك مجاناً (Onboarding) في دقايق.",
                        "دعم فني معاك خطوة بخطوة."
                      ].map((benefit, idx) => (
                        <li key={idx} className="flex items-center gap-3 bg-white/10 rounded-lg p-3 border border-white/10">
                          <CheckCircle2 className="h-6 w-6 text-green-400 shrink-0" />
                          <span className="font-bold text-base">{benefit}</span>
                        </li>
                      ))}
                    </ul>
                    
                    <div className="w-full pt-4">
                      <Button size="lg" className="w-full h-16 text-lg md:text-xl font-bold rounded-xl bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/30" asChild>
                        <Link href="/register">👉 يلا نظبط البزنس؟ اعمل حسابك دلوقتي</Link>
                      </Button>
                      <p className="mt-4 text-sm md:text-base font-bold text-slate-300 flex items-center justify-center gap-2">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        </span>
                        العرض ده متاح لفترة محدودة جداً لأول المشتركين!
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="container px-4 md:px-6 mx-auto max-w-3xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">أسئلة بتدور في دماغك</h2>
            </div>
            
            <div className="space-y-4">
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
                <div key={idx} className="border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 overflow-hidden">
                  <button 
                    onClick={() => toggleFaq(idx)}
                    className="flex justify-between items-center w-full p-6 text-right font-extrabold text-lg md:text-xl text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                  >
                    {faq.q}
                    <ChevronDown className={`h-6 w-6 text-slate-500 transition-transform duration-300 ${openFaq === idx ? 'rotate-180' : ''}`} />
                  </button>
                  <motion.div 
                    initial={false}
                    animate={{ height: openFaq === idx ? 'auto' : 0, opacity: openFaq === idx ? 1 : 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-6 pt-0 text-lg font-medium text-slate-700 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800">
                      {faq.a}
                    </div>
                  </motion.div>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="w-full py-12 bg-slate-950 text-slate-400 border-t border-slate-800">
        <div className="container px-4 md:px-6 mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-4">
            <div className="relative h-12 w-32 md:h-16 md:w-40 grayscale brightness-200 opacity-80 hover:opacity-100 transition-opacity">
              <Image src="/logo.png" alt="eCommerx Logo" fill className="object-contain object-right" />
            </div>
            <p className="text-base font-bold text-slate-300">
              "اتصنع بكل فخر عشان يكبر شغل تجار الإي-كوميرس في مصر والوطن العربي"
            </p>
          </div>
          
          <div className="flex gap-6">
            <Link className="text-base font-semibold hover:text-white transition-colors" href="#">الشروط والأحكام</Link>
            <Link className="text-base font-semibold hover:text-white transition-colors" href="#">سياسة الخصوصية</Link>
            <Link className="text-base font-semibold hover:text-white transition-colors" href="#">كلمنا</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
