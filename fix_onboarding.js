const fs = require('fs');
let content = fs.readFileSync('src/app/onboarding/page.tsx', 'utf8');

// Add LogOut to lucide imports
content = content.replace(
    'import { Loader2, Store, CheckCircle2 } from "lucide-react";',
    'import { Loader2, Store, CheckCircle2, LogOut, ArrowRight } from "lucide-react";'
);

// Add handlers
content = content.replace(
    '    const handleCreateBusiness = async (e: React.FormEvent) => {',
    `    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    const handleSkip = () => {
        localStorage.setItem('skipOnboarding', 'true');
        window.location.href = "/dashboard";
    };

    const handleCreateBusiness = async (e: React.FormEvent) => {`
);

// Replace footer
const newFooter = `
                        <CardFooter className="flex flex-col gap-3">
                            <Button type="submit" className="w-full h-12 text-lg" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                Launch My Business
                            </Button>
                            
                            <div className="flex gap-2 w-full mt-2">
                                <Button type="button" variant="outline" className="flex-1" onClick={handleSkip} disabled={loading}>
                                    Skip to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" className="flex-none text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleLogout} disabled={loading}>
                                    <LogOut className="h-5 w-5" />
                                </Button>
                            </div>
                        </CardFooter>
`;

content = content.replace(
    /<CardFooter>[\s\S]*?<\/CardFooter>/,
    newFooter
);

fs.writeFileSync('src/app/onboarding/page.tsx', content);
