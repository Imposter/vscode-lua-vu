import { 
    IDocument,
    IDocType,
    IDocParam,
    IDocProperty,
    IDocMethod,
    IDocConstructor,
    IDocOperator,
    IDocClass,
    IDocEnum,
    IDocLibrary,
    IDocEvent,
    IDocHook
} from './doc-type';

import { promisify } from 'util';
import { glob } from 'glob';
import { load } from 'js-yaml';
import { existsSync, promises as fs } from 'fs';
import { EOL } from 'os';
import { join } from 'path';

const globAsync = promisify(glob);

function _LT(type: string) {
    if (type == 'int') return 'integer';
    if (type == 'float') return 'number';
    if (type == 'bool') return 'boolean';
    if (type == 'callable') return 'function';
    return type;
}

function _LOT(operatorType: string) {
    if (operatorType == 'add') return 'add';
    if (operatorType == 'sub') return 'sub';
    if (operatorType == 'mult') return 'mul';
    if (operatorType == 'div') return 'div';
    if (operatorType == 'mod') return 'mod';
    return null;
}

function generateHeader(name: string, type: string, kind: string) {
    let code = ``;

    // Generate header for each file with name/type and kind
    code += `--[[`                                                              + EOL;
    code += `    Venice Unleashed - Lua bindings`                               + EOL;
    code += `    Type: ${name} (${kind} ${type})`                               + EOL;
    code += `    Website: https://veniceunleashed.net`                          + EOL;
    code += `    Generated on: ${new Date()}`                                   + EOL;
    code += ``                                                                  + EOL;
    code += `    For more information, see: https://docs.veniceunleashed.net`   + EOL;
    code += `--]]`                                                              + EOL;
    code += ``                                                                  + EOL;
    code += `---@meta`                                                          + EOL;

    return code;
}

function generateSection(name: string, callback: () => string) {
    let code = ``;

    // Generate region code
    code += `--region ${name}` + EOL + EOL;
    code += callback() + EOL + EOL;
    code += `--endregion ${name}` + EOL;

    return code;
}

function generateTypeComment(t: IDocType, opts?: { comments?: string[], readOnly?: boolean, default?: any }) {
    let code = ``;

    // Create default arguments if none were provided
    opts = opts || {};

    // Create a copy of the provided comments since we'll be adding to them
    let comments = opts.comments ? opts.comments.slice() : [];

    // Indicate that the type is read-only in the comments
    if (opts.readOnly) {
        comments.push('**Read Only**');
    }

    // Indicate if the type is an EASTL vector
    if (t.array) {
        comments.push(`**Vector Type: \`${t.type}\`**`);
        comments.push('**Cannot be instantiated directly**');
    }

    // Indicate default value
    if (opts.default) {
        comments.push(`Default: ${opts.default}`)
    }

    // Add the description at the end of the comment
    if (t.description) {
        let descriptions = t.description.split('\n').filter(s => s.trim().length > 0);
        for (let description of descriptions) {
            comments.push(description);
        }
    }

    // Add the comments to the code
    if (comments.length > 0) {
        code += ` @ ${comments.join(' | ')}`;
    }

    return code;
}

function generateTypeString(t: IDocType, opts?: { nullable?: boolean, default?: boolean }) {
    let code = ``;
    if (t.array) {
        if (t.nestedArray) {
            code += `vector|vector[]|${_LT(t.type)}[][]>`; // nestedArray
        } else if (t.nestedTable) {
            code += `vector|table<integer, ${_LT(t.type)}[]>`; // nestedTable
        } else {
            code += `vector|${_LT(t.type)}[]`; // EASTL Vector
        }
    } else if (t.table) {
        if (t.nestedArray) {
            code += `table<integer, vector|${_LT(t.type)}[]>`; // nestedArray
        } else if (t.nestedTable) {
            code += `table<integer, table<integer, ${_LT(t.type)}>>`; // nestedTable
        } else {
            code += `table<integer, ${_LT(t.type)}>`; // Lua table
        }
    } else {
        code += `${_LT(t.type)}`;
    }

    if (opts?.nullable || opts?.default) {
        code += '|nil';
    }

    return code;
}

