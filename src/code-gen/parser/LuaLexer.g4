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

lexer grammar LuaLexer;

/* Channels */
channels { COMMENTS }

/* Keywords */
AND: 'and';
BREAK: 'break';
DO: 'do';
ELSE: 'else';
ELSEIF: 'elseif';
END: 'end';
FALSE: 'false';
FOR: 'for';
FUNCTION: 'function';
GOTO: 'goto';
IF: 'if';
IN: 'in';
LOCAL: 'local';
NIL: 'nil';
NOT: 'not';
OR: 'or';
REPEAT: 'repeat';
RETURN: 'return';
THEN: 'then';
TRUE: 'true';
UNTIL: 'until';
WHILE: 'while';

CLASS: 'class'; // Middleclass class support

/* Tokens */
ADD: '+';
SUB: '-';
MUL: '*';
DIV: '/';
MOD: '%';
POWER: '^';
NUM: '#';
BIT_AND: '&';
BIT_NOT: '~';
BIT_OR: '|';
LS: '<<';
RS: '>>';
DDIV: '//';
EQ: '==';
NEQ: '~=';
LTE: '<=';
GTE: '>=';
LT: '<';
GT: '>';
ASSIGN: '=';

LABEL: '::';
SEMICOLON: ';';
COLON: ':';
COMMA: ',';
DOT: '.';
CONCAT: '..';
ELLIPSIS: '...';

PAREN_OPEN: '(';
PAREN_CLOSE: ')';
BRACK_OPEN: '{';
BRACK_CLOSE: '}';
SQ_BRACK_OPEN: '[';
SQ_BRACK_CLOSE: ']';

/* Basic rules */
NAME
    : [a-zA-Z_][a-zA-Z_0-9]*
    ;

NORMALSTRING
    : '"' ( EscapeSequence | ~('\\'|'"') )* '"'
    ;

CHARSTRING
    : '\'' ( EscapeSequence | ~('\''|'\\') )* '\''
    ;

LONGSTRING
    : '[' NESTED_STR ']'
    ;

fragment
NESTED_STR
    : '=' NESTED_STR '='
    | '[' .*? ']'
    ;

INT
    : Digit+
    ;

HEX
    : '0' [xX] HexDigit+
    ;

FLOAT
    : Digit+ '.' Digit* ExponentPart?
    | '.' Digit+ ExponentPart?
    | Digit+ ExponentPart
    ;

HEX_FLOAT
    : '0' [xX] HexDigit+ '.' HexDigit* HexExponentPart?
    | '0' [xX] '.' HexDigit+ HexExponentPart?
    | '0' [xX] HexDigit+ HexExponentPart
    ;

fragment
ExponentPart
    : [eE] [+-]? Digit+
    ;

fragment
HexExponentPart
    : [pP] [+-]? Digit+
    ;

fragment
EscapeSequence
    : '\\' [abfnrtvz"'\\]
    | '\\' '\r'? '\n'
    | DecimalEscape
    | HexEscape
    | UtfEscape
    ;

fragment
DecimalEscape
    : '\\' Digit
    | '\\' Digit Digit
    | '\\' [0-2] Digit Digit
    ;

fragment
HexEscape
    : '\\' 'x' HexDigit HexDigit
    ;

fragment
UtfEscape
    : '\\' 'u{' HexDigit+ '}'
    ;

fragment
Digit
    : [0-9]
    ;

fragment
HexDigit
    : [0-9a-fA-F]
    ;

fragment
BLOCK_COMMENT
    : '--[' NESTED_STR ']'
    ;

fragment
LINE_COMMENT
    : '--'
    ~'-'                                            // Ignore doc comments
    (                                               // --
    | '[' '='*                                      // --[==
    | '[' '='* ~('='|'['|'\r'|'\n') ~('\r'|'\n')*   // --[==AA
    | ~('['|'\r'|'\n') ~('\r'|'\n')*                // --AAA
    ) ('\r\n'|'\r'|'\n'|EOF)
    ;

SHEBANG
    : '#' '!' ~('\r'|'\n')* -> channel(HIDDEN)
    ;

COMMENT
    : (BLOCK_COMMENT | LINE_COMMENT) -> channel(COMMENTS)
    ;

WS
    : [ \t\f\r\n]+ -> skip
    ;

// Documentation
DOC_START
    : '---@' -> pushMode(DOC_MODE)
    ;

DOC_TEXT_START
    : '---' -> pushMode(DOC_TEXT_MODE)
    ;

mode DOC_MODE;

DOC_CLASS: 'class';
DOC_FIELD: 'field';
DOC_OVERLOAD: 'overload';
DOC_PARAM: 'param';
DOC_RETURN: 'return';
DOC_TYPE: 'type';
DOC_VARARG: 'vararg';
DOC_OR: '|';

DOC_FUNC: 'fun';

DOC_WS
    : [ \t\f]+ -> skip
    ;

DOC_COMMA
    : COMMA
    ;

DOC_SQ_BRACK_OPEN
    : SQ_BRACK_OPEN
    ;

DOC_SQ_BRACK_CLOSE
    : SQ_BRACK_CLOSE
    ;

DOC_COLON
    : COLON
    ;

DOC_NAME
    : NAME
    ;

DOC_PAREN_OPEN
    : PAREN_OPEN
    ;

DOC_PAREN_CLOSE
    : PAREN_CLOSE
    ;

DOC_END
    : ('\r\n'|'\r'|'\n') -> mode(DEFAULT_MODE)
    ;

DOC_COMMENT_START
    : '@' -> pushMode(DOC_TEXT_MODE)
    ;

mode DOC_TEXT_MODE;

DOC_TEXT
    : ~('\r'|'\n')+
    ;
    
DOC_TEXT_END
    : ('\r\n'|'\r'|'\n') -> mode(DEFAULT_MODE)
    ;