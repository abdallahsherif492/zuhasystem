const fs = require('fs');
let content = fs.readFileSync('src/app/onboarding/page.tsx', 'utf8');

// Insert the quota check right before creating the business
const quotaCheckCode = `
            // Check quota before creating
            const { data: userPerms } = await supabase
                .from('user_permissions')
                .select('max_businesses')
                .eq('email', userEmail)
                .single();

            const maxBusinesses = userPerms?.max_businesses || 1;

            // Check current owned businesses
            const { count: ownedCount } = await supabase
                .from('business_users')
                .select('*', { count: 'exact', head: true })
                .eq('user_email', userEmail)
                .eq('role', 'owner');

            if (ownedCount !== null && ownedCount >= maxBusinesses) {
                setError(\`You have reached the maximum limit of \${maxBusinesses} business profile(s) allowed for your account. Please contact support or upgrade.\`);
                setLoading(false);
                return;
            }

            // 1. Create the business`;

content = content.replace('// 1. Create the business', quotaCheckCode);

fs.writeFileSync('src/app/onboarding/page.tsx', content);
