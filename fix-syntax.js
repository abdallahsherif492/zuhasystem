const fs = require('fs');
let content = fs.readFileSync('src/components/shipping/ShippingManagement.tsx', 'utf8');

// Fix formData initial state
content = content.replace(/rates: \{\},\n\s+is_default: false as Record<string, number>,\n\s+is_default: false/, 'rates: {} as Record<string, number>,\n        is_default: false');

// Fix handleOpenDialog else branch where it had missing is_default
content = content.replace(/setFormData\(\{\n\s+name: "",\n\s+type: "Company",\n\s+phone: "",\n\s+rates: \{\}\n\s+\}\);/, 'setFormData({\n                name: "",\n                type: "Company",\n                phone: "",\n                rates: {},\n                is_default: false\n            });');

// Wait, the index implicitly any error: formData.rates is typed as Record<string, number>. Let's ensure formData.rates is actually defined correctly. Let's just fix the whole top section cleanly.

let topLines = content.split('\n');
let fixedLines = topLines.map(line => line.replace('rates: {},', 'rates: {},').replace('is_default: false as Record<string, number>,', ''));
content = fixedLines.join('\n');

fs.writeFileSync('src/components/shipping/ShippingManagement.tsx', content);
