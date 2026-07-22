import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export default async function AccountingPage() {
  const supabase = createClient()
  
  const { data: transactions, error } = await supabase
    .from('revenue_transactions')
    .select(`
        *,
        businesses:business_id ( name )
    `)
    .order('created_at', { ascending: false })

  const totalRevenue = transactions?.reduce((acc, curr) => {
      if (curr.type === 'wallet_topup') return acc + Number(curr.amount)
      return acc // Only counting actual top-ups as real cash in
  }, 0) || 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Accounting & Revenue</h2>
        <p className="text-muted-foreground">Track all incoming revenue and system transactions.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Top-ups (Cash In)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalRevenue.toFixed(2)} EGP</div>
            <p className="text-xs text-muted-foreground">Lifetime revenue from wallet top-ups.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>All revenue generating events in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions?.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{new Date(tx.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{tx.businesses?.name || 'Unknown'}</TableCell>
                  <TableCell>
                    <Badge variant={tx.type === 'wallet_topup' ? 'default' : 'secondary'}>
                        {tx.type.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{tx.description}</TableCell>
                  <TableCell className="text-right font-bold text-green-600">
                      +{tx.amount} EGP
                  </TableCell>
                </TableRow>
              ))}
              {(!transactions || transactions.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground h-24">
                    No transactions found.
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
