/**
 * Walkthrough steps for eCommerx — Arabic Only
 * Each page has its own set of steps that driver.js will use.
 * Steps reference DOM element IDs that we'll add to each page.
 */

export interface WalkthroughStep {
  element?: string; // CSS selector
  popover: {
    title: string;
    description: string;
    side?: "top" | "bottom" | "left" | "right";
    align?: "start" | "center" | "end";
  };
}

export interface PageWalkthrough {
  pageId: string;
  route: string;
  title: string;
  steps: WalkthroughStep[];
}

export const walkthroughPages: PageWalkthrough[] = [
  // ===== 1. DASHBOARD =====
  {
    pageId: "dashboard",
    route: "/dashboard",
    title: "لوحة التحكم",
    steps: [
      {
        popover: {
          title: "🎉 مرحباً بك في eCommerx!",
          description: "هنشرحلك النظام خطوة بخطوة عشان تقدر تستخدمه باحترافية. جاهز؟ يلا بينا! 🚀",
        },
      },
      {
        element: "#date-range-picker",
        popover: {
          title: "📅 فلتر التاريخ",
          description: "من هنا تقدر تحدد الفترة الزمنية اللي عايز تشوف فيها الإحصائيات. ممكن تختار يوم واحد أو فترة كاملة.",
          side: "bottom",
        },
      },
      {
        element: "#kpi-total-sales",
        popover: {
          title: "💰 إجمالي المبيعات والأوردرات",
          description: "هنا بيظهر إجمالي قيمة المبيعات وعدد الأوردرات في الفترة اللي اختارتها. ومعاه نسبة التغيير مقارنة بالفترة اللي قبلها.",
          side: "bottom",
        },
      },
      {
        element: "#kpi-confirmed",
        popover: {
          title: "✅ الأوردرات المؤكدة",
          description: "دي الأوردرات كلها ماعدا اللي حالتها 'قيد الانتظار' (Waiting) أو 'ملغية' (Cancelled). يعني كل أوردر تم تأكيده وبدأنا نشتغل عليه.",
          side: "bottom",
        },
      },
      {
        element: "#kpi-waiting",
        popover: {
          title: "⏳ أوردرات المنصات (Waiting)",
          description: "دي الأوردرات اللي تم استيرادها تلقائياً من منصات البيع زي EasyOrders أو Shopify. لسه محتاجة تأكيد منك قبل ما تتحول لأوردرات فعلية.",
          side: "bottom",
        },
      },
      {
        element: "#kpi-stock-value",
        popover: {
          title: "📦 قيمة المخزون",
          description: "إجمالي قيمة المخزون الحالي بناءً على تكلفة المنتجات المتاحة في المخازن.",
          side: "bottom",
        },
      },
    ],
  },

  // ===== 2. ACCOUNTING =====
  {
    pageId: "accounting",
    route: "/accounting",
    title: "الحسابات",
    steps: [
      {
        popover: {
          title: "🏦 صفحة الحسابات",
          description: "هنا بتدير كل الأمور المالية بتاعة البيزنيس بتاعك. أول حاجة لازم تعملها هي إضافة خزنة (Treasury).",
        },
      },
      {
        element: "#add-treasury-btn",
        popover: {
          title: "➕ إضافة خزنة (Treasury)",
          description: "دوس هنا عشان تضيف خزنة جديدة. الخزنة دي بتمثل المكان اللي بتشيل فيه الفلوس — زي حساب بنك CIB أو خزنة الشركة أو محفظة إلكترونية.",
          side: "bottom",
        },
      },
      {
        element: "#treasury-list",
        popover: {
          title: "💼 الخزن بتاعتك",
          description: "هنا بتظهر كل الخزن اللي ضفتها مع الرصيد الحالي لكل واحدة.",
          side: "bottom",
        },
      },
      {
        element: "#add-transaction-btn",
        popover: {
          title: "📝 إضافة معاملة",
          description: "من هنا تقدر تسجل معاملة جديدة. فيه أنواع مختلفة:\n\n• Revenue (إيراد): التحصيلات والديبوزيتات اللي بتدخل\n• Expense (مصروف): أي تكلفة بتدفعها في البيزنيس\n• Transfer (تحويل): نقل فلوس من خزنة لخزنة تانية",
          side: "bottom",
        },
      },
    ],
  },

  // ===== 3. PRODUCTS =====
  {
    pageId: "products",
    route: "/products",
    title: "المنتجات",
    steps: [
      {
        popover: {
          title: "🛍️ صفحة المنتجات",
          description: "هنا بتضيف وتدير كل المنتجات بتاعة الستور بتاعك.",
        },
      },
      {
        element: "#add-product-btn",
        popover: {
          title: "➕ إضافة منتج جديد",
          description: "دوس هنا عشان تضيف منتج جديد. هتحتاج تكتب:\n\n• اسم المنتج\n• الوصف\n• السعر (سعر البيع للعميل)\n• التكلفة (التكلفة عليك — مهمة جداً لحساب الأرباح!)",
          side: "bottom",
        },
      },
      {
        element: "#products-table",
        popover: {
          title: "📋 قائمة المنتجات",
          description: "هنا بتظهر كل المنتجات مع تفاصيلها. تقدر تضغط على أي منتج عشان تعدل عليه أو تضيف Variants (مقاسات/ألوان).\n\n⚠️ ملاحظة مهمة:\n• Open Product: منتج مفتوح مش بيتتبع في المخزون (زي خدمة)\n• Track Stock: منتج بيتتبع في المخزون وبيتخصم منه تلقائياً",
          side: "top",
        },
      },
    ],
  },

  // ===== 4. ORDERS (CREATE) =====
  {
    pageId: "orders",
    route: "/orders",
    title: "الأوردرات",
    steps: [
      {
        popover: {
          title: "🛒 صفحة الأوردرات",
          description: "هنا بتشوف كل الأوردرات وتقدر تعمل أوردر جديد.",
        },
      },
      {
        element: "#create-order-btn",
        popover: {
          title: "➕ إنشاء أوردر جديد",
          description: "دوس هنا عشان تعمل أوردر جديد. هتحتاج:\n\n1. تختار نوع الأوردر (New Order أو Replacement)\n2. تختار عميل موجود أو تضيف عميل جديد\n3. تختار المنتج والكمية\n4. تقدر تعدل السعر وسعر الشحن\n5. تحدد حالة الدفع (Payment Status)\n6. تحدد مصدر الأوردر (Channel)\n7. تختار الخزنة اللي هيتبعت عليها الديبوزت\n\n⚠️ لازم تكون ضايف خزنة الأول من صفحة الحسابات!",
          side: "bottom",
        },
      },
      {
        element: "#orders-filters",
        popover: {
          title: "🔍 الفلاتر والبحث",
          description: "من هنا تقدر تفلتر الأوردرات حسب الحالة أو التاريخ أو شركة الشحن. وتقدر تبحث بالاسم أو رقم الأوردر أو رقم التليفون.",
          side: "bottom",
        },
      },
      {
        element: "#orders-table",
        popover: {
          title: "📋 جدول الأوردرات",
          description: "الأوردر اللي بتعمله يدوي بيكون حالته Pending — يعني متأكد بس لسه مبدأناش شغل عليه.\n\nتقدر تعمل Select لأوردر أو أكتر وبعدين:\n• 🖨️ Print Selected: طباعة بوليصة الشحن\n• 📊 Export Selected: تنزيل شيت Excel",
          side: "top",
        },
      },
    ],
  },

  // ===== 5. SHIPPING =====
  {
    pageId: "shipping",
    route: "/shipping",
    title: "الشحن",
    steps: [
      {
        popover: {
          title: "🚚 صفحة الشحن",
          description: "هنا بتضيف شركات الشحن اللي بتتعامل معاها وبتحدد تسعيرة كل محافظة.",
        },
      },
      {
        element: "#add-shipping-company-btn",
        popover: {
          title: "➕ إضافة شركة شحن",
          description: "دوس هنا عشان تضيف شركة الشحن اللي بتشحن معاها. هتكتب اسمها وبعدين تحدد تكلفة الشحن لكل محافظة.",
          side: "bottom",
        },
      },
    ],
  },

  // ===== 6. SETTINGS (INTEGRATIONS) =====
  {
    pageId: "settings",
    route: "/settings",
    title: "الإعدادات",
    steps: [
      {
        popover: {
          title: "⚙️ صفحة الإعدادات",
          description: "هنا بتظبط إعدادات البيزنيس بتاعك وتربط الخدمات الخارجية.",
        },
      },
      {
        element: "#integrations-tab",
        popover: {
          title: "🔗 تبويب الربط (Integrations)",
          description: "من هنا تقدر تربط شركات الشحن (Bosta, Aramex, J&T, وغيرهم) عشان حالة الأوردرات تتحدث تلقائياً.\n\n⚠️ مهم: لازم ترفع الأوردرات عند شركة الشحن بنفس رقم الأوردر اللي على السيستم.\n\nكمان تقدر تربط منصات البيع (EasyOrders, Shopify) عشان تستقبل الأوردرات أوتوماتيك.\n\n⚠️ لازم الـ SKU لكل Variant يكون مطابق للسيستم.",
          side: "bottom",
        },
      },
    ],
  },

  // ===== 7. LOGISTICS =====
  {
    pageId: "logistics",
    route: "/logistics",
    title: "اللوجيستيات",
    steps: [
      {
        popover: {
          title: "📦 صفحة اللوجيستيات",
          description: "هنا بتتابع حالة كل الأوردرات وبتحولهم بين الحالات المختلفة.",
        },
      },
      {
        element: "#logistics-filters",
        popover: {
          title: "🔍 فلاتر التاريخ والحالة",
          description: "فلتر الأوردرات حسب التاريخ وحالة الشحن عشان تلاقي اللي محتاجه بسرعة.",
          side: "bottom",
        },
      },
      {
        element: "#logistics-table",
        popover: {
          title: "📋 حالات الشحن",
          description: "كل أوردر بيمر بالحالات دي:\n\n🟡 Pending: مؤكد لكن لم يتم العمل عليه (يدوي)\n🔵 Processing: مطبوع وجاهز للتحضير (يدوي)\n🟣 Prepared: تم تحضيره وجاهز للشحن (يدوي + يخصم من الستوك)\n🚚 Shipped: مشحون (يدوي + يخصم من الستوك + لازم تختار شركة الشحن)\n✅ Delivered: تم التوصيل (تلقائي)\n💰 Collected: تم التحصيل (يدوي)\n⏸️ Hold To Redeliver: تأجيل أو عدم رد العميل (تلقائي)\n🔄 Returning: قيد الإرجاع (تلقائي)\n📥 Returned: تم الإرجاع للمخزن (يدوي)",
          side: "top",
        },
      },
      {
        element: "#bulk-actions-btn",
        popover: {
          title: "⚡ الإجراءات الجماعية (Bulk Actions)",
          description: "عايز تغير حالة أوردرات كتير مرة واحدة؟ اعمل Select للأوردرات ودوس Bulk Action وغير حالتهم كلهم زي ما انت عايز!",
          side: "bottom",
        },
      },
    ],
  },

  // ===== 8. PLATFORM ORDERS =====
  {
    pageId: "platform-orders",
    route: "/platform-orders",
    title: "أوردرات المنصات",
    steps: [
      {
        popover: {
          title: "🌐 أوردرات المنصات",
          description: "هنا بتظهر الأوردرات اللي جاية أوتوماتيك من منصات البيع (EasyOrders, Shopify). حالتها بتكون Waiting يعني لسه متأكدتش.",
        },
      },
      {
        element: "#platform-orders-table",
        popover: {
          title: "📋 مراجعة وتأكيد",
          description: "لازم تراجع بيانات كل أوردر والمنتجات اللي فيه صح ولا لا، وبعدين تعملها Move to Pending عشان تتأكد.\n\nتقدر كمان:\n• تحط ملاحظة (Notes) على الأوردر\n• تحدد قيمة المدفوع\n• تعدل الأوردر وتضيف عليه",
          side: "top",
        },
      },
    ],
  },

  // ===== 9. TEAM =====
  {
    pageId: "team",
    route: "/team",
    title: "الفريق",
    steps: [
      {
        element: "#add-team-member-btn",
        popover: {
          title: "👥 إدارة الفريق",
          description: "من هنا تقدر تضيف موظفين جداد بصلاحيات محدودة لصفحات معينة. وتقدر تحدد شيفتاتهم وإجازاتهم. هما يقدروا يعملوا Clock In من صفحة My HR.",
          side: "bottom",
        },
      },
    ],
  },

  // ===== 10. MY HR =====
  {
    pageId: "my-hr",
    route: "/my-hr",
    title: "الموارد البشرية",
    steps: [
      {
        popover: {
          title: "⏰ تسجيل الحضور",
          description: "من هنا تقدر تعمل Clock In لتسجيل حضورك، و Clock Out لتسجيل انصرافك.",
        },
      },
    ],
  },

  // ===== 11. DAMAGES =====
  {
    pageId: "damages",
    route: "/inventory/damages",
    title: "التلفيات",
    steps: [
      {
        popover: {
          title: "⚠️ تسجيل التلفيات",
          description: "من هنا تقدر تسجل أي منتجات تالفة أو مفقودة. ده بيساعدك تتابع الخسائر وبيأثر على حسابات المخزون.",
        },
      },
    ],
  },

  // ===== 12. ACTUAL RETURNS =====
  {
    pageId: "actual-returns",
    route: "/insights/actual-returns",
    title: "صافي الأرباح",
    steps: [
      {
        popover: {
          title: "💵 صافي الأرباح (Actual Returns)",
          description: "هنا بتعرف صافي ربحك الفعلي في فترة معينة.\n\nبيتحسب كالآتي:\n📥 الأوردرات اللي حالتها Collected (المحصلة)\n➖ المصاريف الفعلية اللي سجلتها\n= 💰 صافي الربح",
        },
      },
    ],
  },

  // ===== 13. ACTIONS LOG =====
  {
    pageId: "actions-log",
    route: "/actions-log",
    title: "سجل الأنشطة",
    steps: [
      {
        popover: {
          title: "📜 سجل الأنشطة (Actions Log)",
          description: "هنا تقدر تشوف كل الأكشنز اللي اتعملت على السيستم ومين عملها. زي إنشاء أوردر، تعديل منتج، تغيير حالة شحنة، وغيرها.",
        },
      },
    ],
  },
];

/** Get walkthrough steps for a specific page */
export function getPageSteps(pageId: string): WalkthroughStep[] {
  const page = walkthroughPages.find(p => p.pageId === pageId);
  return page?.steps || [];
}

/** Get the full sequential tour (all pages in order) */
export function getFullTourPages(): PageWalkthrough[] {
  return walkthroughPages;
}
