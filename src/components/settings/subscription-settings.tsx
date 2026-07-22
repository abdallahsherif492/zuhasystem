'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { submitPaymentRequest, buyPackage } from '@/app/(dashboard)/settings/billing-actions'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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

function CountdownTimer({ targetDate }: { targetDate: string }) {
    const [timeLeft, setTimeLeft] = useState({ months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 })

    useEffect(() => {
        const calculateTimeLeft = () => {
            const difference = +new Date(targetDate) - +new Date()
            let timeLeft = { months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }

            if (difference > 0) {
                timeLeft = {
                    months: Math.floor(difference / (1000 * 60 * 60 * 24 * 30)),
                    days: Math.floor((difference / (1000 * 60 * 60 * 24)) % 30),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60),
                }
            }
            return timeLeft
        }

        setTimeLeft(calculateTimeLeft())
        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft())
        }, 1000)

        return () => clearInterval(timer)
    }, [targetDate])

    if (+new Date(targetDate) - +new Date() <= 0) return null

    return (
        <div className="flex gap-2 text-center mt-2">
            {Object.entries(timeLeft).map(([unit, value]) => (
                <div key={unit} className="flex flex-col bg-muted rounded px-2 py-1 flex-1">
                    <span className="font-bold text-lg leading-none">{value}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{unit}</span>
                </div>
            ))}
        </div>
    )
}

