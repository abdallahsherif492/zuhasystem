const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

const oldFetchStr = `    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data } = await supabase
            .from('products')
            .select('id, name, variants(id, title, sale_price, stock_qty, track_inventory)')
            .eq('business_id', activeBusiness.id)
            .eq('is_active', true);
        if (data) setProducts(data);
    };`;

const newFetchStr = `    const fetchProducts = async () => {
        if (!activeBusiness) return;
        const { data, error } = await supabase
            .from('products')
            .select('id, name, variants(id, title, sale_price, stock_qty, track_inventory)')
            .order('name');
        if (error) console.error("Error fetching products:", error);
        if (data) setProducts(data);
    };`;

code = code.replace(oldFetchStr, newFetchStr);

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done fetch patch');
