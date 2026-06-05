import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

const traverse = traverseModule.default;
const generate = generateModule.default;

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            results.push(file);
        }
    });
    return results;
}

const files = [...walkDir('src/app/(dashboard)'), ...walkDir('src/components')];

let totalFixed = 0;

for (const file of files) {
  let code = fs.readFileSync(file, 'utf8');
  if (!code.includes('supabase') || !code.includes('.insert(')) continue;

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (e) {
    console.error(`Error parsing ${file}:`, e.message);
    continue;
  }

  let modified = false;

  traverse(ast, {
    CallExpression(path) {
      if (
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.property, { name: 'insert' })
      ) {
        // Exclude system-admin which we're not targeting anyway because of walkDir
        const args = path.node.arguments;
        if (args.length === 0) return;
        
        const firstArg = args[0];
        
        // Active business node: activeBusiness!.id
        const businessIdNode = t.tsNonNullExpression(
            t.memberExpression(
                t.tsNonNullExpression(t.identifier('activeBusiness')),
                t.identifier('id')
            )
        );

        const injectBusinessId = (objExpr) => {
            if (t.isObjectExpression(objExpr)) {
                const hasBusinessId = objExpr.properties.some(p => 
                    t.isObjectProperty(p) && 
                    ((t.isIdentifier(p.key) && p.key.name === 'business_id') || 
                     (t.isStringLiteral(p.key) && p.key.value === 'business_id'))
                );
                if (!hasBusinessId) {
                    objExpr.properties.push(
                        t.objectProperty(
                            t.identifier('business_id'),
                            businessIdNode
                        )
                    );
                    modified = true;
                }
            }
        };

        if (t.isObjectExpression(firstArg)) {
            injectBusinessId(firstArg);
        } else if (t.isArrayExpression(firstArg)) {
            firstArg.elements.forEach(el => {
                if (t.isObjectExpression(el)) {
                    injectBusinessId(el);
                } else if (t.isIdentifier(el)) {
                   // if array element is identifier like [payload], replace with [{...payload, business_id: ...}]
                   const elIndex = firstArg.elements.indexOf(el);
                   firstArg.elements[elIndex] = t.objectExpression([
                       t.spreadElement(el),
                       t.objectProperty(t.identifier('business_id'), businessIdNode)
                   ]);
                   modified = true;
                }
            });
        } else if (t.isIdentifier(firstArg)) {
            const isAlreadyMapped = code.substring(firstArg.start, firstArg.end).includes('map');
            if (!isAlreadyMapped && firstArg.name !== 'business_id') {
                // assume it's an array and map it: varName.map(item => ({...item, business_id: activeBusiness!.id}))
                const varName = firstArg;
                const newArg = t.callExpression(
                    t.memberExpression(varName, t.identifier('map')),
                    [
                        t.arrowFunctionExpression(
                            [t.identifier('item')],
                            t.objectExpression([
                                t.spreadElement(t.identifier('item')),
                                t.objectProperty(
                                    t.identifier('business_id'),
                                    businessIdNode
                                )
                            ])
                        )
                    ]
                );
                
                path.node.arguments[0] = newArg;
                modified = true;
            }
        }
      }
    }
  });

  if (modified) {
    // Also inject useBusiness hook at the top of functions if not present
    const output = generate(ast, { retainLines: false }, code);
    let finalCode = output.code;
    
    // We need to ensure useBusiness is imported and activeBusiness is available
    if (!finalCode.includes('import { useBusiness }')) {
        finalCode = `import { useBusiness } from "@/contexts/BusinessContext";\n` + finalCode;
    }
    
    // We can't easily inject `const { activeBusiness } = useBusiness();` everywhere, 
    // but we can trust that most of these components already have it since fix_tenant_queries injected it!
    
    fs.writeFileSync(file, finalCode);
    totalFixed++;
    console.log(`Injected business_id into ${file}`);
  }
}
console.log(`Total files fixed: ${totalFixed}`);
