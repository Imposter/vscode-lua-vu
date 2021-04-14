import { ParserErrorListener, CharStreams, CommonTokenStream, Recognizer, RecognitionException, Token } from 'antlr4ts';
import { ParseTreeListener, ParseTreeWalker } from 'antlr4ts/tree';
import { promises as fs } from 'fs';
import { join } from 'path';
import { EOL } from 'os';

import { LuaLexer, LuaParser, LuaParserListener, StatClassContext, StatFunctionContext } from './parser';

export interface GenerationConfig {
    forceGlobal: boolean;
}

interface LuaParam {
    name: string;
    type: string;
    description?: string;
    variadic?: boolean;
}

interface LuaConstructor {
    description?: string[];
    params: LuaParam[];
}

interface LuaClass {
    name: string;
    inherits?: string;
    constructors: LuaConstructor[];
    global?: boolean; // Indicates whether or not a variable with the class name has already been defined in the global scope
}

class LuaChunkListener implements LuaParserListener {
    private _classes: { [name: string]: LuaClass };

    constructor() {
        this._classes = {};
    }

    getClasses() {
        return this._classes;
    }

    enterStatClass(ctx: StatClassContext) {
        // Get class definition
        let def = ctx.statClassDef();

        // Create a new instance of the class
        let _class = {
            name: ctx.statDocClass()._name.text as string,
            inherits: ctx.statDocClass()._base?.text,
            constructors: [],
            global:  def._varName && !def.LOCAL()
        };

        this._classes[_class.name] = _class;
    }

    // TODO: Eventually replace this with just manually building the parameter list and storing all associated doc strings
    // and plopping them back into the intermediate code file
    exitStatFunction(ctx: StatFunctionContext) {
        let funcName = ctx._def._name.text;
        let funcNameSplit = funcName.split(':');
        if (funcNameSplit.length > 1) {
            let className = funcNameSplit[0]; 
            let funcName = funcNameSplit[1]; 

            // Check if the function name is __init, which would indicate a constructor
            if (funcName == '__init') {
                // Build parameter list
                let params: LuaParam[] = [];

                // First store any function definitions that we have regardless of them
                // having any doc strings or not. This is done so we can always maintain
                // a valid list of all parameters regardless of the user specifying
                // documentation for them or not
                let funcBody = ctx.statFunctionDef().funcBody();
                let parList = funcBody.parList();
                if (parList) {
                    // Store any named parameters
                    let nameList = parList.nameList();
                    if (nameList) {
                        for (let node of nameList.NAME()) {
                            params.push({
                                name: node.text as string,
                                type: 'any'
                            });
                        }
                    }

                    // Store a variadic argument if there is one
                    let variadicParam = parList.ELLIPSIS();
                    if (variadicParam) {
                        params.push({
                            name: '...',
                            type: 'any',
                            variadic: true
                        })
                    }
                }

                // Update parameter list with documentation
                for (let param of params) {
                    let v = ctx.statDocVarArg();
                    let ps = ctx.statDocParam().filter(p => p._name.text == param.name);

                    if (param.variadic && v) {
                        param.type = v._type.text as string;
                        param.description = v.statDocComment()._content?.text;
                    } else if (ps.length > 0) {
                        param.type = ps[0]._type.text as string;
                        param.description = ps[0].statDocComment()._content?.text;
                    }
                }                

                // Create and store constructor definition
                this._classes[className].constructors.push({
                    description: ctx.statDocDesc().map(d => d.text),
                    params: params
                });
            }
        }
    }
}

function generateHeader(fileName: string) {
    let code = ``;

    // Generate header for each file with name/type and kind
    code += `--[[`                                                              + EOL;
    code += `    Venice Unleashed - Intermediate Lua binding`                   + EOL;
    code += `    Type: ${fileName}`                                             + EOL;
    code += `    Generated on: ${new Date()}`                                   + EOL;
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

function generateClass(c: LuaClass, config: GenerationConfig) {
    return generateSection('Class', () => {
        let code = '';

        // Skip local classes, if the user defines them as local
        // we shouldn't have access to the class in our global context
        // unless it's imported, in which case it should've just been a
        // table or static functions
        // The forceGlobal flag allows definitions such as `class 'MyObject'` 
        // rather than only `MyObject = class 'MyObject'`
        if (!config.forceGlobal && !c.global) return code;

        // Generate constructors
        for (let constructor of c.constructors) {
            // Add constructor description
            if (constructor.description) {
                code += constructor.description.join('') + EOL;
            }
            
            for (let param of constructor.params) {
                // Create parameter docstring
                if (param.variadic) {
                    code += `---@vararg ${param.type}`;
                } else { 
                    code += `---@param ${param.name} ${param.type}`;
                }

                // Add description
                if (param.description) {
                    code += ` @ ${param.description}`;
                }

                code += EOL;
            }

            code += `---@return ${c.name}` + EOL;
            code += `function ${c.name}(${constructor.params.map(p => p.name).join(', ')}) end` + EOL + EOL;
        }

        return code;
    });
}

async function parseFile(content: string): Promise<{ [name: string]: LuaClass }> {
    // Create the lexer and parser
    let inputStream = CharStreams.fromString(content);
    let lexer = new LuaLexer(inputStream);
    let tokenStream = new CommonTokenStream(lexer);
    let parser = new LuaParser(tokenStream);
    parser.buildParseTree = true;
    
    let errors: string[] = [];
    parser.removeErrorListeners(); // Remove console error listener
    parser.addErrorListener(new class ErrorListener implements ParserErrorListener {
        syntaxError(recognizer: Recognizer<Token, any>, offendingSymbol: Token | undefined, 
            line: number, charPositionInLine: number, msg: string, e: RecognitionException | undefined) {
            errors.push(`${line}:${charPositionInLine} - ${msg}`);
        }
    });

    // Parse chunk
    let chunk = parser.chunk();
    if (errors.length > 0)
        throw new Error(`${errors.length} syntax error(s)` + EOL + EOL + errors.join(EOL));

    let listener = new LuaChunkListener();
    ParseTreeWalker.DEFAULT.walk(listener as ParseTreeListener, chunk);

    return listener.getClasses();
}

export async function generate(outPath: string, filePath: string, content: string, config: GenerationConfig) {
    // Parse content
    let classes = await parseFile(content);

    // Generate code
    var code = '';
    code += generateHeader(filePath) + EOL + EOL;
    for (let [name, c] of Object.entries(classes)) {
        console.log(`Generating code for class ${name} in ${filePath}...`);
        code += generateClass(c, config); + EOL + EOL;
    }

    // Write output file
    await fs.writeFile(join(outPath, filePath), code);
}