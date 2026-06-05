const fs = require('fs');
const file = 'src/app/(dashboard)/dashboard/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Inject activeBusiness
if (!content.includes('const { activeBusiness } = useBusiness();')) {
    content = content.replace('function DashboardContent() {', 'function DashboardContent() {\n  const { activeBusiness } = useBusiness();');
}

// Ensure early return
if (!content.includes('if (!activeBusiness) return;')) {
    content = content.replace('async function fetchDashboardData() {', 'async function fetchDashboardData() {\n    if (!activeBusiness) return;');
}

// Add p_business_id to RPC calls
content = content.replace(/.rpc\('get_dashboard_stats', \{ from_date: start, to_date: end \}\)/g, ".rpc('get_dashboard_stats', { from_date: start, to_date: end, p_business_id: activeBusiness.id })");
content = content.replace(/.rpc\('get_dashboard_stats', \{ from_date: prevStartStr, to_date: prevEndStr \}\)/g, ".rpc('get_dashboard_stats', { from_date: prevStartStr, to_date: prevEndStr, p_business_id: activeBusiness.id })");
content = content.replace(/.rpc\('get_daily_sales', \{ from_date: start, to_date: end \}\)/g, ".rpc('get_daily_sales', { from_date: start, to_date: end, p_business_id: activeBusiness.id })");
content = content.replace(/.rpc\('get_top_products', \{ from_date: start, to_date: end, limit_count: 5 \}\)/g, ".rpc('get_top_products', { from_date: start, to_date: end, limit_count: 5, p_business_id: activeBusiness.id })");

// Add activeBusiness.id to ordinary fetches
content = content.replace('.from("orders")\n        .select', '.from("orders")\n        .select("*, customer_info")\n        .eq("business_id", activeBusiness.id)');
content = content.replace('.from("variants")\n        .select', '.from("variants")\n        .select("*, products(name)")\n        .eq("business_id", activeBusiness.id)');

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed dashboard/page.tsx");
