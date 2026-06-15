const fs = require('fs');
const file = 'src/app/(dashboard)/insights/actual-returns/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Import AlertTriangle
content = content.replace(
    'Loader2, DollarSign, ArrowDownRight, ArrowUpRight, Percent, Package, Wallet, TrendingDown, Truck',
    'Loader2, DollarSign, ArrowDownRight, ArrowUpRight, Percent, Package, Wallet, TrendingDown, Truck, AlertTriangle'
);

// 2. Add Damages Card before Net Profit Card
const damagesCard = `
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Inventory Damages</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">{formatCurrency(metrics.damagesLoss)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Loss from damaged products (Not deducted)</p>
                    </CardContent>
                </Card>
                <Card className="bg-primary/5 border-primary/20">`;

content = content.replace(
    '<Card className="bg-primary/5 border-primary/20">',
    damagesCard
);

// Remove the erroneous replacement string from my previous node script
content = content.replace(
    `                    <MetricCard title="Ads Expenses" value={formatCurrency(metrics.adsExpenses)} neg />
                    <MetricCard title="Inventory Damages" value={formatCurrency(metrics.damagesLoss)} sub="Loss from damaged stock (Not deducted from Net Profit)" neg />
`,
    '<MetricCard title="Ads Expenses" value={formatCurrency(metrics.adsExpenses)} neg />'
);

fs.writeFileSync(file, content);
