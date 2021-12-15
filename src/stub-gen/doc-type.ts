// For more information, see: https://github.com/EmulatorNexus/VU-Docs/tree/master/types/generate-docs.js

export interface IDocument {
    name: string;
    type: 'class' | 'library' | 'enum';
}

export interface IDocType {
    type: string;
    description?: string;
    nullable?: boolean;
    array?: boolean; // EASTL Vectors
    table?: boolean; // Lua Tables
    nestedArray?: boolean;
    nestedTable?: boolean;
}

export interface IDocParam extends IDocType {
    default?: string;
    variadic?: boolean;
    readOnly?: boolean; // This is only for hooks
}

export interface IDocProperty extends IDocType {
    readOnly?: boolean;
}

export interface IDocMethod {
    name: string;
    description?: string;
    params: { [name: string]: IDocParam };
    returns?: IDocType | IDocType[];
}

export interface IDocConstructor {
    description?: string;
    params: { [name: string]: IDocParam };
}

export interface IDocOperator {
    type: 'add' | 'sub' | 'mult' | 'div' | 'mod' | 'eq' | 'lt' | 'gt'; 
    rhs: string;
    returns: string;
}

export interface IDocClass extends IDocument {
    inherits?: string;
    constructors?: IDocConstructor[];
    methods?: IDocMethod[];
    properties?: { [name: string]: IDocProperty };
    staticProperties?: { [name: string]: IDocProperty };
    operators?: IDocOperator[];
}

export interface IDocEnum extends IDocument {
    values: { [name: string]: { value: number } };
}

export interface IDocLibrary extends IDocument {
    methods: IDocMethod[];
}