const fs = require('fs');
let content = fs.readFileSync('src/components/ui/logout-button.tsx', 'utf8');

content = content.replace(
    'export function LogoutButton() {',
    'import { ButtonProps } from "@/components/ui/button";\n\nexport function LogoutButton({ className, variant = "ghost", size }: ButtonProps) {'
);

content = content.replace(
    '<Button variant="ghost" onClick={handleLogout} className="text-red-600 hover:text-red-700 hover:bg-red-50">',
    '<Button variant={variant} size={size} onClick={handleLogout} className={className || "text-red-600 hover:text-red-700 hover:bg-red-50"}>'
);

fs.writeFileSync('src/components/ui/logout-button.tsx', content);
