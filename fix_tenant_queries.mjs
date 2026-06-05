import fs from 'fs';
import path from 'path';

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Pattern to find .select(...) calls.
    // It matches: .select(  "..."  ) or .select(`...`)
    // We want to append .eq("business_id", activeBusiness?.id) if it doesn't already have it.
    
    // Using a regex with a replacer function
    const selectPattern = /\.select\s*\(\s*(['"`][\s\S]*?['"`])\s*\)/g;

    content = content.replace(selectPattern, (match, selectArg, offset) => {
        // Look ahead to see if .eq("business_id" is already there within the next 50 chars
        const lookahead = content.substring(offset + match.length, offset + match.length + 50);
        if (lookahead.includes('.eq("business_id"') || lookahead.includes(".eq('business_id'")) {
            return match; // Already has it
        }
        
        // Also ensure this isn't a query on system tables or tables without business_id like support_tickets
        // To do this, look behind to find the table name
        const lookbehind = content.substring(Math.max(0, offset - 100), offset);
        const tableMatch = lookbehind.match(/\.from\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (tableMatch) {
            const table = tableMatch[1];
            // Tables that DO NOT have business_id
            if (['system_admins', 'user_permissions'].includes(table)) {
                return match;
            }
        }

        return match + `.eq("business_id", activeBusiness?.id)`;
    });

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${filePath}`);
    }
}

function walk(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (fullPath.endsWith('.tsx')) {
            processFile(fullPath);
        }
    }
}

walk('src/app/(dashboard)');
