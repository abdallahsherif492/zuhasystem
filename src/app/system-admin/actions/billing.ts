'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function approvePaymentRequest(requestId: string, businessId: string, amount: number) {
  const supabase = createClient()
  
  // 1. Update status
  const { error: updateError } = await supabase
    .from('payment_requests')
    .update({ status: 'approved' })
    .eq('id', requestId)
    
  if (updateError) throw new Error('Failed to approve request')
  
  // 2. Add to wallet balance
  const { data: business } = await supabase.from('businesses').select('wallet_balance').eq('id', businessId).single()
  
  if (business) {
      await supabase.from('businesses').update({
          wallet_balance: (Number(business.wallet_balance) || 0) + Number(amount)
      }).eq('id', businessId)
  }
  
  // 3. Create revenue transaction
  await supabase.from('revenue_transactions').insert({
      business_id: businessId,
      payment_request_id: requestId,
      amount: amount,
      type: 'wallet_topup',
      description: 'Wallet top-up approved'
  })
  
  revalidatePath('/system-admin/payment-requests')
  return { success: true }
}

export async function rejectPaymentRequest(requestId: string, reason: string) {
  const supabase = createClient()
  
  const { error } = await supabase
    .from('payment_requests')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', requestId)
    
  if (error) throw new Error('Failed to reject request')
  
  revalidatePath('/system-admin/payment-requests')
  return { success: true }
}

export async function createPackage(name: string, duration_months: number, price: number) {
  const supabase = createClient()
  const { error } = await supabase.from('packages').insert({
      name,
      duration_months,
      price
  })
  if (error) throw new Error('Failed to create package')
  revalidatePath('/system-admin/pricing')
  return { success: true }
}

export async function togglePackageStatus(packageId: string, isActive: boolean) {
    const supabase = createClient()
    const { error } = await supabase.from('packages').update({ is_active: isActive }).eq('id', packageId)
    if (error) throw new Error('Failed to update package status')
    revalidatePath('/system-admin/pricing')
    return { success: true }
}
