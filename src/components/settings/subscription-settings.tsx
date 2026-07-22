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

export function SubscriptionSettings({ businessId }: { businessId: string }) {
    const [packages, setPackages] = useState<any[]>([])
    const [balance, setBalance] = useState(0)
    const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null)
    
    // Top up form
    const [topupAmount, setTopupAmount] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('instapay')
    const [senderDetails, setSenderDetails] = useState('')
    const [receiptFile, setReceiptFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [submittingPkg, setSubmittingPkg] = useState<string | null>(null)
    
    const [requests, setRequests] = useState<any[]>([])

    useEffect(() => {
        const fetchData = async () => {
            // Fetch wallet balance and subscription
            const { data: biz } = await supabase.from('businesses').select('wallet_balance, subscription_end_date').eq('id', businessId).single()
            if (biz) {
                setBalance(biz.wallet_balance || 0)
                setSubscriptionEnd(biz.subscription_end_date)
            }
            
            // Fetch active packages
            const { data: pkgs } = await supabase.from('packages').select('*').eq('is_active', true)
            if (pkgs) setPackages(pkgs)
                
            // Fetch requests
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
            // Upload receipt
            const fileExt = receiptFile.name.split('.').pop()
            const fileName = `receipt_${businessId}_${Date.now()}.${fileExt}`
            const { error: uploadError } = await supabase.storage.from('payment_receipts').upload(fileName, receiptFile)
            if (uploadError) throw uploadError
            
            const { data: publicUrlData } = supabase.storage.from('payment_receipts').getPublicUrl(fileName)
            
            // Submit request
            const res = await submitPaymentRequest(businessId, Number(topupAmount), paymentMethod, senderDetails, publicUrlData.publicUrl)
            
            if (!res.success) {
                toast.error(res.error || 'Failed to submit top-up request')
                return
            }
            
            toast.success('Top-up request submitted successfully! It is pending approval.')
            
            // Reset form
            setTopupAmount('')
            setSenderDetails('')
            setReceiptFile(null)
            
            // Refresh requests
            const { data } = await supabase.from('payment_requests').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(5)
            if (data) setRequests(data)
            
        } catch (error: any) {
            console.error('Topup error:', error)
            toast.error(error.message || 'Failed to submit top-up request')
        } finally {
            setUploading(false)
        }
    }

    const handleBuyPackage = async (pkg: any) => {
        if (balance < pkg.price) {
            toast.error('Insufficient wallet balance. Please top up first.')
            return
        }
        
        setSubmittingPkg(pkg.id)
        try {
            const res = await buyPackage(businessId, pkg.id, pkg.price, pkg.duration_months)
            
            if (!res.success) {
                toast.error(res.error || 'Failed to buy package')
                return
            }
            
            toast.success('Subscription updated successfully!')
            
            // Update local state
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
                    {packages.map(pkg => (
                        <Card key={pkg.id}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-lg">{pkg.name}</CardTitle>
                                <CardDescription>{pkg.duration_months} Months Access</CardDescription>
                            </CardHeader>
                            <CardFooter className="flex justify-between border-t pt-4">
                                <span className="font-bold text-xl">{pkg.price} EGP</span>
                                <Button 
                                    onClick={() => handleBuyPackage(pkg)} 
                                    disabled={submittingPkg === pkg.id || balance < pkg.price}
                                >
                                    {submittingPkg === pkg.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Buy Package
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    )
}
