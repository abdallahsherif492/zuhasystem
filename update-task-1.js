const fs = require('fs');
let content = fs.readFileSync('/Users/abdallahsmacbook/.gemini/antigravity/brain/3bae6dec-f3dd-4bb9-a76f-014871efa4ad/task.md', 'utf8');
content = content.replace('- `[ ]` **Database Migration**', '- `[/]` **Database Migration**');
fs.writeFileSync('/Users/abdallahsmacbook/.gemini/antigravity/brain/3bae6dec-f3dd-4bb9-a76f-014871efa4ad/task.md', content);
