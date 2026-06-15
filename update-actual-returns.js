const fs = require('fs');
const file = 'src/app/(dashboard)/insights/actual-returns/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add damagesLoss to metrics state
content = content.replace(
    'totalShippingCost: 0',
    'totalShippingCost: 0,\n        damagesLoss: 0'
);

// 2. Add Fetch for Damages
const fetchDamagesCode = `
            // 4. Fetch Damages
            const { data: damages, error: damagesError } = await supabase
                .from('inventory_damages')
                .select('total_loss')
                .gte('date', start)
                .lte('date', end);

            if (damagesError) throw damagesError;

            let damagesLoss = 0;
            (damages || []).forEach(d => {
                damagesLoss += Number(d.total_loss) || 0;
            });

            // Aggregation`;
content = content.replace('// Aggregation', fetchDamagesCode);

// 3. Update setMetrics call
content = content.replace(
    'totalShippingCost: ship',
    'totalShippingCost: ship,\n                damagesLoss'
);

// 4. Update the Grid of MetricCards
const metricCardCode = `
                    <MetricCard title="Ads Expenses" value={formatCurrency(metrics.adsExpenses)} neg />
                    <MetricCard title="Inventory Damages" value={formatCurrency(metrics.damagesLoss)} sub="Loss from damaged stock (Not deducted from Net Profit)" neg />
`;
content = content.replace(
    '<MetricCard title="Ads Expenses" value={formatCurrency(metrics.adsExpenses)} neg />',
    metricCardCode
);

fs.writeFileSync(file, content);
