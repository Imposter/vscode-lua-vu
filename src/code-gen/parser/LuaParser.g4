/*
    BSD License
    Copyright (c) 2013, Kazunori Sakamoto
    Copyright (c) 2016, Alexander Alexeev
    Copyright (C) 2021, Eyaz Rehman
    All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:
    1. Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
    2. Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
    3. Neither the NAME of Rainer Schuster nor the NAMEs of its contributors
    may be used to endorse or promote products derived from this software
    without specific prior written permission.
    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
    HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

    This grammar file derived from:
        Lua 5.3 Reference Manual
        http://www.lua.org/manual/5.3/manual.html
        Lua 5.2 Reference Manual
        http://www.lua.org/manual/5.2/manual.html
        Lua 5.1 grammar written by Nicolai Mainiero
        http://www.antlr3.org/grammar/1178608849736/Lua.g

    Tested by Kazunori Sakamoto with Test suite for Lua 5.2 (http://www.lua.org/tests/5.2/)
    Tested by Alexander Alexeev with Test suite for Lua 5.3 http://www.lua.org/tests/lua-5.3.2-tests.tar.gz

    This updated parser accepts documentation in the LDoc format
*/

parser grammar LuaParser;

options { tokenVocab=LuaLexer; }

chunk
    : block EOF
    ;

block
    : stat* retStat?
    ;

// Comments (additional)
statComment
    : COMMENT
    ;

// Doc strings (additional)
statDocDesc
    : DOC_TEXT_START content=DOC_TEXT? DOC_TEXT_END
    ;

statDocStart
    : DOC_START
    ;

statDocComment
    : ((DOC_COMMENT_START content=DOC_TEXT? DOC_TEXT_END) | DOC_END)
    ;

statDocClass
    : statDocStart DOC_CLASS name=DOC_NAME (DOC_COLON base=DOC_NAME)? statDocComment
    ;

statDocField
    : statDocStart DOC_FIELD name=DOC_NAME type=expDoc statDocComment
    ;

statDocOverload
    : statDocStart DOC_OVERLOAD func=expDocFunc statDocComment
    ;

statDocParam
    : statDocStart DOC_PARAM name=DOC_NAME type=expDoc statDocComment
    ;

statDocVarArg
    : statDocStart DOC_VARARG type=DOC_NAME statDocComment
    ;

statDocReturn
    : statDocStart DOC_RETURN types=expDocList statDocComment
    ;

statDocType
    : statDocStart DOC_TYPE types=expDoc statDocComment
    ;

expDocList
    : expDoc (DOC_COMMA expDoc)*
    ;

expDoc
    : DOC_NAME (DOC_OR DOC_NAME)* (DOC_SQ_BRACK_OPEN DOC_SQ_BRACK_CLOSE)?
    | expDocFunc
    ;

expDocFunc
    : DOC_FUNC DOC_PAREN_OPEN expDocFuncList* DOC_PAREN_CLOSE (DOC_COLON returnType=expDoc)?
    ;

expDocFuncList
    : expDocFuncDoc (DOC_COMMA expDocFuncDoc)*
    ;

expDocFuncDoc
    : expDocFunc
    | expDocFuncParam
    | DOC_NAME (DOC_OR DOC_NAME)*
    ;

expDocFuncParam
    : docName=DOC_NAME DOC_COLON docType=expDoc
    ;

// Lua + Middleclass + EmmyLua spec
statEmpty
    : SEMICOLON
    ;

statAssignment
    : docType=statDocType? varList ASSIGN expList
    ;

statLocal
    : docDesc=statDocDesc* docType=statDocType? docParams=statDocParam* LOCAL attNameList (ASSIGN expList)?
    ;

statClassDef
    : CLASS PAREN_OPEN? name=string (COMMA base=NAME)? PAREN_CLOSE?
    | LOCAL? varName=attNameList ASSIGN CLASS PAREN_OPEN? name=string (COMMA base=NAME)? PAREN_CLOSE?
    | LOCAL? varName=attNameList ASSIGN tableConstructor
    ;

statClass
    : docDesc=statDocDesc* docClass=statDocClass? (docField=statDocField | docOverload=statDocOverload)*  def=statClassDef
    ;

