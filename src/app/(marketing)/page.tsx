import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Package, TrendingUp, Users, ShieldCheck } from "lucide-react";

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { LogoutButton } from "@/components/ui/logout-button";

export default async function MarketingLandingPage() {
  const cookieStore = await cookies();
  
  const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
  const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";
  
  const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_KEY,
      {
          cookies: {
              getAll() { return cookieStore.getAll() }
          }
      }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('price_monthly', { ascending: true });

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <Link className="flex items-center justify-center" href="/">
          <div className="relative h-10 w-24">
            <Image src="/logo.png" alt="Zuha Logo" fill className="object-contain object-left" />
          </div>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6 items-center">
          <Link className="text-sm font-medium hover:text-primary underline-offset-4 hover:underline" href="#features">
            Features
          </Link>
          <Link className="text-sm font-medium hover:text-primary underline-offset-4 hover:underline" href="#pricing">
            Pricing
          </Link>
          <div className="flex items-center gap-2 ml-4">
            {user ? (
              <>
                <LogoutButton />
                <Button asChild>
                  <Link href="/dashboard">Go to Dashboard</Link>
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/login">Log in</Link>
                </Button>
                <Button asChild>
                  <Link href="/register">Start Free Trial</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full py-20 lg:py-32 xl:py-40 bg-gradient-to-br from-primary/10 via-white to-primary/5 dark:from-primary/20 dark:via-background dark:to-primary/10 relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay"></div>
          <div className="container px-4 md:px-6 relative z-10 mx-auto max-w-6xl">
            <div className="flex flex-col items-center space-y-8 text-center">
              <div className="space-y-4 max-w-3xl">
                <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl text-foreground">
                  The All-in-One Operating System for <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/50">E-Commerce</span>
                </h1>
                <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl leading-relaxed">
                  Manage orders, track inventory, handle logistics, and analyze profits—all from a single, beautiful dashboard.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                {user ? (
                  <div className="flex flex-col sm:flex-row gap-4">
                    <LogoutButton size="lg" variant="outline" className="h-14 px-8 text-lg rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 hover:border-red-300 bg-background/50 backdrop-blur-sm" />
                    <Button size="lg" className="h-14 px-8 text-lg rounded-full" asChild>
                      <Link href="/dashboard">Go to Dashboard</Link>
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button size="lg" className="h-14 px-8 text-lg rounded-full" asChild>
                      <Link href="/register">Start your 14-day free trial</Link>
                    </Button>
                    <Button size="lg" variant="outline" className="h-14 px-8 text-lg rounded-full">
                      Book a Demo
                    </Button>
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground">No credit card required. Cancel anytime.</p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="w-full py-20 bg-background">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything you need to scale</h2>
              <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
                Stop juggling spreadsheets and disconnected tools. Zuha brings your entire operations into one cohesive platform.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="flex flex-col items-center text-center p-6 border rounded-2xl bg-card shadow-sm hover:shadow-md transition-shadow">
                <div className="p-3 bg-primary/20 dark:bg-primary rounded-xl mb-4">
                  <Package className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Inventory Management</h3>
                <p className="text-muted-foreground">Track stock levels across multiple locations in real-time and prevent overselling.</p>
              </div>
              {/* Feature 2 */}
              <div className="flex flex-col items-center text-center p-6 border rounded-2xl bg-card shadow-sm hover:shadow-md transition-shadow">
                <div className="p-3 bg-primary/20 dark:bg-primary rounded-xl mb-4">
                  <TrendingUp className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Profit Analytics</h3>
                <p className="text-muted-foreground">Understand your true profitability with built-in accounting and ad expense tracking.</p>
              </div>
              {/* Feature 3 */}
              <div className="flex flex-col items-center text-center p-6 border rounded-2xl bg-card shadow-sm hover:shadow-md transition-shadow">
                <div className="p-3 bg-primary/20 dark:bg-primary rounded-xl mb-4">
                  <Users className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Team Collaboration</h3>
                <p className="text-muted-foreground">Invite your whole team with role-based access control and detailed audit logs.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="w-full py-20 bg-muted/50">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple, transparent pricing</h2>
              <p className="mt-4 text-muted-foreground text-lg">Choose the perfect plan for your business needs.</p>
            </div>
            
            <PricingGrid plans={plans} />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-6 border-t bg-background">
        <div className="container px-4 md:px-6 mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Zuha System. All rights reserved.
          </p>
          <div className="flex gap-4">
            <Link className="text-sm text-muted-foreground hover:text-foreground" href="#">Terms of Service</Link>
            <Link className="text-sm text-muted-foreground hover:text-foreground" href="#">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PricingGrid({ plans }: { plans: any[] | null }) {
  if (!plans || plans.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-8 border border-dashed rounded-xl">
        Pricing plans are currently being updated. Please check back later.
      </div>
    );
  }

  return (
    <div className={`grid gap-8 max-w-5xl mx-auto ${plans.length === 1 ? 'grid-cols-1 max-w-md' : plans.length === 2 ? 'sm:grid-cols-2 max-w-3xl' : 'lg:grid-cols-3'}`}>
      {plans.map((plan) => (
        <div key={plan.id} className={`flex flex-col p-8 border-2 rounded-3xl bg-background relative overflow-hidden transition-all ${plan.is_popular ? 'border-primary shadow-xl scale-105 z-10' : 'border-border shadow-sm hover:shadow-md'}`}>
          {plan.is_popular && (
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-4 py-1 rounded-bl-xl text-sm font-medium">
              Most Popular
            </div>
          )}
          <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
          <p className="text-muted-foreground mb-6 h-12 line-clamp-2">{plan.description}</p>
          
          <div className="flex items-baseline gap-2 mb-8 border-b pb-8">
            <span className="text-5xl font-extrabold">{plan.price_monthly}</span>
            <span className="text-xl font-medium text-muted-foreground">{plan.currency} / month</span>
          </div>
          
          <ul className="space-y-4 mb-8 flex-1">
            {plan.features?.map((feature: string, i: number) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                <span className="text-sm">{feature}</span>
              </li>
            ))}
          </ul>
          
          <Button size="lg" className="w-full rounded-xl" variant={plan.is_popular ? "default" : "outline"} asChild>
            <Link href={`/register?plan=${plan.id}`}>Start 14-Day Free Trial</Link>
          </Button>
        </div>
      ))}
    </div>
  );
}
