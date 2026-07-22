import { createSupabaseServerClient } from '@/lib/supabase-server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createPackage, togglePackageStatus } from '../actions/billing'
import { revalidatePath } from 'next/cache'
import { Badge } from '@/components/ui/badge'

export default async function PricingPage() {
  const supabase = await createSupabaseServerClient()
  const { data: packages, error } = await supabase.from('packages').select('*').order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Packages Management</h2>
        <p className="text-muted-foreground">Manage subscription packages, durations, and pricing.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create New Package</CardTitle>
            <CardDescription>Add a new package for businesses to subscribe to.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={async (formData) => {
              'use server'
              const name = formData.get('name') as string
              const duration = Number(formData.get('duration_months'))
              const price = Number(formData.get('price'))
              await createPackage(name, duration, price)
              revalidatePath('/system-admin/pricing')
            }} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Package Name</label>
                <Input name="name" placeholder="e.g. 6 Months Plan" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Duration (Months)</label>
                <Input name="duration_months" type="number" min="1" placeholder="6" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Price (EGP)</label>
                <Input name="price" type="number" step="0.01" min="0" placeholder="1500" required />
              </div>
              <Button type="submit" className="w-full">Create Package</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existing Packages</CardTitle>
            <CardDescription>All defined packages in the system.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages?.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell className="font-medium">{pkg.name}</TableCell>
                    <TableCell>{pkg.duration_months} M</TableCell>
                    <TableCell>{pkg.price} EGP</TableCell>
                    <TableCell>
                      <Badge variant={pkg.is_active ? 'default' : 'secondary'}>
                        {pkg.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <form action={async () => {
                        'use server'
                        await togglePackageStatus(pkg.id, !pkg.is_active)
                        revalidatePath('/system-admin/pricing')
                      }}>
                        <Button variant="outline" size="sm" type="submit">
                          {pkg.is_active ? 'Disable' : 'Enable'}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
                {(!packages || packages.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground h-24">
                      No packages found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
