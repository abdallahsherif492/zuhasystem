/** Navigation hints only; database policies remain the authorization boundary. */
export function canOpenPage(path: string, role: string | null, allowed: string[], systemAdmin = false) {
    const normalizedRole = (role || "").trim().toLowerCase().replace(/_/g, " ");
    if (systemAdmin || ["owner", "admin", "platform admin", "super admin"].includes(normalizedRole)) return true;
    if (["/dashboard", "/guide", "/getting-started"].includes(path) || path === "/my-hr" || path.startsWith("/my-hr/")) return true;
    const normalize = (route: string) => route.replace(/^\/easy-orders(?=\/|$)/, "/platform-orders");
    return allowed.some(route => {
        const prefix = normalize(route);
        const target = normalize(path);
        return prefix !== "/" && (target === prefix || target.startsWith(`${prefix}/`));
    });
}