function generateDocFuncType(m: IDocMethod, callableParamToMethodFunc: (p: IDocParam) => IDocMethod | null) {
    // Generate the overload comment
    let code = `fun(`;

    // Generate all parameters
    if (m.params) {
        let names = Object.keys(m.params);
        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            let param = m.params[name];

            if (param.type == 'callable') {
                let method = callableParamToMethodFunc(param);
                if (method == null) {
                    code += `${name}: ${generateTypeString(param)}`;
                } else {
                    code += `${name}: ${generateDocFuncType(method, callableParamToMethodFunc)}`;
                }
            } else {
                code += `${name}: ${generateTypeString(param)}`;
            }

            if (i != names.length - 1) code += ', ';
        }
    }

    // Generate the return parameter
    if (m.returns) {
        if (Array.isArray(m.returns)) {
            throw new Error(`Multiple returns are not supported for func types`);
        }

        code += '): ' + generateTypeString(m.returns);
    } else {
        code += ')';
    }

    return code;
}

function generateDocProperty(name: string, p: IDocProperty, comments?: string[]) {
    let code = ``;

    // Write field doc comment
    code += `---@field ${name} `;
    code += generateTypeString(p, { nullable: p.nullable });

    // Generate and add comment for parameter
    code += generateTypeComment(p, { comments: comments, readOnly: p.readOnly });

    return code;
}

function generateDocOperator(op: IDocOperator) {
    let code = ``;

    // Write operator doc comment
    let operatorType = _LOT(op.type);
    if (operatorType == null) {
        return `-- WARNING: Operator type not supported: ${op.type} (rhs: ${op.rhs}, returns: ${op.returns})`;
    }

    code += `---@operator ${operatorType}(${_LT(op.rhs)}): ${_LT(op.returns)}`;

    return code;
}

function generateDocParam(name: string, p: IDocParam) {
    let code = ``;

    // variadic arguments are specified differently
    if (p.variadic) {
        code += `---@vararg ${_LT(p.type)}`;
    } else {
        // Write param doc comment
        code += `---@param ${name} `;
        code += generateTypeString(p, { nullable: p.nullable, default: p.default != null });
    }

    // Generate and add comment for parameter
    code += generateTypeComment(p, { readOnly: p.readOnly, default: p.default });

    return code;
}

function generateDocReturn(returns: IDocType | IDocType[], comments?: string[]) {
    let code = ``;

    // If the return meta data is an array, then we need to write out each return type
    if (Array.isArray(returns)) {
        for (let i = 0; i < returns.length; i++) {
            let r = returns[i];
            code += generateDocReturn(r, comments);
            if (i != returns.length - 1) {
                code += EOL;
            }
        }
    } else {
        // Write return doc comment
        let r = returns as IDocType;
        code += `---@return `;
        code += generateTypeString(r, { nullable: r.nullable });

        // Generate and add comment for parameter
        code += generateTypeComment(r, { comments: comments });
    }

    return code;
}

function generateDocOverload(m: IDocMethod, callableParamToMethodFunc: (p: IDocParam) => IDocMethod | null) {
    let code = `---@overload `;

    code += generateDocFuncType(m, callableParamToMethodFunc);

    return code;
}

function generateFuncStub(name: string, params: { [name: string]: IDocParam }) {
    // Open func
    var code = `function ${name}(`;
    
    // Generate parameter code
    let names = Object.keys(params);
    for (let i = 0; i < names.length; i++) {
        let name = names[i];
        let param = params[name];

        if (param.variadic) code += '...';
        else code += name;
        if (i != names.length - 1) code += ', ';
    }
    
    // Close func
    code += `) end`;

    return code;
}

function generateConstructor(name: string, c: IDocConstructor, comments?: string[]) {
    let code = ``;

    // Write comment
    code += `---${name} constructor` + EOL;

    // Write additional comments
    if (comments) {
        code += comments.map(s => `---${s}`).join(EOL) + EOL;
    }

    // Write constructor description if one was provided
    if (c != null && c.description) {
        code += c.description.split('\n').filter(s => s.trim().length > 0).map(s => `---${s}`).join(EOL) + EOL;
    }

    // Only generate parameter documentation for non-default constructors
    if (c != null && c.params != null) {
        // Write parameters
        for (let [n, param] of Object.entries(c.params)) {
            code += generateDocParam(n, param) + EOL;
        }
    }

    // Write return statement
    code += generateDocReturn({ type: name }) + EOL;

    // Write function stub
    code += generateFuncStub(name, c?.params || {});

    return code;
}

