import { Suspense } from "react"
import { SystemAccountingContent } from "@/components/system-admin/accounting/system-accounting-content"
import { Loader2 } from "lucide-react"

export default function SystemAccountingPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <SystemAccountingContent />
        </Suspense>
    )
}
