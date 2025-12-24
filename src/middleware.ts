import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    try {
        let response = NextResponse.next({
            request: {
                headers: request.headers,
            },
        })

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            console.warn("Middleware: Missing Supabase Env Vars");
            // If envs are missing, we can't check auth. Allow request or block? 
            // Better to allow to avoid blocking everything on misconfig, but usually this is fatal.
            // Let's return response to avoid 500 loop.
            return response;
        }

        // 1. Create Supabase Client to check Auth
        const supabase = createServerClient(
            supabaseUrl,
            supabaseKey,
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
            request.nextUrl.pathname.includes('.') || // images, logo.png etc
            request.nextUrl.pathname.startsWith('/api')

        // 4. Redirect Rules

        // If user is NOT logged in AND trying to access a protected page
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
        // If something breaks in middleware, we don't want to 500 the whole site if possible, 
        // but typically middleware errors are fatal. 
        // However, returning NextResponse.next() allows the request to proceed to the page 
        // which might handle it or show a better error.
        console.error("Middleware Error:", e);
        return NextResponse.next({
            request: {
                headers: request.headers,
            },
        });
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
