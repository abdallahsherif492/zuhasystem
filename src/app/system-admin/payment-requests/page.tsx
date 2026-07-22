import { createSupabaseServerClient } from '@/lib/supabase-server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PaymentRequestActions } from './request-actions'
import { Badge } from '@/components/ui/badge'

export default async function PaymentRequestsPage() {
  const supabase = await createSupabaseServerClient()
  
  // Fetch pending requests with business info
  const { data: requests, error } = await supabase
    .from('payment_requests')
    .select(`
        *,
        businesses:business_id ( name )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Payment Requests</h2>
        <p className="text-muted-foreground">Review and approve top-up requests from businesses.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Requests</CardTitle>
          <CardDescription>Wallet top-up requests awaiting your approval.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Sender Details</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests?.map((req) => (
                <TableRow key={req.id}>
                  <TableCell>{new Date(req.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{req.businesses?.name || 'Unknown'}</TableCell>
                  <TableCell>{req.amount} EGP</TableCell>
                  <TableCell className="capitalize">{req.payment_method}</TableCell>
                  <TableCell>{req.sender_details}</TableCell>
                  <TableCell>
                    <a href={req.receipt_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      View Image
                    </a>
                  </TableCell>
                  <TableCell>
                    <PaymentRequestActions 
                        reqId={req.id} 
                        businessId={req.business_id} 
                        amount={req.amount} 
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(!requests || requests.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground h-24">
                    No pending payment requests.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
