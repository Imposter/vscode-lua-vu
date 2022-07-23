# Change Log

## 0.3.5

Pre-release

- Fix bug when a new project is created in a directory that already contains a file [Issue 35](https://github.com/Imposter/vscode-lua-vu/issues/35)
- Add support for Enums (Thanks FlashHit) [Pull Request 36](https://github.com/Imposter/vscode-lua-vu/pull/36)
- Add support for generation of class operators

## 0.3.4

Pre-release

- Fix doc generation code to support default parameters (Thanks FlashHit) [Pull Request 32](https://github.com/Imposter/vscode-lua-vu/pull/32)
- Fix doc generation code to support nested tables and nested arrays (Thanks FlashHit) [Pull Request 33](https://github.com/Imposter/vscode-lua-vu/pull/33)

## 0.3.3

Pre-release

- Remove dependency on mindaro-dev.file-downloader since it's not maintained [Issue 31](https://github.com/Imposter/vscode-lua-vu/issues/31)
- Include stack trace in errors
- Remove rmdir and use rm since rmdir will be deprecated in a future release

## 0.3.2

Pre-release

- Update packages
- Fix bug related to Node v14 update (rmdir must have force parameter)

## 0.3.1

Pre-release

- Use $APPDATA in common data paths to ensure conformity across different development environments [Issue 29](https://github.com/Imposter/vscode-lua-vu/issues/29)
- Allow projects to have different names rather than just 'project' (Thanks FoolHen)
- Fix data cache version check
- Correctly handle IO errors when building intermediate files
- Add support for versioned content

## 0.3.0

Pre-release

- Fixed multi-line comments in class fields obtained from VU-Docs [Issue 8](https://github.com/Imposter/vscode-lua-vu/issues/8)
- Ability to disable intermediate file generation [Issue 9](https://github.com/Imposter/vscode-lua-vu/issues/10)
- Add json library [Issue 11](https://github.com/Imposter/vscode-lua-vu/issues/11)
- Fix vector types and allow them to be indexed [Issue 12](https://github.com/Imposter/vscode-lua-vu/issues/12)
- Differentiate between integer and number (floating point values) [Issue 13](https://github.com/Imposter/vscode-lua-vu/issues/13)
- Support for tuple (many) return types [Issue 14](https://github.com/Imposter/vscode-lua-vu/issues/14)
- Fix static fields not appearing in meta data [Issue 17](https://github.com/Imposter/vscode-lua-vu/issues/17)
- Allow editing of mod.json through the Vua commands [Issue 19](https://github.com/Imposter/vscode-lua-vu/issues/19)
- Allow aborting of create project [Issue 20](https://github.com/Imposter/vscode-lua-vu/issues/20)
- Reorganize project layout [Issue 15](https://github.com/Imposter/vscode-lua-vu/issues/15)

## 0.2.10

Pre-release

- Fix definition downloads [Issue 9](https://github.com/Imposter/vscode-lua-vu/issues/9)

## 0.2.9

Pre-release

- Fixed grammar issues

## 0.2.8

Pre-release

- Added better error messages for intermediate file errors

## 0.2.7

Pre-release

- Open new project correctly
- Implemented code generation configuration, allowing users to force class definitions to the global scope for intellisense
- Added support for updating project types/support libraries with latest ones from their respective git repositories

## 0.2.6

Pre-release

- Update extension name and version

## 0.2.5

Pre-release

- Update package dependencies to include `@microsoft/vscode-file-downloader-api` as a dependency rather than a dev dependency
- Removed unused package dependencies

## 0.2.4

Pre-release

- Update VSCode builds

## 0.2.3

Pre-release

- Correctly handle documentation comments
- Generate multiline doc comments correctly
- Correctly generate variadic arguments for functions in stub generator

## 0.2.2

Initial public pre-release of the extension.

- User type generation
- VU doc stub generation
- Project support
- Type caching
- Documentation support
