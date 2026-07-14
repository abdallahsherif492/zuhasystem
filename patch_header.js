const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

const oldHeaderStr = `<h2 className="text-3xl font-bold tracking-tight">{t("EasyOrders")}</h2>`;
const newHeaderStr = `<h2 className="text-3xl font-bold tracking-tight flex items-center">
                        {t("EasyOrders")}
                        {!loading && orders.length > 0 && (
                            <Badge variant="secondary" className="ml-3 text-lg px-3 py-1 bg-primary/10 text-primary">
                                {orders.length} {t("Waiting")}
                            </Badge>
                        )}
                    </h2>`;
code = code.replace(oldHeaderStr, newHeaderStr);

fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done patch header');