export function SubscriptionSettings({ businessId }: { businessId: string }) {
    const [packages, setPackages] = useState<any[]>([])
    const [balance, setBalance] = useState(0)
    const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null)
    const [autoRenewEnabled, setAutoRenewEnabled] = useState(false)
    const [autoRenewPackageId, setAutoRenewPackageId] = useState<string | null>(null)
    
    // Top up form
    const [topupAmount, setTopupAmount] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('instapay')
    const [senderDetails, setSenderDetails] = useState('')
    const [receiptFile, setReceiptFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [submittingPkg, setSubmittingPkg] = useState<string | null>(null)
    
    // Dialog state
    const [selectedPackage, setSelectedPackage] = useState<any>(null)
    const [showConfirmBuy, setShowConfirmBuy] = useState(false)
    
    const [requests, setRequests] = useState<any[]>([])

    useEffect(() => {
        const fetchData = async () => {
            const { data: biz } = await supabase.from('businesses').select('wallet_balance, subscription_end_date, auto_renew_enabled, auto_renew_package_id').eq('id', businessId).single()
            if (biz) {
                setBalance(biz.wallet_balance || 0)
                setSubscriptionEnd(biz.subscription_end_date)
                setAutoRenewEnabled(biz.auto_renew_enabled || false)
                setAutoRenewPackageId(biz.auto_renew_package_id)
            }
            
            const { data: pkgs } = await supabase.from('packages').select('*').eq('is_active', true)
            if (pkgs) setPackages(pkgs)
                
            const { data: reqs } = await supabase.from('payment_requests').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(5)
            if (reqs) setRequests(reqs)
        }
        fetchData()
    }, [businessId])

    const handleTopup = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!receiptFile || !topupAmount || !senderDetails) {
            toast.error('Please fill all fields and upload a receipt')
            return
        }

        setUploading(true)
        try {
            const fileExt = receiptFile.name.split('.').pop()
            const fileName = `receipt_${businessId}_${Date.now()}.${fileExt}`
            const { error: uploadError } = await supabase.storage.from('payment_receipts').upload(fileName, receiptFile)
            if (uploadError) throw uploadError
            
            const { data: publicUrlData } = supabase.storage.from('payment_receipts').getPublicUrl(fileName)
            
            const res = await submitPaymentRequest(businessId, Number(topupAmount), paymentMethod, senderDetails, publicUrlData.publicUrl)
            
            if (!res.success) {
                toast.error(res.error || 'Failed to submit top-up request')
                return
            }
            
            toast.success('Top-up request submitted successfully! It is pending approval.')
            
            setTopupAmount('')
            setSenderDetails('')
            setReceiptFile(null)
            
            const { data } = await supabase.from('payment_requests').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(5)
            if (data) setRequests(data)
            
        } catch (error: any) {
            console.error('Topup error:', error)
            toast.error(error.message || 'Failed to submit top-up request')
        } finally {
            setUploading(false)
        }
    }

    const triggerBuyConfirm = (pkg: any) => {
        if (balance < pkg.price) {
            toast.error('Insufficient wallet balance. Please top up first.')
            return
        }
        setSelectedPackage(pkg)
        setShowConfirmBuy(true)
    }

    const handleBuyPackage = async () => {
        if (!selectedPackage) return
        
        const pkg = selectedPackage
        setSubmittingPkg(pkg.id)
        setShowConfirmBuy(false)
        try {
            const res = await buyPackage(businessId, pkg.id, pkg.price, pkg.duration_months)
            
            if (!res.success) {
                toast.error(res.error || 'Failed to buy package')
                return
            }
            
            toast.success('Subscription updated successfully!')
            
            setBalance(prev => prev - pkg.price)
            let newEnd = new Date()
            if (subscriptionEnd && new Date(subscriptionEnd) > new Date()) {
                newEnd = new Date(subscriptionEnd)
            }
            newEnd.setMonth(newEnd.getMonth() + pkg.duration_months)
            setSubscriptionEnd(newEnd.toISOString())
            
        } catch (error) {
            console.error(error)
            toast.error('Failed to buy package')
        } finally {
            setSubmittingPkg(null)
            setSelectedPackage(null)
        }
    }

    const toggleAutoRenew = async (pkgId: string, enabled: boolean) => {
        try {
            const { error } = await supabase.from('businesses').update({
                auto_renew_enabled: enabled,
                auto_renew_package_id: enabled ? pkgId : null
            }).eq('id', businessId)

            if (error) throw error

            setAutoRenewEnabled(enabled)
            setAutoRenewPackageId(enabled ? pkgId : null)
            toast.success(`Auto-renew ${enabled ? 'enabled' : 'disabled'} successfully`)
        } catch (error) {
            console.error('Error toggling auto renew:', error)
            toast.error('Failed to update auto-renew settings')
        }
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Wallet Balance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{Number(balance).toFixed(2)} EGP</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Subscription Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {subscriptionEnd && new Date(subscriptionEnd) > new Date() ? (
                            <div>
                                <Badge className="bg-green-600 mb-2">Active</Badge>
                                <p className="text-sm text-muted-foreground">Expires on: {new Date(subscriptionEnd).toLocaleDateString()}</p>
                                <CountdownTimer targetDate={subscriptionEnd} />
                            </div>
                        ) : (
                            <div>
                                <Badge variant="destructive" className="mb-2">Expired</Badge>
                                <p className="text-sm text-muted-foreground">Please renew your subscription to avoid service interruption.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Top-up Form */}
                <Card>
                    <CardHeader>
                        <CardTitle>Top-up Wallet</CardTitle>
                        <CardDescription>Add funds via Instapay or E-Wallet.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleTopup} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Payment Method</label>
                                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="instapay">Instapay</SelectItem>
                                        <SelectItem value="e-wallet">E-Wallet (Vodafone Cash, etc.)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Amount (EGP)</label>
                                <Input type="number" min="1" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Sender Username / Phone Number</label>
                                <Input value={senderDetails} onChange={e => setSenderDetails(e.target.value)} placeholder="010..." required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Transfer Screenshot (Receipt)</label>
                                <Input type="file" accept="image/*" onChange={e => setReceiptFile(e.target.files?.[0] || null)} required />
                            </div>
                            <Button type="submit" className="w-full" disabled={uploading}>
                                {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Submit Payment Request
                            </Button>
                        </form>

                        {/* Recent Requests */}
                        <div className="mt-6 space-y-2">
                            <h4 className="text-sm font-semibold">Recent Top-up Requests</h4>
                            {requests.map(req => (
                                <div key={req.id} className="text-xs p-2 border rounded flex justify-between items-center">
                                    <div>
                                        <span className="font-medium">{req.amount} EGP</span> - {new Date(req.created_at).toLocaleDateString()}
                                    </div>
                                    <Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : 'secondary'}>
                                        {req.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Packages */}
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg">Available Packages</h3>
                    {packages.map(pkg => {
                        const isAutoRenew = autoRenewEnabled && autoRenewPackageId === pkg.id
                        return (
                            <Card key={pkg.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="text-lg">{pkg.name}</CardTitle>
                                            <CardDescription>{pkg.duration_months} Months Access</CardDescription>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Switch 
                                                id={`auto-renew-${pkg.id}`} 
                                                checked={isAutoRenew}
                                                onCheckedChange={(checked) => toggleAutoRenew(pkg.id, checked)}
                                            />
                                            <Label htmlFor={`auto-renew-${pkg.id}`} className="text-xs">Auto Renew</Label>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardFooter className="flex justify-between border-t pt-4">
                                    <span className="font-bold text-xl">{pkg.price} EGP</span>
                                    <Button 
                                        onClick={() => triggerBuyConfirm(pkg)} 
                                        disabled={submittingPkg === pkg.id || balance < pkg.price}
                                    >
                                        {submittingPkg === pkg.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Buy Package
                                    </Button>
                                </CardFooter>
                            </Card>
                        )
                    })}
                </div>
            </div>

            <AlertDialog open={showConfirmBuy} onOpenChange={setShowConfirmBuy}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Purchase</AlertDialogTitle>
                        <AlertDialogDescription>
                            {selectedPackage && (
                                <div className="space-y-4 mt-4">
                                    <div className="flex justify-between border-b pb-2">
                                        <span className="font-medium">Package:</span>
                                        <span>{selectedPackage.name}</span>
                                    </div>
                                    <div className="flex justify-between border-b pb-2">
                                        <span className="font-medium">Price:</span>
                                        <span className="text-destructive font-bold">-{selectedPackage.price} EGP</span>
                                    </div>
                                    <div className="flex justify-between border-b pb-2">
                                        <span className="font-medium">Duration:</span>
                                        <span>+{selectedPackage.duration_months} Months</span>
                                    </div>
                                    <div className="flex justify-between text-green-600">
                                        <span className="font-medium">New Expiration Date:</span>
                                        <span className="font-bold">
                                            {(() => {
                                                let newEnd = new Date()
                                                if (subscriptionEnd && new Date(subscriptionEnd) > new Date()) {
                                                    newEnd = new Date(subscriptionEnd)
                                                }
                                                newEnd.setMonth(newEnd.getMonth() + selectedPackage.duration_months)
                                                return newEnd.toLocaleDateString()
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleBuyPackage}>Confirm & Buy</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