function generateMethod(name: string, m: IDocMethod, comments?: string[], miscDocs?: string[]) {
    let code = ``;

    // Write additional comments
    if (comments) {
        code += comments.map(s => `---${s}`).join(EOL) + EOL;
    }

    // Write comment
    if (m.description) {
        code += m.description.split('\n').filter(s => s.trim().length > 0).map(s => `---${s}`).join(EOL) + EOL;
    }

    // Write parameters
    if (m.params) {
        for (let [n, param] of Object.entries(m.params)) {
            code += generateDocParam(n, param) + EOL;
        }
    }
    
    // Write return statement
    if (m.returns) {
        code += generateDocReturn(m.returns) + EOL;
    }

    // Write misc docs
    if (miscDocs && miscDocs.length > 0) {
        code += miscDocs.join(EOL) + EOL;
    }

    // Write function stub
    code += generateFuncStub(`${name}:${m.name}`, m?.params || {});

    return code;
}

function visitEnum(e: IDocEnum, comments?: string[]): string {
    return generateSection('Enum', () => {
        let code = ``;
        
        // Generate enum and constant code
        code += `---@enum ${e.name}` + EOL;
        code += `---${e.name} (Enum)` + EOL;
        
        // Write additional comments
        if (comments) {
            code += comments.map(s => `---${s}`).join(EOL) + EOL;
        }

        code += `${e.name} = {` + EOL;
        for (let [n, cons] of Object.entries(e.values)) {
            code += `\t${n} = ${cons.value},` + EOL;
        }
        code += `}`;

        return code;
    });
}

function visitClass(c: IDocClass, comments?: string[]): string {
    return generateSection('Class', () => {
        let code = ``;

        // Generate class
        if (c.inherits) {
            code += `---@class ${c.name}:${c.inherits}` + EOL;
        } else {
            code += `---@class ${c.name}` + EOL;
        }

        // Generate properties
        if (c.properties) {
            for (let [name, prop] of Object.entries(c.properties)) {
                code += generateDocProperty(name, prop) + EOL;
            }
        }

        // Generate static properties
        if (c.static) {
            for (let [name, prop] of Object.entries(c.static)) {
                code += generateDocProperty(name, prop, [ "Static" ]) + EOL;
            }
        }

        // Generate operators
        if (c.operators) {
            for (let op of c.operators) {
                code += generateDocOperator(op) + EOL;
            }
        }
        
        // Append class definition
        code += `---${c.name} (Class)` + EOL;
        code += `${c.name} = {}` + EOL + EOL;

        // Generate constructors
        code += generateSection('Constructors', () => {
            let code = ``;

            // Generate code for constructors
            if (c.constructors) {
                for (let cons of c.constructors) {
                    code += generateConstructor(c.name, cons, comments) + EOL + EOL;
                }
            }
            
            return code;
        });
        code += EOL;

        // Generate methods
        code += generateSection('Methods', () => {
            let code = ``;

            // Generate code for methods
            if (c.methods) {
                for (let m of c.methods) {
                    code += generateMethod(c.name, m, comments, []) + EOL + EOL;
                }
            }
            
            return code;
        });
        code += EOL;

        return code;
    });
}

function visitLibrary(l: IDocLibrary, items: IDocument[], miscGeneratorFunc: (m: IDocMethod, items: IDocument[]) => string[], comments?: string[]): string {
    return generateSection('Library', () => {
        let code = ``;

        // Generate class from library
        code += `---@class ${l.name}` + EOL;

        // Append class definition
        code += `---${l.name} (Library)` + EOL;
        code += `${l.name} = {}` + EOL + EOL;

        // Generate methods
        code += generateSection('Methods', () => {
            let code = ``;

            // Generate code for methods
            if (l.methods) {
                for (let m of l.methods) {                    
                    let miscDocs = miscGeneratorFunc(m, items);

                    code += generateMethod(l.name, m, comments, miscDocs) + EOL + EOL;
                }
            }
            
            return code;
        });
        code += EOL;

        return code;
    });
}

