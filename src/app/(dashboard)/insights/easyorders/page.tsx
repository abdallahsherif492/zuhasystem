import { redirect } from "next/navigation";

export default function LegacyEasyOrdersInsightsRedirect() {
    redirect("/insights/platform-orders");
}
