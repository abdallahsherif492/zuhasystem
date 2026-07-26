"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Search, Package, ShoppingCart, Users, Banknote, Loader2, X, ChevronRight, CornerDownLeft, Command 
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { format } from "date-fns";

type SearchResults = {
  products: any[];
  orders: any[];
  customers: any[];
  transactions: any[];
};

export function AdvancedSearch() {
  const { activeBusiness } = useBusiness();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ products: [], orders: [], customers: [], transactions: [] });
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'orders' | 'products' | 'customers' | 'transactions'>('all');
  const [selectedDetailItem, setSelectedDetailItem] = useState<{ type: 'product' | 'order' | 'customer' | 'transaction', data: any } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut listener (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced search
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (query.trim().length > 1 && activeBusiness) {
        performSearch(query);
      } else {
        setResults({ products: [], orders: [], customers: [], transactions: [] });
        if (query.trim().length === 0) setIsOpen(false);
      }
    }, 350);

    return () => clearTimeout(delayDebounce);
  }, [query, activeBusiness]);

  async function performSearch(searchTerm: string) {
    if (!activeBusiness) return;
    setLoading(true);
    setIsOpen(true);

    try {
      const cleanQuery = searchTerm.trim();
      const qLower = `%${cleanQuery}%`;

      // 1. Search Products & Variants
      const { data: prods } = await supabase
        .from("products")
        .select("*, variants(*)")
        .eq("business_id", activeBusiness.id)
        .ilike("name", qLower)
        .limit(6);

      const { data: matchedVariants } = await supabase
        .from("variants")
        .select("*, products!inner(*)")
        .eq("products.business_id", activeBusiness.id)
        .or(`title.ilike.${qLower},sku.ilike.${qLower}`)
        .limit(6);

      // Merge products safely
      const mergedProductsMap: Record<string, any> = {};
      (prods || []).forEach(p => { mergedProductsMap[p.id] = p; });
      (matchedVariants || []).forEach(v => {
        if (v.products && !mergedProductsMap[v.products.id]) {
          mergedProductsMap[v.products.id] = v.products;
        }
      });
      const finalProducts = Object.values(mergedProductsMap);

      // 2. Search Customers
      const { data: custs } = await supabase
        .from("customers")
        .select("*")
        .eq("business_id", activeBusiness.id)
        .or(`name.ilike.${qLower},phone.ilike.${qLower},city.ilike.${qLower},governorate.ilike.${qLower}`)
        .limit(6);

      const customerIds = (custs || []).map(c => c.id);

      // 3. Search Orders
      let ordersQuery = supabase
        .from("orders")
        .select("*, order_items(*, variants(*))")
        .eq("business_id", activeBusiness.id)
        .order("created_at", { ascending: false })
        .limit(8);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanQuery);

      if (customerIds.length > 0) {
        ordersQuery = ordersQuery.in("customer_id", customerIds);
      } else if (isUuid) {
        ordersQuery = ordersQuery.eq("id", cleanQuery);
      } else {
        ordersQuery = ordersQuery.or(`status.ilike.${qLower},channel.ilike.${qLower}`);
      }

      const { data: ords } = await ordersQuery;

      // 4. Search Financial Transactions
      const { data: txs } = await supabase
        .from("financial_transactions")
        .select("*, financial_accounts(name)")
        .eq("business_id", activeBusiness.id)
        .or(`description.ilike.${qLower},category.ilike.${qLower},type.ilike.${qLower}`)
        .order("created_at", { ascending: false })
        .limit(6);

      setResults({
        products: finalProducts,
        orders: ords || [],
        customers: custs || [],
        transactions: txs || []
      });
    } catch (error) {
      console.error("Spotlight Search Error:", error);
    } finally {
      setLoading(false);
    }
  }

  const totalResultsCount = 
    results.products.length + 
    results.orders.length + 
    results.customers.length + 
    results.transactions.length;

  return (
    <div className="relative w-full max-w-4xl mx-auto z-50">
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <Search className="absolute left-4 h-5 w-5 text-muted-foreground transition-colors" />
        <Input
          ref={inputRef}
          placeholder={t("Search Products, Orders, Customers, Transactions...")}
          value={query}
          onFocus={() => { if (query.trim().length > 1) setIsOpen(true); }}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-12 pr-24 h-12 text-sm bg-background/90 backdrop-blur-md border-2 border-border/80 focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl shadow-sm transition-all"
        />
        <div className="absolute right-3 flex items-center gap-2">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : query ? (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={() => { setQuery(""); setIsOpen(false); }}>
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <kbd className="hidden sm:inline-flex h-6 select-none items-center gap-1 rounded border bg-muted px-2 font-mono text-[10px] font-semibold text-muted-foreground">
              <Command className="h-3 w-3" />K
            </kbd>
          )}
        </div>
      </div>

      {/* Spotlight Dropdown Modal Card */}
      {isOpen && query.trim().length > 1 && (
        <Card className="absolute top-full mt-2 w-full max-h-[550px] overflow-hidden shadow-2xl border-2 z-50 rounded-2xl animate-in fade-in slide-in-from-top-2">
          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1 p-2 bg-muted/40 border-b overflow-x-auto text-xs">
            <Button
              size="sm"
              variant={activeTab === 'all' ? "default" : "ghost"}
              className="h-7 text-xs rounded-lg"
              onClick={() => setActiveTab('all')}
            >
              {t("All")} ({totalResultsCount})
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'orders' ? "default" : "ghost"}
              className="h-7 text-xs rounded-lg gap-1.5"
              onClick={() => setActiveTab('orders')}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {t("Orders")} ({results.orders.length})
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'products' ? "default" : "ghost"}
              className="h-7 text-xs rounded-lg gap-1.5"
              onClick={() => setActiveTab('products')}
            >
              <Package className="h-3.5 w-3.5" />
              {t("Products")} ({results.products.length})
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'customers' ? "default" : "ghost"}
              className="h-7 text-xs rounded-lg gap-1.5"
              onClick={() => setActiveTab('customers')}
            >
              <Users className="h-3.5 w-3.5" />
              {t("Customers")} ({results.customers.length})
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'transactions' ? "default" : "ghost"}
              className="h-7 text-xs rounded-lg gap-1.5"
              onClick={() => setActiveTab('transactions')}
            >
              <Banknote className="h-3.5 w-3.5" />
              {t("Transactions")} ({results.transactions.length})
            </Button>
          </div>

          <CardContent className="p-3 space-y-4 overflow-y-auto max-h-[460px] custom-scrollbar">
            {totalResultsCount === 0 && !loading && (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <Search className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                <p>{t("No search results found")}</p>
              </div>
            )}

            {/* Orders Section */}
            {(activeTab === 'all' || activeTab === 'orders') && results.orders.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <ShoppingCart className="h-3.5 w-3.5 text-primary" /> {t("Orders")}
                </div>
                <div className="grid gap-1.5">
                  {results.orders.map(order => (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all cursor-pointer group"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-xs text-foreground flex items-center gap-2">
                          <span>{order.customer_info?.name || "Customer"}</span>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {order.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {order.customer_info?.phone || ''} — {order.customer_info?.governorate || ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-xs text-foreground">{formatCurrency(order.total_amount || 0)}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Products Section */}
            {(activeTab === 'all' || activeTab === 'products') && results.products.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-blue-600" /> {t("Products")}
                </div>
                <div className="grid gap-1.5">
                  {results.products.map(product => (
                    <div
                      key={product.id}
                      onClick={() => setSelectedDetailItem({ type: 'product', data: product })}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-blue-500/5 border border-transparent hover:border-blue-500/20 transition-all cursor-pointer group"
                    >
                      <div className="space-y-0.5">
                        <p className="font-semibold text-xs text-foreground">{product.name}</p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">{product.description || t("No description")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {product.variants?.length || 0} {t("variants")}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Customers Section */}
            {(activeTab === 'all' || activeTab === 'customers') && results.customers.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-emerald-600" /> {t("Customers")}
                </div>
                <div className="grid gap-1.5">
                  {results.customers.map(customer => (
                    <Link
                      key={customer.id}
                      href={`/customers/${customer.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/20 transition-all cursor-pointer group"
                    >
                      <div className="space-y-0.5">
                        <p className="font-semibold text-xs text-foreground">{customer.name}</p>
                        <p className="text-[11px] text-muted-foreground">{customer.phone} — {customer.city || customer.governorate || ''}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Transactions Section */}
            {(activeTab === 'all' || activeTab === 'transactions') && results.transactions.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5 text-purple-600" /> {t("Transactions")}
                </div>
                <div className="grid gap-1.5">
                  {results.transactions.map(tx => (
                    <div
                      key={tx.id}
                      onClick={() => setSelectedDetailItem({ type: 'transaction', data: tx })}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-purple-500/5 border border-transparent hover:border-purple-500/20 transition-all cursor-pointer group"
                    >
                      <div className="space-y-0.5">
                        <p className="font-semibold text-xs text-foreground">{tx.description || tx.category || "Transaction"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {tx.financial_accounts?.name || ''} — {format(new Date(tx.created_at), "yyyy-MM-dd")}
                        </p>
                      </div>
                      <span className={`font-bold text-xs ${tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Product Detail Dialog Modal */}
      {selectedDetailItem?.type === 'product' && (
        <Dialog open={!!selectedDetailItem} onOpenChange={() => setSelectedDetailItem(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                {selectedDetailItem.data.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground">{selectedDetailItem.data.description}</p>
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted text-muted-foreground font-semibold border-b">
                    <tr>
                      <th className="p-3">Variant</th>
                      <th className="p-3">SKU</th>
                      <th className="p-3">Price</th>
                      <th className="p-3">Cost</th>
                      <th className="p-3">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedDetailItem.data.variants?.map((v: any) => (
                      <tr key={v.id} className="hover:bg-muted/30">
                        <td className="p-3 font-semibold">{v.title}</td>
                        <td className="p-3 font-mono">{v.sku || 'N/A'}</td>
                        <td className="p-3 font-bold">{formatCurrency(v.sale_price)}</td>
                        <td className="p-3 text-muted-foreground">{formatCurrency(v.cost_price)}</td>
                        <td className="p-3 font-semibold">{v.track_inventory ? v.stock_qty : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
