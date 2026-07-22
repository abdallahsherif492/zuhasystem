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
      <header className="px-4 lg:px-8 h-20 flex items-center justify-between border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <Link className="flex items-center justify-center" href="/">
          <div className="relative h-12 w-32">
            <Image src="/logo.png" alt="eCommerx Logo" fill className="object-contain object-right" />
          </div>
        </Link>
        <nav className="hidden md:flex gap-8 items-center text-slate-600 dark:text-slate-300">
          <Link className="text-sm font-medium hover:text-primary transition-colors" href="#features">
            المميزات
          </Link>
          <Link className="text-sm font-medium hover:text-primary transition-colors" href="#why-us">
            لماذا نحن؟
          </Link>
          <Link className="text-sm font-medium hover:text-primary transition-colors" href="#pricing">
            الأسعار
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="hidden sm:flex text-slate-600 dark:text-slate-300" asChild>
            <Link href="/login">تسجيل الدخول</Link>
          </Button>
          <Button className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 rounded-full px-6" asChild>
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
                <motion.div variants={fadeInUp} className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm text-primary w-fit">
                  <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
                  <span className="mr-2 font-medium">🔥 عرض لفترة محدودة جداً!</span>
                </motion.div>
                
                <motion.h1 variants={fadeInUp} className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl text-slate-900 dark:text-white leading-[1.1]">
                  تعبت من فوضى الأوردرات وشيتات الإكسيل؟
                </motion.h1>
                
                <motion.p variants={fadeInUp} className="text-lg md:text-xl text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                  نظام <span className="font-bold text-primary">eCommerx</span> هو العقل المدبر لمتجرك الإلكتروني.. أدر مبيعاتك، مخزونك، وحساباتك من شاشة واحدة. نظام متكامل يربط متجرك بمنصات البيع، أدوات الأتمتة، وشركات الشحن لحظياً.
                </motion.p>
                
                <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 pt-4">
                  <Button size="lg" className="h-14 px-8 text-lg rounded-full shadow-xl shadow-primary/25 hover:scale-105 transition-transform" asChild>
                    <Link href="/register">👉 ابدأ فترتك التجريبية الآن (شهر كامل مجاناً!)</Link>
                  </Button>
                </motion.div>
                <motion.p variants={fadeInUp} className="text-sm text-slate-500 font-medium">
                  بدون كريديت كارد 💳 - بدون أي التزامات الدفع
                </motion.p>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="relative mx-auto w-full max-w-[600px] lg:max-w-none"
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
                    className="absolute -right-6 top-1/4 rounded-xl bg-white dark:bg-slate-800 p-4 shadow-xl border border-slate-100 dark:border-slate-700 hidden md:flex items-center gap-4"
                  >
                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">تم توصيل الطلب</p>
                      <p className="text-xs text-slate-500">تم التحديث آلياً</p>
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
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest">
              اربط متجرك بضغطة زر مع كل أدواتك المفضلة
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
        <section className="py-24 bg-slate-50 dark:bg-slate-950">
          <div className="container px-4 md:px-6 mx-auto max-w-5xl text-center">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer}
              className="space-y-16"
            >
              <div className="space-y-8">
                <motion.h2 variants={fadeInUp} className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
                  هل تعاني من هذه المشاكل يومياً؟
                </motion.h2>
                
                <div className="grid sm:grid-cols-2 gap-4 text-right">
                  {[
                    "أوردرات تائهة بين شيتات الإكسيل وشركات الشحن.",
                    "بضاعة تنفذ فجأة أو أموال مجمدة في بضاعة متكدسة.",
                    "حسابات غير دقيقة وموظفين يتلاعبون بالبيانات.",
                    "شكل غير احترافي لبوالص الشحن يضر بعلامتك التجارية."
                  ].map((problem, idx) => (
                    <motion.div key={idx} variants={fadeInUp} className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30">
                      <XCircle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-slate-700 dark:text-slate-300 font-medium">{problem}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              <motion.div variants={fadeInUp} className="relative p-10 rounded-3xl bg-primary text-white shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                <div className="relative z-10 flex flex-col items-center space-y-4">
                  <div className="p-4 bg-white/20 rounded-2xl backdrop-blur-md mb-2">
                    <ShieldCheck className="h-12 w-12 text-white" />
                  </div>
                  <h3 className="text-3xl md:text-4xl font-extrabold text-white">الحل الجذري</h3>
                  <p className="text-lg md:text-xl text-white/90 max-w-2xl font-medium leading-relaxed">
                    eCommerx ليس مجرد سيستم إدخال بيانات، <br/> إنه مدير عملياتك الآلي!
                  </p>
                </div>
              </motion.div>

            </motion.div>
          </div>
        </section>

        {/* Core Features */}
        <section id="features" className="py-24 bg-white dark:bg-slate-900">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-slate-900 dark:text-white">المميزات الأساسية</h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8">
              {[
                {
                  icon: RefreshCw,
                  title: "ربط آلي لا ينقطع (Auto-Sync)",
                  desc: "انسَ الإدخال اليدوي. النظام يستقبل طلباتك فوراً من (Shopify, WooCommerce, EasyOrders) ويدمجها مع أدوات الأتمتة مثل (vRobo) ليقوم بتحديث حالات الشحن لحظياً مع كل شركات الشحن دون تدخل منك."
                },
                {
                  icon: Box,
                  title: "إدارة المخزون والحسابات بذكاء اصطناعي",
                  desc: "النظام لا يحسب بضاعتك فقط! بل يمتلك خوارزمية تخبرك بالضبط متى يجب إعادة شراء منتج قبل نفاذه، وتكشف لك البضاعة المتكدسة التي تجمد أموالك لتقوم بتسييلها، مع تنظيم دقيق لحساباتك وصافي أرباحك."
                },
                {
                  icon: TrendingUp,
                  title: "تتبع تفصيلي يمنع التلاعب",
                  desc: "تراك (Track) كل أوردر بكل تفاصيله (من لحظة دخوله كطلب جديد حتى تسليمه أو استرجاعه). النظام يسجل كل خطوة باسم الموظف الذي قام بها، مع إمكانية كتابة ملاحظات ومحادثة العميل بضغطة زر."
                },
                {
                  icon: Printer,
                  title: "بوالص شحن احترافية بهويتك",
                  desc: "عزز علامتك التجارية! النظام يتيح لك طباعة بوالص الشحن (Waybills) وعليها اللوجو الخاص بمتجرك، لتبدو أمام عملائك كعلامة تجارية كبرى وليس مجرد صفحة على السوشيال ميديا."
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
                  <h3 className="text-xl font-bold mb-3 text-slate-900 dark:text-white">{feature.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Choose Us & Payment */}
        <section id="why-us" className="py-24 bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="space-y-8"
              >
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-slate-900 dark:text-white">
                  لماذا eCommerx بالذات؟
                </h2>
                
                <div className="space-y-6">
                  {[
                    { title: "متجرك.. ألوانك.. هويتك", desc: "السيستم يتلون حرفياً بألوان متجرك ويحمل شعارك." },
                    { title: "حماية وسرية تامة", desc: "كل موظف يرى فقط ما تسمح له برؤيته. لا تسريب لبيانات العملاء أو أسعار التكلفة." },
                    { title: "نظام حضور وانصراف", desc: "راقب أوقات عمل فريقك من داخل لوحة التحكم." },
                    { title: "سرعة فائقة لا تسقط", desc: "مبني بأحدث تقنيات البرمجة ليتحمل ضغط آلاف الطلبات في ثوانٍ." }
                  ].map((item, idx) => (
                    <div key={idx} className="flex gap-4">
                      <div className="mt-1 h-6 w-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 dark:text-white">{item.title}</h4>
                        <p className="text-slate-600 dark:text-slate-400">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Added Payment Gateways */}
                <div className="pt-8 border-t border-slate-200 dark:border-slate-800">
                  <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                    <CreditCard className="h-5 w-5 text-primary" />
                    سهولة تامة في الدفع
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 mb-6">
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
                <div className="relative rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 shadow-2xl text-white overflow-hidden border border-slate-700">
                  <div className="absolute top-0 right-0 -translate-y-10 translate-x-10 w-40 h-40 bg-primary rounded-full blur-3xl opacity-50"></div>
                  
                  <div className="relative z-10 flex flex-col items-center text-center space-y-6">
                    <div className="inline-flex px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-primary-foreground font-semibold text-sm">
                      🎁 عرض الشركاء الأوائل
                    </div>
                    
                    <h3 className="text-2xl sm:text-3xl font-bold leading-tight">
                      استثمر في نمو متجرك اليوم..<br/>وجربنا على حسابنا!
                    </h3>
                    
                    <p className="text-slate-300">
                      لأننا واثقون أن eCommerx سيغير طريقة إدارتك لعملك بنسبة 180 درجة، نقدم لك:
                    </p>
                    
                    <ul className="text-right space-y-3 w-full max-w-sm">
                      {[
                        "شهر كامل مجاناً لتجربة كل المميزات",
                        "لا نطلب بطاقة ائتمانية (No Credit Card)",
                        "إعداد وتجهيز مجاني (Onboarding)",
                        "دعم فني خطوة بخطوة باللغة العربية"
                      ].map((benefit, idx) => (
                        <li key={idx} className="flex items-center gap-3 bg-white/5 rounded-lg p-3 border border-white/10">
                          <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                          <span className="font-medium">{benefit}</span>
                        </li>
                      ))}
                    </ul>
                    
                    <div className="w-full pt-4">
                      <Button size="lg" className="w-full h-14 text-lg rounded-xl bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/30" asChild>
                        <Link href="/register">أنشئ حسابك الآن واستمتع بالشهر المجاني</Link>
                      </Button>
                      <p className="mt-4 text-sm text-slate-400 flex items-center justify-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                        هذا العرض متاح لفترة محدودة جداً
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-24 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="container px-4 md:px-6 mx-auto max-w-3xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">الأسئلة الشائعة</h2>
            </div>
            
            <div className="space-y-4">
              {[
                {
                  q: "كيف سأدفع بعد انتهاء الشهر المجاني؟",
                  a: "بعد انتهاء تجربتك واقتناعك بالنظام، يمكنك اختيار الباقة التي تناسب حجم مبيعاتك والدفع بوسائل الدفع المحلية المتاحة (انستاباي والمحافظ الإلكترونية)."
                },
                {
                  q: "هل أحتاج مبرمج لربط متجري؟",
                  a: "إطلاقاً! النظام مصمم لتقوم بربط متجرك (شوبيفاي أو غيره) وشركات الشحن بنسخ ولصق كود واحد فقط وفي أقل من دقيقتين، وفريق الدعم سيساعدك في ذلك."
                }
              ].map((faq, idx) => (
                <div key={idx} className="border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950 overflow-hidden">
                  <button 
                    onClick={() => toggleFaq(idx)}
                    className="flex justify-between items-center w-full p-6 text-right font-bold text-lg text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                  >
                    {faq.q}
                    <ChevronDown className={`h-5 w-5 text-slate-500 transition-transform duration-300 ${openFaq === idx ? 'rotate-180' : ''}`} />
                  </button>
                  <motion.div 
                    initial={false}
                    animate={{ height: openFaq === idx ? 'auto' : 0, opacity: openFaq === idx ? 1 : 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-6 pt-0 text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800">
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
            <div className="relative h-10 w-28 grayscale brightness-200 opacity-80 hover:opacity-100 transition-opacity">
              <Image src="/logo.png" alt="eCommerx Logo" fill className="object-contain object-right" />
            </div>
            <p className="text-sm font-medium">
              "صُنع بكل فخر لتمكين تجار التجارة الإلكترونية في الوطن العربي"
            </p>
          </div>
          
          <div className="flex gap-6">
            <Link className="text-sm hover:text-white transition-colors" href="#">الشروط والأحكام</Link>
            <Link className="text-sm hover:text-white transition-colors" href="#">سياسة الخصوصية</Link>
            <Link className="text-sm hover:text-white transition-colors" href="#">تواصل معنا</Link>
          </div>
          
          <p className="text-sm">
            © {new Date().getFullYear()} eCommerx. جميع الحقوق محفوظة.
          </p>
        </div>
      </footer>
    </div>
  );
}
