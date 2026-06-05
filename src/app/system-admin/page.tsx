import { redirect } from "next/navigation";

export default function SystemAdminOverview() {
    // For now, redirect to businesses management
    // We can add a dashboard with charts later
    redirect("/system-admin/businesses");
}
