<div style="text-align:center">
    <img src="logo.png">
</div>

# VU.Lua

This is a Visual Studio Code extension providing Venice Unleashed type information and intermediate code generation to make mod development less tedious. It utilizes Sumneko's Lua extension for VS Code and adds an additional parser to read documentation from user code and generate intermediate code files to help the IntelliSense engine work with how classes and functions are defined in VU.

## Usage

- Install the extension
- Find `VU.Lua Commands` command menu and then download and build the project templates and VU doc types using the `Download and Build Content` command
- Create a new project by providing a name and a path using the `Create New Project` command

## Features

The following are the supported and planned features for this extension:

- [x] Creating a new project
- [x] Updating cached project templates and documentation
- [x] Rebuilding intermediate code
- [ ] Support for all Venice Unleashed types defined in the [documentation](https://veniceunleashed.net)
  - [x] Frostbite types
  - [x] Shared libraries/types
  - [x] Server libraries/types
  - [ ] Client libraries/types
    - This currently requires additional work in the form of implementing nested tables/vectors
- [x] Support for generating type information for user code
- [ ] [Documentation](https://emmylua.github.io/) support
  - [x] Classes
  - [x] Fields
  - [x] Parameters
  - [x] Return
  - [x] Type
  - [ ] See (reference)

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

- Incomplete implementation of parser against some of the EmmyLua [documentation](https://emmylua.github.io/) strings
- Incomplete VU document processing will give wrong output for nested tables and nested arrays

## Changelog

### 0.2.2

Initial public pre-release of the extension.

- User type generation
- VU doc stub generation
- Project support
- Type caching
- Documentation support