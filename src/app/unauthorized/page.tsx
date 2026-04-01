import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] space-y-6 text-center">
            <div className="bg-red-100 p-6 rounded-full">
                <ShieldAlert className="h-16 w-16 text-red-600" />
            </div>

            <div className="space-y-2 max-w-md">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Access Denied</h1>
                <p className="text-muted-foreground text-lg">
                    You do not have permission to view this page. If you believe this is a mistake, please contact the administrator.
                </p>
            </div>

            <Link href="/">
                <Button size="lg" className="mt-4">
                    Return to Dashboard
                </Button>
            </Link>
        </div>
    );
}
