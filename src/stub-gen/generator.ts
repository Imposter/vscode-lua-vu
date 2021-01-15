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
    IDocLibrary
} from './doc-type';

import { promisify } from 'util';
import { glob } from 'glob';
import { load } from 'js-yaml';
import { existsSync, promises as fs } from 'fs';
import { EOL } from 'os';
import { join } from 'path';

const globAsync = promisify(glob);

function _LT(type: string) {
    if (type == 'int' || type == 'float') return 'number';
    if (type == 'bool') return 'boolean';
    if (type == 'callable') return 'function';
    return type;
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
    }

    // Indicate default value
    if (opts.default) {
        comments.push(`Default: ${opts.default}`)
    }

    // Add the description at the end of the comment
    if (t.description) {
        comments.push(t.description);
    }

    // Add the comments to the code
    if (comments.length > 0) {
        code += ` @ ${comments.join(' | ')}`; // pp 👀
    }

    return code;
}

function generateDocProperty(name: string, p: IDocProperty, comments?: string[]) {
    let code = ``;

    // Write field doc comment
    code += `---@field ${name} `;
    if (p.array) {
        code += `vector`; // EASTL Vector
    } else if (p.table) {
        code += `${_LT(p.type)}[]`; // Lua table
    } else if (p.nestedArray) {
        // TODO: Implement
    } else if (p.nestedTable) {
        // TODO: Implement
    } else {
        code += `${_LT(p.type)}`;
    }

    if (p.nullable) {
        code += '|nil';
    }

    // Generate and add comment for parameter
    code += generateTypeComment(p, { comments: comments, readOnly: p.readOnly });

    return code;
}

function generateDocParam(name: string, p: IDocParam) {
    let code = ``;

    // variadic arguments are specified differently
    if (p.variadic) {
        code += `---@letarg ${_LT(p.type)}`;
    } else {
        // Write param doc comment
        code += `---@param ${name} `;
        if (p.array) {
            code += `vector`; // EASTL Vector
        } else if (p.table) {
            code += `${_LT(p.type)}[]`; // Lua table
        } else if (p.nestedArray) {
            // TODO: Implement
        } else if (p.nestedTable) {
            // TODO: Implement
        } else {
            code += `${_LT(p.type)}`;
        }

        if (p.nullable) {
            code += '|nil';
        }
    }

    // Generate and add comment for parameter
    code += generateTypeComment(p, { readOnly: p.readOnly, default: p.default });

    return code;
}

function generateDocReturn(r: IDocType, comments?: string[]) {
    let code = ``;

    // Write return doc comment
    code += `---@return `;
    if (r.array) {
        code += `vector`; // EASTL Vector
    } else if (r.table) {
        code += `${_LT(r.type)}[]`; // Lua table
    } else if (r.nestedArray) {
        // TODO: Implement
    } else if (r.nestedTable) {
        // TODO: Implement
    } else {
        code += `${_LT(r.type)}`;
    }

    if (r.nullable) {
        code += '|nil';
    }

    // Generate and add comment for parameter
    code += generateTypeComment(r, { comments: comments });

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
    code += `function ${name}(${Object.keys(c?.params || {}).join(', ')}) end`;

    return code;
}

function generateMethod(name: string, m: IDocMethod, comments?: string[]) {
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

    // Write function stub
    code += `function ${name}:${m.name}(${Object.keys(m?.params || {}).join(', ')}) end`;

    return code;
}

function visitEnum(e: IDocEnum, comments?: string[]): string {
    return generateSection('Enum', () => {
        let code = ``;
        
        // Generate enum and constant code
        code += `---@class ${e.name}` + EOL;
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
        if (c.staticProperties) {
            for (let [name, prop] of Object.entries(c.staticProperties)) {
                code += generateDocProperty(name, prop, [ "Static" ]) + EOL;
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
                    code += generateMethod(c.name, m, comments) + EOL + EOL;
                }
            }
            
            return code;
        });
        code += EOL;

        // TODO: Generate operators (?)

        return code;
    });
}

function visitLibrary(l: IDocLibrary, comments?: string[]): string {
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
                    code += generateMethod(l.name, m, comments) + EOL + EOL;
                }
            }
            
            return code;
        });
        code += EOL;

        // TODO: Generate operators (?)

        return code;
    });
}

function visit(data: IDocument, kind: string, comments?: string[]): string {
    // Add header
    let code = generateHeader(data.name, data.type, kind) + EOL;

    if (data.type == 'enum') {
        code += visitEnum(data as IDocEnum, comments);
    } else if (data.type == 'class') {
        code += visitClass(data as IDocClass, comments);
    } else if (data.type == 'library') {
        code += visitLibrary(data as IDocLibrary, comments);
    } else {
        throw new Error(`unknown document type ${data.type}`);
    }

    return code;
}

async function generateTypes(docsPath: string, outPath: string, path: string, kind: string, comments?: string[]) {
    // Read all files in directory
    let filePaths = await globAsync(join(docsPath, path, '*.yaml'));

    // Generate code for all the defined classes/libraries
    for (let filePath of filePaths) {
        // Read document
        let buffer = await fs.readFile(filePath);
        let document = load(buffer.toString()) as IDocument;
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
}

export async function generate(docsPath: string, outPath: string) {
    // Generate types
    await generateTypes(docsPath, outPath, 'fb', 'Frostbite', [ '`SERVER/CLIENT`' ]);
    await generateTypes(docsPath, outPath, 'shared/type', 'Shared', [ '`SERVER/CLIENT`' ]);
    await generateTypes(docsPath, outPath, 'server/type', 'Server', [ '`SERVER ONLY`' ]);
    await generateTypes(docsPath, outPath, 'client/type', 'Client', [ '`CLIENT ONLY`' ]);
    
    await generateTypes(docsPath, outPath, 'shared/library', 'Shared', [ '`SERVER/CLIENT`' ]);
    await generateTypes(docsPath, outPath, 'server/library', 'Server', [ '`SERVER ONLY`' ]);
    await generateTypes(docsPath, outPath, 'client/library', 'Client', [ '`CLIENT ONLY`' ]);
}