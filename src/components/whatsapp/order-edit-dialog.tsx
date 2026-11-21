"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StoreOrderEditor } from "@/components/orders/store-order-editor";
import { useOrderEditor } from "@/hooks/use-order-editor";

/**
 * «عدّل الأوردر» in the chats: the same edit section as «New from stores»,
 * over the conversation, so the moderator never leaves the chat. Every
 * change saves as it is made; «تمام» waits for the last one, then closes.
 */
export function OrderEditDialog({ orderId, businessId, userEmail, onClose }: {
    orderId: string | null; businessId: string; userEmail: string | null; onClose: () => void;
}) {
    return (
        <Dialog open={!!orderId} onOpenChange={o => { if (!o) onClose(); }}>
            {orderId && <Editor key={orderId} orderId={orderId} businessId={businessId} userEmail={userEmail} onClose={onClose} />}
        </Dialog>
    );
}

function Editor({ orderId, businessId, userEmail, onClose }: { orderId: string; businessId: string; userEmail: string | null; onClose: () => void }) {
    const { order, products, bundles, actions, flush } = useOrderEditor(businessId, orderId, userEmail);
    const [closing, setClosing] = useState(false);
    const done = async () => { setClosing(true); await flush(); setClosing(false); onClose(); };
    return (
        <DialogContent dir="rtl" className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
            <DialogHeader className="ps-8 text-start">
                <DialogTitle className="flex flex-wrap items-center gap-2">
                    تعديل الأوردر <span className="font-mono text-base" dir="ltr">#{orderId.slice(0, 8).toUpperCase()}</span>
                    {order?.customer_info?.name && <span className="text-base font-normal text-muted-foreground">· {order.customer_info.name}</span>}
                </DialogTitle>
                <DialogDescription>كل تعديل بيتحفظ لوحده أول ما تخلصه. الشات مفتوح وراك.</DialogDescription>
            </DialogHeader>
            {!order ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                : <StoreOrderEditor order={order} businessId={businessId} products={products} bundles={bundles} edit={actions} />}
            <DialogFooter>
                <Button onClick={done} disabled={closing} className="min-w-28">{closing && <Loader2 className="me-2 h-4 w-4 animate-spin" />}تمام</Button>
            </DialogFooter>
        </DialogContent>
    );
}
