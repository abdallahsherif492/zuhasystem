/*
 * eCommerx missed-orders capture — pasted into the store's header as:
 *   <script src="https://www.e-commerx.com/leads.js" data-b="BUSINESS_ID" data-k="LEAD_KEY" async></script>
 *
 * When a visitor has typed a valid Egyptian mobile into the order form, this
 * sends what they typed (name, phones, address, governorate, the product page)
 * and how the form was filled (typing, pasting, pointer movement, timings) to
 * /api/leads, where bots are scored. If they then order, the order arrives by
 * webhook and the lead is closed; if not, it shows as a missed order.
 *
 * Fields are recognised by their meaning — name, id, placeholder, label — in
 * Arabic or English, so it does not depend on the theme's markup. Password and
 * card fields are never read.
 *
 * EasyOrders specifics: the governorate is a dropdown component that keeps
 * only an id in a hidden input (name="المحافظة"), so its name is read from
 * the dropdown's displayed value; and the product's code (SKU) is read from
 * the page's data, so the lead can be matched to the catalogue exactly.
 */
(function () {
    "use strict";
    var me = document.currentScript;
    if (!me || window.__ecxLeads) return;
    window.__ecxLeads = true;
    var B = me.getAttribute("data-b"), K = me.getAttribute("data-k");
    if (!B || !K) return;
    var API;
    try { API = new URL(me.src).origin + "/api/leads"; } catch (e) { return; }

    var t0 = Date.now();
    var sig = { v: 1, inputs: 0, pastes: 0, pointer: 0 };
    var phoneStart = null, lastSent = "", timer = null, submitted = false;

    function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
    var sid = store("ecx_sid");
    if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); store("ecx_sid", sid); }

    // Where they came from and what they were looking at, kept across the
    // product page → checkout hop.
    if (!store("ecx_ref")) store("ecx_ref", document.referrer || "-");
    try {
        var q = new URLSearchParams(location.search), utm = {}, any = false;
        ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ttclid"].forEach(function (p) { if (q.get(p)) { utm[p] = q.get(p).slice(0, 200); any = true; } });
        if (any) store("ecx_utm", JSON.stringify(utm));
    } catch (e) {}
    function productTitle() {
        var og = document.querySelector('meta[property="og:title"]');
        var t = (og && og.getAttribute("content")) || document.title || "";
        if (/\/products?\//.test(location.pathname)) store("ecx_product", t);
        return store("ecx_product") || t;
    }
    // The product's code, from the page's own data (Next.js on EasyOrders),
    // kept for the hop to checkout like the title.
    function productSku() {
        try {
            var nd = document.getElementById("__NEXT_DATA__");
            var p = nd && JSON.parse(nd.textContent).props.pageProps.product;
            if (p && p.sku) store("ecx_sku", String(p.sku).slice(0, 60));
        } catch (e) {}
        return store("ecx_sku") || "";
    }
    productSku();

    ["mousemove", "touchstart", "pointerdown", "scroll"].forEach(function (ev) {
        window.addEventListener(ev, function () { if (sig.pointer < 5000) sig.pointer++; }, { passive: true, capture: true });
    });

    function describe(el) {
        var bits = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("autocomplete"), el.getAttribute("data-name")];
        try { if (el.labels) for (var i = 0; i < el.labels.length; i++) bits.push(el.labels[i].textContent); } catch (e) {}
        var p = el.closest && el.closest("label, .form-group, .field, div");
        if (p && p.textContent && p.textContent.length < 80) bits.push(p.textContent);
        return bits.filter(Boolean).join(" ").toLowerCase();
    }
    function kindOf(el) {
        if (!el || !el.tagName || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return null;
        var type = (el.type || "").toLowerCase();
        if (/password|hidden|checkbox|radio|file|submit|button/.test(type)) return null;
        var d = describe(el);
        if (/card|cvv|cvc|password|كلمة السر|البطاق/.test(d)) return null;
        var isPhone = type === "tel" || /phone|mobile|tel\b|هاتف|موبايل|تليفون|تلفون|جوال|رقم/.test(d);
        if (isPhone) return /phone_?2|phone_alt|alt|second|اخر|آخر|بديل|اضافي|إضافي|تاني|ثاني/.test(d) ? "phone2" : "phone";
        if (/gov|governorate|state|province|محافظ|المحافظة/.test(d)) return "governorate";
        // A dropdown is the governorate only if it lists governorates — not a size or colour.
        if (el.tagName === "SELECT") return /القاهرة|الجيزة|cairo|giza/i.test(el.textContent || "") ? "governorate" : null;
        if (/address|street|عنوان|العنوان|شارع/.test(d)) return "address";
        if (/name|اسم|الاسم/.test(d) && !/user|product|منتج/.test(d)) return "name";
        return null;
    }
    function digits(v) {
        var s = String(v || "").replace(/[٠-٩]/g, function (c) { return "٠١٢٣٤٥٦٧٨٩".indexOf(c); });
        s = s.replace(/\D/g, "");
        if (s.indexOf("0020") === 0) s = s.slice(4); else if (s.indexOf("20") === 0 && s.length === 12) s = s.slice(2);
        if (s.length === 10 && s.charAt(0) === "1") s = "0" + s;
        return s;
    }
    function valueOf(el) {
        if (el.tagName === "SELECT") { var o = el.options[el.selectedIndex]; return o ? (o.text || o.value) : ""; }
        return el.value || "";
    }
    // A dropdown component's hidden input holds an id; what the visitor
    // picked is the text the component shows.
    function shownValue(el) {
        for (var n = el.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
            var v = n.querySelector('[class*="single-value"], [class*="singleValue"]');
            if (v && v.textContent) return v.textContent.trim();
        }
        return /^[0-9a-f-]{20,}$/i.test(el.value || "") ? "" : (el.value || "");
    }
    function governorate() {
        var hidden = document.querySelectorAll("input[type=hidden]");
        for (var i = 0; i < hidden.length; i++) {
            if (/gov|governorate|محافظ/i.test((hidden[i].name || "") + " " + (hidden[i].id || ""))) {
                var v = shownValue(hidden[i]);
                if (v) return v.slice(0, 80);
            }
        }
        return "";
    }
    function collect() {
        var out = {}, phones = [], els = document.querySelectorAll("input, select, textarea");
        for (var i = 0; i < els.length; i++) {
            var k = kindOf(els[i]); if (!k) continue;
            var v = String(valueOf(els[i])).trim(); if (!v) continue;
            // Phones by what they hold: a field labelled "رقم" may be a building
            // number. The first real mobile is the phone, the next the second.
            if (k === "phone" || k === "phone2") { var dg = digits(v); if (/^01\d{9}$/.test(dg) && phones.indexOf(dg) < 0) phones.push(dg); continue; }
            if (!out[k]) out[k] = v.slice(0, 400);
        }
        out.phone = phones[0] || ""; out.phone2 = phones[1] || "";
        if (!out.governorate) out.governorate = governorate();
        return out;
    }

    function send(beacon) {
        var f = collect(), phone = digits(f.phone);
        if (!/^01\d{9}$/.test(phone)) return;
        if (sig.dwellMs === undefined) {
            sig.dwellMs = Date.now() - t0;
            if (phoneStart) sig.fillMs = Date.now() - phoneStart;
        }
        sig.webdriver = !!navigator.webdriver;
        sig.screen = [screen.width || 0, screen.height || 0];
        try { sig.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
        sig.lang = navigator.language;
        var payload = {
            b: B, k: K, sid: sid, phone: phone, name: f.name || "", phone2: f.phone2 || "", address: f.address || "",
            governorate: f.governorate || "", product: productTitle().slice(0, 200), sku: productSku(), url: location.href.slice(0, 500),
            ref: (store("ecx_ref") || "").slice(0, 500), utm: (function () { try { return JSON.parse(store("ecx_utm") || "null"); } catch (e) { return null; } })(),
            submitted: submitted, s: sig
        };
        var key = [phone, f.name, f.phone2, f.address, f.governorate, submitted].join("|");
        if (key === lastSent && !beacon) return;
        lastSent = key;
        var body = JSON.stringify(payload);
        try {
            if (beacon && navigator.sendBeacon && navigator.sendBeacon(API, body)) return;
            fetch(API, { method: "POST", body: body, keepalive: true, mode: "cors", headers: { "Content-Type": "text/plain" } }).catch(function () {});
        } catch (e) {}
    }
    function later(ms) { clearTimeout(timer); timer = setTimeout(function () { send(false); }, ms); }

    document.addEventListener("input", function (e) {
        var k = kindOf(e.target); if (!k) return;
        sig.inputs++;
        if (k === "phone" && phoneStart === null && String(e.target.value || "").length <= 2) phoneStart = Date.now();
        later(k === "phone" ? 1500 : 3000);
    }, true);
    document.addEventListener("change", function (e) { if (kindOf(e.target)) later(1500); }, true);
    document.addEventListener("paste", function (e) { if (kindOf(e.target)) sig.pastes++; }, true);

    // Pressing the order button: very likely an order, which the webhook confirms.
    function markSubmit() { submitted = true; send(true); }
    document.addEventListener("submit", markSubmit, true);
    document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest && e.target.closest("button, [type=submit], a");
        if (b && /اطلب|اشتري|إشتري|تأكيد|أكد|اكد|شراء|order|buy|checkout|submit/i.test(b.textContent || b.value || "")) markSubmit();
        // Picking from a dropdown component (the governorate) changes no field
        // the input listener sees.
        else if (e.target && e.target.closest && e.target.closest('[class*="option"], [class*="select__"]')) later(3000);
    }, true);
    window.addEventListener("pagehide", function () { send(true); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") send(true); });
})();
