import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 routing-middleware (renamed from `middleware` to `proxy` in
 * Next.js 16). The function runs before every matching request, refreshing
 * the Supabase session cookies and protecting authenticated routes.
 *
 * The auth-refresh logic itself lives in lib/supabase/middleware.ts — that
 * naming is intentional and unrelated to Next.js's framework rename.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (build assets)
     * - _next/image (image optimization)
     * - favicon.ico
     * - static files (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
