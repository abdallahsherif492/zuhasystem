/**
 * Blocking a customer and deleting a chat are for the business's owners only:
 * the owner and the super admin (owner-level), not admins or staff.
 */
export const isOwnerRole = (role: string | null | undefined) =>
    ["owner", "super admin"].includes(String(role || "").trim().toLowerCase().replace(/_/g, " "));