// TODO: See if we can make this read nicer and have a better name. Also apply this code to hooks
function getEventsMethodOverloads(m: IDocMethod, events: IDocEvent[]): string[] {
    if (m.name != 'Subscribe') return [];

    let overloads = [];
    for (let event of events) {
        // Generate method parameters
        let overloadMethod: IDocMethod = {
            name: m.name,
            params: {
                self: { type: 'Events' },
                eventName: { type: `"${event.name}"` },
                context: { type: 'any' },
                callback: { type: 'callable' }
            },
            returns: { type: 'Event' }
        };

        if (m.params['context'] == null) {
            delete overloadMethod.params['context'];
        }

        let overloadComment = generateDocOverload(overloadMethod, (p: IDocParam) => {
            let method: IDocMethod = {
                name: "N/A",
                description: "N/A",
                params: {
                    userData: { type: 'any' },
                }
            };

            if (event.params) {
                if (m.params['context'] == null) {
                    delete method.params['userData'];
                }

                for (let [n, param] of Object.entries(event.params)) {
                    method.params[n] = param;
                }
            }

            return method;
        });

        overloads.push(overloadComment);
    }


    return overloads;
}

function getHooksMethodOverloads(m: IDocMethod, hooks: IDocHook[]): string[] {
    let overloads = [];
    for (let hook of hooks) {
        if (m.name != 'Install' || m.params == null || m.params['hookName'] == null || m.params['callback'] == null) continue;

        // Generate the overload comment
        let overloadComment = `---@overload fun(self: Hooks, eventName: '"${hook.name}"'`;
       
        // Generate all parameters except callback
        for (let [n, param] of Object.entries(m.params)) {
            if (n == 'hookName' || n == 'callback') continue;
            overloadComment += `, ${n}: ${generateTypeString(param)}`;
        }

        // Generate the callback parameter
        overloadComment += `, callback: fun(hookCtx: HookContext, `;
        if (hook.params) {
            let names = Object.keys(hook.params);
            for (let i = 0; i < names.length; i++) {
                let name = names[i];
                let param = hook.params[name];

                overloadComment += `${name}: ${generateTypeString(param)}`;
                if (i != names.length - 1) overloadComment += ', ';
            }
        }
        overloadComment += ')';
        if (hook.returns) {
            if (Array.isArray(hook.returns)) {
                throw new Error(`Multiple returns are not supported for hooks`);
            }

            overloadComment += `: ${generateTypeString(hook.returns)}`;
        }

        overloadComment += '): Hook';

        overloads.push(overloadComment);
    }

    return overloads;
}

function visit(data: IDocument, kind: string, comments?: string[]): string {
    // Add header
    let code = generateHeader(data.name, data.type, kind) + EOL;

    if (data.type == 'enum') {
        code += visitEnum(data as IDocEnum, comments);
    } else if (data.type == 'class') {
        code += visitClass(data as IDocClass, comments);
    } else if (data.type == 'library') {
        code += visitLibrary(data as IDocLibrary, [], (_1, _2) => [], comments);
    } else {
        throw new Error(`unknown document type ${data.type}`);
    }

    return code;
}

async function readDocument(docsPath: string, path: string, doc: string): Promise<IDocument> {
    // Read document
    let filePath = join(docsPath, path, `${doc}.yaml`);
    let buffer = await fs.readFile(filePath);
    let document = load(buffer.toString()) as IDocument;

    return document;
}

async function readDocumentsInPath(docsPath: string, path: string): Promise<IDocument[]> {
    // Read all files in directory
    let filePaths = await globAsync(join(docsPath, path, '*.yaml'));

    // Read all documents
    let documents: IDocument[] = [];
    for (let filePath of filePaths) {
        let doc = filePath.split('/').pop()!.split('.')[0];
        let document = await readDocument(docsPath, path, doc);
        documents.push(document);
    }

    return documents;
}

