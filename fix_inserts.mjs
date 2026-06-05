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
        if (file === 'node_modules' || file === '.next' || file === 'public') return;
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

const files = walkDir('src');

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
        const args = path.node.arguments;
        if (args.length === 0) return;
        
        const firstArg = args[0];
        
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
                            t.memberExpression(
                                t.identifier('activeBusiness'),
                                t.identifier('id'),
                                false,
                                true // optional chaining activeBusiness?.id
                            )
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
                }
            });
        } else if (t.isIdentifier(firstArg)) {
            const isAlreadyWrapped = code.substring(firstArg.start, firstArg.end).includes('activeBusiness');
            if (!isAlreadyWrapped) {
                const varName = firstArg;
                const newArg = t.conditionalExpression(
                    t.callExpression(t.memberExpression(t.identifier('Array'), t.identifier('isArray')), [varName]),
                    t.callExpression(t.memberExpression(varName, t.identifier('map')), [
                        t.arrowFunctionExpression(
                            [t.identifier('p')],
                            t.objectExpression([
                                t.spreadElement(t.identifier('p')),
                                t.objectProperty(
                                    t.identifier('business_id'),
                                    t.memberExpression(t.identifier('activeBusiness'), t.identifier('id'), false, true)
                                )
                            ])
                        )
                    ]),
                    t.objectExpression([
                        t.spreadElement(varName),
                        t.objectProperty(
                            t.identifier('business_id'),
                            t.memberExpression(t.identifier('activeBusiness'), t.identifier('id'), false, true)
                        )
                    ])
                );
                
                path.node.arguments[0] = newArg;
                modified = true;
            }
        }
      }
    }
  });

  if (modified) {
    const output = generate(ast, { retainLines: false }, code);
    fs.writeFileSync(file, output.code);
    totalFixed++;
    console.log(`Injected business_id into ${file}`);
  }
}
console.log(`Total files fixed: ${totalFixed}`);
