import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    // 1. Create Supabase Client to check Auth
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
    const {
        data: { user },
    } = await supabase.auth.getUser()

    // 3. Define Protected Logic
    const isLoginPage = request.nextUrl.pathname.startsWith('/login')
    const isAuthCallback = request.nextUrl.pathname.startsWith('/auth')
    const isStatic = request.nextUrl.pathname.startsWith('/_next') ||
        request.nextUrl.pathname.includes('.') || // images, logo.png etc
        request.nextUrl.pathname.startsWith('/api') // allow api if needed, or protect it too. usually protect api.

    // 4. Redirect Rules

    // If user is NOT logged in AND trying to access a protected page
    if (!user && !isLoginPage && !isAuthCallback && !request.nextUrl.pathname.includes('.')) {
        // Redirect to Login
        const loginUrl = request.nextUrl.clone()
        loginUrl.pathname = '/login'
        return NextResponse.redirect(loginUrl)
    }

    // If user IS logged in AND trying to access login page
    if (user && isLoginPage) {
        // Redirect to Dashboard
        const dashboardUrl = request.nextUrl.clone()
        dashboardUrl.pathname = '/'
        return NextResponse.redirect(dashboardUrl)
    }

    return response
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
