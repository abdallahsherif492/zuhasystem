'use server'

import { supabaseAdmin as supabase } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export async function submitPaymentRequest(
  businessId: string,
  amount: number,
  paymentMethod: string,
  senderDetails: string,
  receiptUrl: string
) {
  
  const { data, error } = await supabase
    .from('payment_requests')
    .insert({
      business_id: businessId,
      amount,
      payment_method: paymentMethod,
      sender_details: senderDetails,
      receipt_url: receiptUrl,
      status: 'pending'
    })
    
  if (error) {
    console.error('Error submitting payment request:', error)
    throw new Error('Failed to submit payment request')
  }
  
  revalidatePath('/settings')
  return { success: true }
}

export async function buyPackage(businessId: string, packageId: string, packagePrice: number, packageMonths: number) {
  
  // 1. Get current business wallet balance
  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('wallet_balance, subscription_end_date')
    .eq('id', businessId)
    .single()
    
  if (bizError || !business) {
    throw new Error('Business not found')
  }
  
  if (business.wallet_balance < packagePrice) {
    throw new Error('Insufficient wallet balance')
  }
  
  // 2. Calculate new end date
  let newEndDate = new Date()
  if (business.subscription_end_date && new Date(business.subscription_end_date) > new Date()) {
      newEndDate = new Date(business.subscription_end_date)
  }
  newEndDate.setMonth(newEndDate.getMonth() + packageMonths)

  // 3. Update business (deduct balance, set package)
  const { error: updateError } = await supabase
    .from('businesses')
    .update({
      wallet_balance: business.wallet_balance - packagePrice,
      active_package_id: packageId,
      subscription_end_date: newEndDate.toISOString()
    })
    .eq('id', businessId)
    
  if (updateError) {
    throw new Error('Failed to update business subscription')
  }
  
  // 4. Log revenue transaction
  await supabase.from('revenue_transactions').insert({
      business_id: businessId,
      amount: packagePrice,
      type: 'package_purchase',
      description: `Purchased package for ${packageMonths} months`
  })
  
  revalidatePath('/settings')
  return { success: true }
}
