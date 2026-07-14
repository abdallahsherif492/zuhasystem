const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/easy-orders/page.tsx', 'utf8');

// 1. Fix setOrders in updateOrderField
code = code.replace(
    /setOrders\(orders.map\(o => o.id === order.id \? \{ \.\.\.o, \[field\]: value \} : o\)\);/g,
    \`setOrders(prev => prev.map(o => o.id === order.id ? { ...o, [field]: value } : o));\`
);

// 2. Fix Add to Order insert missing cost_at_sale
const oldAddInsert = \`                                                                const { data: newItem, error } = await supabase.from('order_items').insert({
                                                                    order_id: order.id,
                                                                    variant_id: vari.id,
                                                                    quantity: 1,
                                                                    price_at_sale: vari.sale_price,
                                                                    business_id: activeBusiness?.id
                                                                }).select('id').single();\`;

const newAddInsert = \`                                                                const { data: newItem, error } = await supabase.from('order_items').insert({
                                                                    order_id: order.id,
                                                                    variant_id: vari.id,
                                                                    quantity: 1,
                                                                    price_at_sale: vari.sale_price,
                                                                    cost_at_sale: vari.cost_price || 0,
                                                                    business_id: activeBusiness?.id
                                                                }).select('id').single();\`;

code = code.replace(oldAddInsert, newAddInsert);

// 3. Fix Add to Order missing cost_at_sale in local state object too
const oldAddObj = \`                                                                const newItemObj = {
                                                                    id: newItem.id,
                                                                    variant_id: vari.id,
                                                                    quantity: 1,
                                                                    price_at_sale: vari.sale_price,
                                                                    variants: {
                                                                        title: vari.title,
                                                                        sku: "",
                                                                        product_id: prod.id,
                                                                        products: { name: prod.name }
                                                                    }
                                                                };\`;

const newAddObj = \`                                                                const newItemObj = {
                                                                    id: newItem.id,
                                                                    variant_id: vari.id,
                                                                    quantity: 1,
                                                                    price_at_sale: vari.sale_price,
                                                                    cost_at_sale: vari.cost_price || 0,
                                                                    variants: {
                                                                        title: vari.title,
                                                                        sku: "",
                                                                        product_id: prod.id,
                                                                        products: { name: prod.name }
                                                                    }
                                                                };\`;
code = code.replace(oldAddObj, newAddObj);

// 4. In "Add to Order", the setOrders logic was:
// const newOrders = [...orders]; ... setOrders(newOrders);
// Let's replace it with functional update to avoid stale closures
const oldSetOrdersBlock = \`                                                                const newOrders = [...orders];
                                                                const oIndex = newOrders.findIndex(o => o.id === order.id);
                                                                newOrders[oIndex].order_items.push(newItemObj);
                                                                
                                                                const newTotal = newOrders[oIndex].order_items.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + newOrders[oIndex].shipping_cost;
                                                                newOrders[oIndex].total_amount = newTotal;
                                                                setOrders(newOrders);\`;

const newSetOrdersBlock = \`                                                                const newTotal = order.order_items.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0) + vari.sale_price + order.shipping_cost;
                                                                
                                                                setOrders(prev => prev.map(o => {
                                                                    if (o.id === order.id) {
                                                                        return {
                                                                            ...o,
                                                                            total_amount: newTotal,
                                                                            order_items: [...o.order_items, newItemObj as any]
                                                                        };
                                                                    }
                                                                    return o;
                                                                }));\`;
code = code.replace(oldSetOrdersBlock, newSetOrdersBlock);

// 5. Update handleUpdateOrder params to match the newTotal
const oldHandleUpdateOrderParams = \`handleUpdateOrder(order.id, { subtotal: newTotal - newOrders[oIndex].shipping_cost, total_amount: newTotal });\`;
const newHandleUpdateOrderParams = \`handleUpdateOrder(order.id, { subtotal: newTotal - order.shipping_cost, total_amount: newTotal });\`;
code = code.replace(oldHandleUpdateOrderParams, newHandleUpdateOrderParams);


fs.writeFileSync('src/app/(dashboard)/easy-orders/page.tsx', code);
console.log('done bug fixes');
