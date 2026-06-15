const fs = require('fs');
let content = fs.readFileSync('src/components/shipping/ShippingManagement.tsx', 'utf8');

// 1. Add is_default to ShippingCompany
content = content.replace('active: boolean;', 'active: boolean;\n    is_default?: boolean;');

// 2. Add Switch import
content = content.replace('import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";', 'import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";\nimport { Switch } from "@/components/ui/switch";');

// 3. Add to formData
content = content.replace('rates: {} as Record<string, number>', 'rates: {} as Record<string, number>,\n        is_default: false');

// 4. Update handleOpenDialog
content = content.replace(
    'rates: company.rates || {}',
    'rates: company.rates || {},\n                is_default: company.is_default || false'
);
content = content.replace(
    'rates: {}',
    'rates: {},\n                is_default: false'
);

// 5. Update handleSave
const handleSaveStart = 'const payload = {';
const handleSaveReplacement = `
            if (formData.is_default) {
                // Unset all other defaults first
                await supabase
                    .from('shipping_companies')
                    .update({ is_default: false })
                    .eq('business_id', activeBusiness!.id);
            }

            const payload = {`;
content = content.replace(handleSaveStart, handleSaveReplacement);

content = content.replace(
    'rates: formData.rates',
    'rates: formData.rates,\n                is_default: formData.is_default'
);

// 6. Update UI: Show Default badge
content = content.replace(
    '<Badge variant={company.active ? "default" : "secondary"}>\n                                        {company.active ? "Active" : "Inactive"}\n                                    </Badge>',
    `<Badge variant={company.active ? "default" : "secondary"}>
                                        {company.active ? "Active" : "Inactive"}
                                    </Badge>
                                    {company.is_default && (
                                        <Badge variant="default" className="bg-yellow-500 hover:bg-yellow-600 ml-2">
                                            Default
                                        </Badge>
                                    )}`
);

// 7. Update Dialog UI: Add Switch for Default
const dialogRatesSection = '<div className="space-y-4 border rounded-lg p-4 bg-muted/20">';
const switchUI = `
                        <div className="flex items-center justify-between border rounded-lg p-4 bg-muted/20">
                            <div>
                                <h3 className="font-semibold">Default Shipping Company</h3>
                                <p className="text-sm text-muted-foreground">Use this company's rates to estimate pending/processing orders.</p>
                            </div>
                            <Switch 
                                checked={formData.is_default}
                                onCheckedChange={(checked) => setFormData({ ...formData, is_default: checked })}
                            />
                        </div>

                        `;
content = content.replace(dialogRatesSection, switchUI + dialogRatesSection);

fs.writeFileSync('src/components/shipping/ShippingManagement.tsx', content);