async function generateLibrary(docsPath: string, outPath: string, path: string, kind: string, libType: string, miscGeneratorFunc: (m: IDocMethod, items: IDocument[]) => string[], comments?: string[]) {
    console.log(`Generating ${kind} code for ${libType}s library...`);

    // Read document
    let document = await readDocument(docsPath, join('shared', 'library'), `${libType}s`);

    if (document.type != 'library') {
        throw new Error(`expected document type library, got ${document.type}`);
    }

    // Read all dependencies
    let dependencies = (await readDocumentsInPath(docsPath, join(path, libType.toLowerCase()))).filter(d => d.type == libType.toLowerCase());
    
    // Add header
    let code = generateHeader(document.name, document.type, kind) + EOL;

    // Generate code
    code += visitLibrary(document as IDocLibrary, dependencies, miscGeneratorFunc, comments);

    // Ensure the output path exists
    let pathDir = join(outPath, path, 'library')        
    if (!existsSync(pathDir))
        await fs.mkdir(pathDir, { recursive: true });

    // Write code
    await fs.writeFile(join(pathDir, `${libType}s.lua`), code);
}

async function generateTypesForDoc(docsPath: string, outPath: string, path: string, doc: string, kind: string, comments?: string[]) {
    // Read document
    let document = await readDocument(docsPath, path, doc);
    console.log(`Generating ${kind} code for ${document.name}...`);

    // Generate code
    let code = visit(document, kind, comments);

    // Ensure the output path exists
    let pathDir = join(outPath, path)        
    if (!existsSync(pathDir))
        await fs.mkdir(pathDir, { recursive: true });

    // Write code
    await fs.writeFile(join(pathDir, `${document.name}.lua`), code);
}

async function generateTypes(docsPath: string, outPath: string, path: string, excludeDocs: string[], kind: string, comments?: string[]) {
    // Read all files in directory
    let filePaths = await globAsync(join(docsPath, path, '*.yaml'));

    // Generate code for all the defined classes/libraries
    for (let filePath of filePaths) {
        let doc = filePath.split('/').pop()!.split('.')[0];
        if (excludeDocs.includes(doc)) continue;

        await generateTypesForDoc(docsPath, outPath, path, doc, kind, comments);
    }
}

export async function generate(docsPath: string, outPath: string) {
    // Generate types
    await generateTypes(docsPath, outPath, 'fb', [], 'Frostbite', [ '`SERVER/CLIENT`' ]);
    await generateTypes(docsPath, outPath, 'shared/type', [], 'Shared', [ '`SERVER/CLIENT`' ]);
    await generateTypes(docsPath, outPath, 'server/type', [], 'Server', [ '`SERVER ONLY`' ]);
    await generateTypes(docsPath, outPath, 'client/type', [], 'Client', [ '`CLIENT ONLY`' ]);
    
    await generateTypes(docsPath, outPath, 'shared/library', [ 'Events', 'Hooks' ], 'Shared', [ '`SERVER/CLIENT`' ]);
    await generateTypes(docsPath, outPath, 'server/library', [], 'Server', [ '`SERVER ONLY`' ]);
    await generateTypes(docsPath, outPath, 'client/library', [], 'Client', [ '`CLIENT ONLY`' ]);

    // Generate events
    await generateLibrary(docsPath, outPath, 'shared', 'Shared', 'Event', getEventsMethodOverloads, [ '`SERVER/CLIENT`' ]);
    await generateLibrary(docsPath, outPath, 'server', 'Server', 'Event', getEventsMethodOverloads, [ '`SERVER ONLY`' ]);
    await generateLibrary(docsPath, outPath, 'client', 'Client', 'Event', getEventsMethodOverloads, [ '`CLIENT ONLY`' ]);

    // Generate hooks
    await generateLibrary(docsPath, outPath, 'shared', 'Shared', 'Hook', getHooksMethodOverloads, [ '`SERVER/CLIENT`' ]);
    await generateLibrary(docsPath, outPath, 'server', 'Server', 'Hook', getHooksMethodOverloads, [ '`SERVER ONLY`' ]);
    await generateLibrary(docsPath, outPath, 'client', 'Client', 'Hook', getHooksMethodOverloads, [ '`CLIENT ONLY`' ]);
}
