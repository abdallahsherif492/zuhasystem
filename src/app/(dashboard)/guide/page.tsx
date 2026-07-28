"use client";

import React, { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LayoutDashboard,
  Calculator,
  Package,
  ShoppingCart,
  Truck,
  Link as LinkIcon,
  Activity,
  MonitorSmartphone,
  Users,
  Clock,
  AlertTriangle,
  TrendingUp,
  History,
  Search,
  ChevronDown,
  ChevronUp,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionProps {
  id: string;
  titleEn: string;
  titleAr: string;
  icon: React.ElementType;
  content: (lang: "en" | "ar") => React.ReactNode;
}

const sections: SectionProps[] = [
  {
    id: "dashboard",
    titleEn: "Dashboard",
    titleAr: "لوحة التحكم",
    icon: LayoutDashboard,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>لوحة التحكم هي واجهتك الرئيسية لمتابعة أداء عملك بشكل سريع ومبسط.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>فلتر التاريخ:</strong> يسمح لك بعرض البيانات لفترة زمنية محددة.</li>
            <li><strong>إجمالي الأوردرات:</strong> عدد الطلبات الإجمالية في الفترة المحددة.</li>
            <li><strong>الأوردرات المؤكدة:</strong> الطلبات التي تم تأكيدها وجاهزة للعمل.</li>
            <li><strong>الأوردرات المنتظرة:</strong> الطلبات قيد الانتظار أو المراجعة.</li>
            <li><strong>قيمة المخزون:</strong> إجمالي قيمة المنتجات المتاحة في مخزنك بناءً على سعر التكلفة.</li>
            <li><strong>البحث السريع:</strong> للبحث عن أي طلب، منتج أو عميل بسرعة.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>The dashboard is your main interface for quickly tracking your business performance.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Date Filter:</strong> Allows you to view data for a specific time period.</li>
            <li><strong>Total Orders:</strong> The total number of orders in the selected period.</li>
            <li><strong>Confirmed Orders:</strong> Orders that have been confirmed and are ready to be processed.</li>
            <li><strong>Pending Orders:</strong> Orders pending review or confirmation.</li>
            <li><strong>Inventory Value:</strong> The total value of products available in your warehouse based on cost price.</li>
            <li><strong>Quick Search:</strong> To quickly search for any order, product, or customer.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "accounting",
    titleEn: "Accounting",
    titleAr: "الحسابات",
    icon: Calculator,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>قسم الحسابات يمكنك من إدارة التدفقات النقدية والخزن الخاصة بك.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>إضافة Treasury:</strong> إضافة خزنة أو حساب بنكي (مثل CIB، فودافون كاش، خزنة المكتب).</li>
            <li><strong>Revenue (الإيرادات):</strong> تسجيل التحصيلات، مبالغ الديبوزيت، وأي أموال تدخل الخزنة.</li>
            <li><strong>Expenses (المصروفات):</strong> تسجيل التكاليف التشغيلية، الإعلانات، وغيرها من المصروفات.</li>
            <li><strong>التحويل بين الخزن:</strong> نقل الأموال من خزنة إلى أخرى (مثل إيداع كاش من خزنة المكتب إلى الحساب البنكي).</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>The Accounting section enables you to manage your cash flows and treasuries.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Add Treasury:</strong> Add a cash safe or bank account (e.g., CIB, Vodafone Cash, Office Safe).</li>
            <li><strong>Revenue:</strong> Record collections, deposits, and any incoming money to the treasury.</li>
            <li><strong>Expenses:</strong> Record operational costs, advertising, and other expenses.</li>
            <li><strong>Treasury Transfers:</strong> Transfer money from one treasury to another (e.g., cash deposit from the office safe to the bank account).</li>
          </ul>
        </div>
      ),
  },
  {
    id: "products",
    titleEn: "Products",
    titleAr: "المنتجات",
    icon: Package,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>إدارة المنتجات المخزنية وإعدادات البيع.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>إضافة منتج:</strong> إدخال الاسم، الوصف، السعر، والتكلفة. <em>التكلفة مهمة جداً لحساب الأرباح بدقة.</em></li>
            <li><strong>الأنواع (Variants):</strong> إضافة خيارات مثل اللون والمقاس للمنتج الواحد.</li>
            <li><strong>Open Product:</strong> منتج مفتوح لا يتتبع المخزون، يمكن بيعه بأي كمية.</li>
            <li><strong>Track Stock:</strong> تفعيل تتبع المخزون ليتم خصم الكميات عند الشحن وإرجاعها عند المرتجع.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Manage your warehouse products and sales settings.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Add Product:</strong> Enter the name, description, price, and cost. <em>The cost is crucial for calculating profits accurately.</em></li>
            <li><strong>Variants:</strong> Add options like color and size to a single product.</li>
            <li><strong>Open Product:</strong> An open product that does not track inventory; can be sold in any quantity.</li>
            <li><strong>Track Stock:</strong> Enable inventory tracking to deduct quantities upon shipping and return them upon returns.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "orders",
    titleEn: "Orders",
    titleAr: "الأوردرات",
    icon: ShoppingCart,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>إنشاء ومتابعة الأوردرات اليدوية والخاصة بالمنصات.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>إنشاء أوردر:</strong> تحديد نوع الأوردر، اختيار/إضافة العميل، اختيار المنتجات، تعديل السعر، إضافة سعر الشحن، حالة الدفع، والقناة (Channel).</li>
            <li><strong>الديبوزيت:</strong> عند اختيار دفع مسبق (عربون)، يجب اختيار Treasury لدخول المبلغ فيها مباشرة.</li>
            <li><strong>الفلاتر والبحث:</strong> سهولة الوصول لأي أوردر برقم الهاتف أو الاسم أو رقم الأوردر.</li>
            <li><strong>الطباعة والإكسيل:</strong> طباعة بوليصة الشحن للأوردرات، وتصدير البيانات في شيت إكسيل (Export Excel).</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Create and track manual and platform orders.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Create Order:</strong> Select order type, choose/add customer, pick products, edit price, add shipping cost, payment status, and channel.</li>
            <li><strong>Deposit:</strong> When choosing a pre-payment (deposit), you must select a Treasury for the amount to enter directly.</li>
            <li><strong>Filters and Search:</strong> Easy access to any order by phone number, name, or order number.</li>
            <li><strong>Print and Excel:</strong> Print shipping labels for orders, and export data to an Excel sheet.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "shipping",
    titleEn: "Shipping",
    titleAr: "الشحن",
    icon: Truck,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>إدارة شركات الشحن اليدوية والأسعار.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>إضافة شركة شحن:</strong> إضافة الشركات التي تتعامل معها بشكل مباشر.</li>
            <li><strong>التسعير:</strong> تحديد سعر الشحن لكل محافظة بناءً على تسعيرة الشركة.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Manage manual shipping companies and prices.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Add Shipping Company:</strong> Add companies you deal with directly.</li>
            <li><strong>Pricing:</strong> Set the shipping cost for each governorate based on the company's pricing.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "integrations",
    titleEn: "Integrations",
    titleAr: "الربط (Integrations)",
    icon: LinkIcon,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>ربط النظام بالمنصات وشركات الشحن لأتمتة العمليات.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>شركات الشحن:</strong> ربط مع Bosta, J&T, Aramex, Telegraph, Fil-Tareeq لسحب البوالص وتحديث الحالات تلقائياً.</li>
            <li><strong>منصات البيع:</strong> ربط مع EasyOrders و Shopify لاستيراد الطلبات.</li>
            <li><strong>مطابقة SKU:</strong> تأكد من أن الـ SKU في المنصة يطابق الـ SKU في النظام لربط المنتجات وسحب المخزون بشكل صحيح.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Connect the system with platforms and shipping companies to automate operations.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Shipping Companies:</strong> Integrate with Bosta, J&T, Aramex, Telegraph, Fil-Tareeq to pull labels and update statuses automatically.</li>
            <li><strong>Sales Platforms:</strong> Connect with EasyOrders and Shopify to import orders.</li>
            <li><strong>SKU Matching:</strong> Ensure the SKU on the platform matches the SKU in the system to link products and deduct inventory correctly.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "logistics",
    titleEn: "Logistics",
    titleAr: "العمليات (Logistics)",
    icon: Activity,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>متابعة دورة حياة الأوردر داخل وخارج المخزن.</p>
          <div className="grid gap-2">
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">Pending</Badge> أوردر مؤكد لكن لم يتم العمل عليه بعد (يدوي)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">Processing</Badge> أوردر مطبوع وجاهز للتحضير (يدوي)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">Prepared</Badge> تم تحضيره وجاهز للشحن (يدوي + يخصم من الستوك)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-indigo-100 text-indigo-800 border-indigo-200">Shipped</Badge> مشحون مع شركة الشحن (يدوي + يخصم من الستوك + يجب اختيار شركة الشحن)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Delivered</Badge> تم التوصيل (تلقائي)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Collected</Badge> تم التحصيل وتسوية الحساب (يدوي)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200">Hold To Redeliver</Badge> تأجيل أو عدم رد العميل (تلقائي)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">Returning</Badge> قيد الإرجاع من شركة الشحن (تلقائي)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-stone-100 text-stone-800 border-stone-200">Returned</Badge> تم الإرجاع إلى المخزن واسترداد الستوك (يدوي)</div>
          </div>
          <div className="bg-slate-50 p-3 rounded-md mt-4 text-sm border border-slate-200 flex gap-2 items-start">
            <Info className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
            <p><strong>Bulk Actions:</strong> يمكنك تحديد عدة أوردرات وتغيير حالتها دفعة واحدة لتسريع العمل.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Track the lifecycle of an order inside and outside the warehouse.</p>
          <div className="grid gap-2">
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">Pending</Badge> Confirmed order not yet worked on (Manual)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">Processing</Badge> Order printed and ready for picking (Manual)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">Prepared</Badge> Picked and ready for shipping (Manual + Deducts Stock)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-indigo-100 text-indigo-800 border-indigo-200">Shipped</Badge> Shipped with courier (Manual + Deducts Stock + Must select courier)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Delivered</Badge> Delivered to customer (Automatic)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Collected</Badge> Collected and accounted for (Manual)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200">Hold To Redeliver</Badge> Postponed or no answer (Automatic)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">Returning</Badge> Returning from courier (Automatic)</div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="bg-stone-100 text-stone-800 border-stone-200">Returned</Badge> Returned to warehouse, stock restored (Manual)</div>
          </div>
          <div className="bg-slate-50 p-3 rounded-md mt-4 text-sm border border-slate-200 flex gap-2 items-start">
            <Info className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
            <p><strong>Bulk Actions:</strong> You can select multiple orders and change their status at once to speed up the workflow.</p>
          </div>
        </div>
      ),
  },
  {
    id: "platform-orders",
    titleEn: "Platform Orders",
    titleAr: "أوردرات المنصات",
    icon: MonitorSmartphone,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>إدارة الطلبات الواردة من منصات البيع المربوطة (مثل Shopify، EasyOrders).</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>التأكيد:</strong> الطلبات لا تذهب للمخزن إلا بعد مراجعتها وتأكيدها.</li>
            <li><strong>Move to Pending:</strong> نقل الطلبات إلى حالة Pending لتبدأ دورة العمل الخاصة بها.</li>
            <li><strong>الملاحظات (Notes):</strong> قراءة ملاحظات العميل الواردة من المنصة.</li>
            <li><strong>تعديل المدفوع:</strong> إذا كان العميل قد دفع جزءاً أو كل المبلغ (أونلاين)، يمكن تسجيل ذلك كمدفوع وتحديد الخزنة.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Manage orders arriving from connected sales platforms (e.g., Shopify, EasyOrders).</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Confirmation:</strong> Orders do not go to the warehouse until reviewed and confirmed.</li>
            <li><strong>Move to Pending:</strong> Move orders to Pending status to start their workflow.</li>
            <li><strong>Notes:</strong> Read customer notes coming from the platform.</li>
            <li><strong>Edit Paid Amount:</strong> If the customer paid part or all of the amount (online), record it as paid and select the treasury.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "team",
    titleEn: "Team",
    titleAr: "فريق العمل",
    icon: Users,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>إدارة أعضاء فريقك وصلاحياتهم.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>إضافة موظفين:</strong> إضافة حسابات لأفراد الفريق.</li>
            <li><strong>الصلاحيات المحدودة:</strong> تحديد الشاشات والوظائف التي يمكن لكل موظف رؤيتها والعمل عليها (مثل: موظف خدمة عملاء لا يرى الحسابات).</li>
            <li><strong>الشيفتات والإجازات:</strong> تحديد مواعيد العمل والإجازات الخاصة بكل موظف.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Manage your team members and their permissions.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Add Employees:</strong> Add accounts for team members.</li>
            <li><strong>Limited Permissions:</strong> Specify which screens and functions each employee can access (e.g., customer service rep cannot see accounting).</li>
            <li><strong>Shifts and Leaves:</strong> Set working hours and vacations for each employee.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "my-hr",
    titleEn: "My HR",
    titleAr: "شئون الموظفين (My HR)",
    icon: Clock,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>القسم الخاص بكل موظف لتسجيل الحضور والانصراف.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Clock In:</strong> تسجيل بدء يوم العمل.</li>
            <li><strong>Clock Out:</strong> تسجيل انتهاء يوم العمل.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>The section for each employee to log attendance.</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>Clock In:</strong> Record the start of the workday.</li>
            <li><strong>Clock Out:</strong> Record the end of the workday.</li>
          </ul>
        </div>
      ),
  },
  {
    id: "damages",
    titleEn: "Damages",
    titleAr: "التلفيات (Damages)",
    icon: AlertTriangle,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>تسجيل وإدارة المنتجات التالفة أو المفقودة.</p>
          <p>عند تسجيل تلف، يتم خصمه من المخزن وتوثيق سبب التلف لحساب الخسائر لاحقاً.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Record and manage damaged or lost products.</p>
          <p>When recording a damage, it is deducted from the inventory and the reason is documented for later loss calculation.</p>
        </div>
      ),
  },
  {
    id: "actual-returns",
    titleEn: "Actual Returns",
    titleAr: "الأرباح الصافية (Actual Returns)",
    icon: TrendingUp,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>تقارير الأداء المالي الحقيقي للبيزنس.</p>
          <p>يعتمد حساب <strong>صافي الربح</strong> على المعادلة التالية:</p>
          <div className="bg-slate-100 p-3 rounded text-center font-bold text-slate-800">
            الأوردرات التي تم تحصيلها (Collected) - المصاريف الفعلية والتكاليف
          </div>
          <p className="text-sm text-slate-500">يتطلب هذا التقرير إدخال تكلفة المنتجات بدقة والمصروفات في قسم الحسابات.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p>Reports on the true financial performance of the business.</p>
          <p>The <strong>Net Profit</strong> calculation relies on the following formula:</p>
          <div className="bg-slate-100 p-3 rounded text-center font-bold text-slate-800">
            Collected Orders - Actual Expenses and Costs
          </div>
          <p className="text-sm text-slate-500">This report requires accurate entry of product costs and expenses in the Accounting section.</p>
        </div>
      ),
  },
  {
    id: "actions-log",
    titleEn: "Actions Log",
    titleAr: "سجل العمليات (Actions Log)",
    icon: History,
    content: (lang) =>
      lang === "ar" ? (
        <div className="space-y-4">
          <p>مراجعة كاملة لكل الإجراءات التي تمت على النظام.</p>
          <ul className="list-disc list-inside space-y-2">
            <li>من قام بإنشاء أوردر؟ متى؟</li>
            <li>من قام بتعديل حالة الأوردر؟</li>
            <li>من قام بإضافة مصروفات؟</li>
            <li>وسيلة ممتازة للتدقيق (Auditing) وحل المشكلات.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <p>A comprehensive review of all actions performed on the system.</p>
          <ul className="list-disc list-inside space-y-2">
            <li>Who created an order? When?</li>
            <li>Who changed an order status?</li>
            <li>Who added an expense?</li>
            <li>An excellent tool for auditing and troubleshooting.</li>
          </ul>
        </div>
      ),
  },
];