statFunctionDef
    : LOCAL? FUNCTION name=funcName body=funcBody
    ;

statFunction
    : docDesc=statDocDesc* docParams=statDocParam* docVarArg=statDocVarArg? docReturn=statDocReturn? docOverloads=statDocOverload* def=statFunctionDef
    ;

statFunctionCall
    : functionCall
    ;

statLabel
    : label
    ;

statBreak
    : BREAK
    ;

statGoto
    : GOTO NAME
    ;

statDo
    : DO block END
    ;

statWhile
    : WHILE exp DO block END
    ;

statRepeat
    : REPEAT block UNTIL exp
    ;

statIf
    : IF exp THEN block (ELSEIF exp THEN block)* (ELSE block)? END
    ;

statFor
    : FOR NAME ASSIGN exp COMMA exp (COMMA exp)? DO block END
    ;

statForIn
    : FOR nameList IN expList DO block END
    ;

stat
    : statEmpty
    | statComment
    | statAssignment
    | statLocal
    | statClass
    | statFunction
    | statFunctionCall
    | statLabel
    | statBreak
    | statGoto
    | statDo
    | statWhile
    | statRepeat
    | statIf
    | statFor
    | statForIn
    ;

attNameList
    : NAME attrib (COMMA NAME attrib)*
    ;

attrib
    : (LT NAME GT)?
    ;

retStat
    : RETURN expList? SEMICOLON?
    ;

label
    : LABEL NAME LABEL
    ;

funcName
    : NAME (DOT NAME)* (COLON NAME)?
    ;

varList
    : var (COMMA var)*
    ;

nameList
    : NAME (COMMA NAME)*
    ;

expList
    : exp (COMMA exp)*
    ;

exp
    : NIL | FALSE | TRUE
    | number
    | string
    | ELLIPSIS
    | functionDef
    | prefixExp
    | tableConstructor
    | <assoc=right> exp operatorPower exp
    | operatorUnary exp
    | exp operatorMulDivMod exp
    | exp operatorAddSub exp
    | <assoc=right> exp operatorStrcat exp
    | exp operatorComparison exp
    | exp operatorAnd exp
    | exp operatorOr exp
    | exp operatorBitwise exp
    ;

prefixExp
    : varOrExp nameAndArgs*
    ;

functionCall
    : varOrExp nameAndArgs+
    ;

varOrExp
    : var | PAREN_OPEN exp PAREN_CLOSE
    ;

var
    : (NAME | PAREN_OPEN exp PAREN_CLOSE varSuffix) varSuffix*
    ;

varSuffix
    : nameAndArgs* (SQ_BRACK_OPEN exp SQ_BRACK_CLOSE | DOT NAME)
    ;

nameAndArgs
    : (COLON NAME)? args
    ;

args
    : PAREN_OPEN expList? PAREN_CLOSE | tableConstructor | string
    ;

functionDef
    : FUNCTION funcBody
    ;

funcBody
    : PAREN_OPEN parList? PAREN_CLOSE block END
    ;

parList
    : nameList (COMMA ELLIPSIS)? | ELLIPSIS
    ;

tableConstructor
    : BRACK_OPEN fieldList? BRACK_CLOSE
    ;

fieldList
    : field (fieldSep field)* fieldSep?
    ;

field
    : SQ_BRACK_OPEN exp SQ_BRACK_CLOSE ASSIGN exp | NAME ASSIGN exp | exp
    ;

fieldSep
    : COMMA | SEMICOLON
    ;

operatorOr
	: OR;

operatorAnd
	: AND;

operatorComparison
	: LT | GT | LTE | GTE | NEQ | EQ;

operatorStrcat
	: CONCAT;

operatorAddSub
	: ADD | SUB;

operatorMulDivMod
	: MUL | DIV | MOD | DDIV;

operatorBitwise
	: BIT_AND | BIT_OR | BIT_NOT | LS | RS;

operatorUnary
    : NOT | NUM | SUB | BIT_NOT;

operatorPower
    : POWER;

number
    : INT | HEX | FLOAT | HEX_FLOAT
    ;

string
    : NORMALSTRING | CHARSTRING | LONGSTRING
    ;