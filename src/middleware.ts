import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    try {
        let response = NextResponse.next({
            request: {
                headers: request.headers,
            },
        })

        // FALLBACK: Hardcoded keys to unblock Vercel deployment issues
        const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
        const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_KEY;

        // Validation: If essential envs are missing, we cannot verify security.
        // We should redirect to an error page or Login, but Login also needs these.
        // We'll proceed to Login which might show a client-side error, better than open access.
        if (!supabaseUrl || !supabaseKey) {
            console.error("Middleware: Missing Env Vars");
            // Fall through to redirect logic below as 'user' will be null
        }

        // 1. Create Supabase Client to check Auth
        // Pass empty strings if missing to avoid immediate crash, but logic will fail gracefully (no user)
        const supabase = createServerClient(
            supabaseUrl || "",
            supabaseKey || "",
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
                        response = NextResponse.next({
                            request,
                        })
                        cookiesToSet.forEach(({ name, value, options }) =>
                            response.cookies.set(name, value, options)
                        )
                    },
                },
            }
        )

        // 2. Get User
        // getUser() is safe on the server
        const {
            data: { user },
        } = await supabase.auth.getUser()

        // 3. Define Protected Logic
        const isLoginPage = request.nextUrl.pathname.startsWith('/login')
        const isAuthCallback = request.nextUrl.pathname.startsWith('/auth')
        const isStatic = request.nextUrl.pathname.startsWith('/_next') ||
            request.nextUrl.pathname.includes('.') ||
            request.nextUrl.pathname.startsWith('/api')

        // 4. Redirect Rules

        // If user is NOT logged in AND trying to access a protected page
        // "Fail Closed": If we have no user (due to no session OR missing envs), BLOCK access.
        if (!user && !isLoginPage && !isAuthCallback && !request.nextUrl.pathname.includes('.')) {
            const loginUrl = request.nextUrl.clone()
            loginUrl.pathname = '/login'
            return NextResponse.redirect(loginUrl)
        }

        // If user IS logged in AND trying to access login page
        if (user && isLoginPage) {
            const dashboardUrl = request.nextUrl.clone()
            dashboardUrl.pathname = '/'
            return NextResponse.redirect(dashboardUrl)
        }

        return response
    } catch (e) {
        console.error("Middleware Error:", e);
        // Fail Safe: If error occurs, assume Not Authenticated and Redirect to Login
        // But safeguard against infinite loop if Login itself causes error?
        // Login page should be excluded from logic or handled above.
        // If we are already on Login page, return response (to allow rendering error)
        if (request.nextUrl.pathname.startsWith('/login')) {
            return NextResponse.next();
        }

        const loginUrl = request.nextUrl.clone()
        loginUrl.pathname = '/login'
        return NextResponse.redirect(loginUrl)
    }
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
