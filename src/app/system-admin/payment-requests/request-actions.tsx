"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { approvePaymentRequest, rejectPaymentRequest } from "../actions/billing"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface PaymentRequestActionsProps {
    reqId: string
    businessId: string
    amount: number
}

export function PaymentRequestActions({ reqId, businessId, amount }: PaymentRequestActionsProps) {
    const [showApprove, setShowApprove] = useState(false)
    const [showReject, setShowReject] = useState(false)
    const [rejectReason, setRejectReason] = useState("")
    const [loading, setLoading] = useState(false)

    const handleApprove = async () => {
        setLoading(true)
        await approvePaymentRequest(reqId, businessId, amount)
        setLoading(false)
        setShowApprove(false)
    }

    const handleReject = async () => {
        if (!rejectReason) return
        setLoading(true)
        await rejectPaymentRequest(reqId, rejectReason)
        setLoading(false)
        setShowReject(false)
    }

    return (
        <>
            <div className="flex space-x-2">
                <Button 
                    size="sm" 
                    onClick={() => setShowApprove(true)} 
                    className="bg-green-600 hover:bg-green-700"
                >
                    Approve
                </Button>
                
                <div className="flex items-center space-x-2">
                    <Input 
                        placeholder="Reject reason..." 
                        className="w-32 h-8 text-xs" 
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                    />
                    <Button 
                        size="sm" 
                        variant="destructive" 
                        onClick={() => setShowReject(true)} 
                        disabled={!rejectReason}
                    >
                        Reject
                    </Button>
                </div>
            </div>

            {/* Approve Dialog */}
            <AlertDialog open={showApprove} onOpenChange={setShowApprove}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will approve the top-up of {amount} EGP. The amount will be added to the business's wallet balance immediately.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={handleApprove} 
                            disabled={loading} 
                            className="bg-green-600 hover:bg-green-700"
                        >
                            Yes, Approve
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Reject Dialog */}
            <AlertDialog open={showReject} onOpenChange={setShowReject}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reject Payment Request?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will reject the payment request. The business will see this reason: "{rejectReason}".
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={handleReject} 
                            disabled={loading} 
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Yes, Reject
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