export default function GuidePage() {
  const { language, direction } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    sections.reduce((acc, section) => ({ ...acc, [section.id]: true }), {})
  );

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const filteredSections = sections.filter((section) => {
    const query = searchQuery.toLowerCase();
    return (
      section.titleEn.toLowerCase().includes(query) ||
      section.titleAr.toLowerCase().includes(query)
    );
  });

  const pageTitle = language === "ar" ? "دليل استخدام النظام" : "System Guide";
  const searchPlaceholder =
    language === "ar" ? "ابحث في الدليل..." : "Search guide...";
  const noResults =
    language === "ar" ? "لا توجد نتائج مطابقة لبحثك." : "No matching results found.";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 space-y-4">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          {pageTitle}
        </h1>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Table of Contents - Sticky Sidebar */}
        <div className="lg:w-1/4 w-full lg:sticky lg:top-24 space-y-2 order-last lg:order-first">
          <Card className="border-indigo-100 bg-slate-50 dark:bg-slate-900/50 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-slate-800 dark:text-slate-200">
                {language === "ar" ? "المحتويات" : "Table of Contents"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {filteredSections.map((section) => (
                <button
                  key={`toc-${section.id}`}
                  onClick={() => {
                    const el = document.getElementById(section.id);
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                      setExpandedSections((prev) => ({ ...prev, [section.id]: true }));
                    }
                  }}
                  className={cn(
                    "w-full text-start px-3 py-2 text-sm rounded-md transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/50 hover:text-indigo-700 dark:hover:text-indigo-300",
                    direction === "rtl" ? "text-right" : "text-left"
                  )}
                >
                  {language === "ar" ? section.titleAr : section.titleEn}
                </button>
              ))}
              {filteredSections.length === 0 && (
                <p className="text-sm text-slate-500 px-3 py-2">{noResults}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Content Area */}
        <div className="lg:w-3/4 w-full space-y-6">
          {filteredSections.map((section) => {
            const Icon = section.icon;
            const isExpanded = expandedSections[section.id];
            
            return (
              <Card
                key={section.id}
                id={section.id}
                className="scroll-mt-24 border-slate-200 shadow-sm transition-all hover:shadow-md"
              >
                <div
                  className="flex items-center justify-between p-6 cursor-pointer select-none"
                  onClick={() => toggleSection(section.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {language === "ar" ? section.titleAr : section.titleEn}
                    </h2>
                  </div>
                  <Button variant="ghost" size="icon" className="text-slate-500 hover:text-indigo-600">
                    {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </Button>
                </div>
                
                {isExpanded && (
                  <div className="px-6 pb-6 pt-0 animate-in fade-in slide-in-from-top-4">
                    <div className="text-slate-700 dark:text-slate-300 text-base leading-relaxed">
                      {section.content(language)}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}

          {filteredSections.length === 0 && (
            <div className="text-center py-12">
              <Search className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                {noResults}
              </h3>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
