<p align="center">
    <img src="https://github.com/Imposter/vscode-lua-vu/raw/master/VuaLight.png" alt="logo" width="200">
</p>

# Vua

This is a Visual Studio Code extension providing Venice Unleashed type information and intermediate code generation to make mod development less tedious. It utilizes [Sumneko](https://github.com/sumneko)'s Lua extension for VS Code and adds an additional parser to read documentation from user code and generate intermediate code files to help the IntelliSense engine work with how classes and functions are defined in VU.

## Usage

- Install the extension (Currently only Windows is supported!)
- Find `Vua Commands` command menu and then download and build the project templates and VU doc types using the `Download and Build Content` command
- Create a new project by providing a name and a path using the `Create New Project` command
- Write your code and enjoy type information

## Features

The following are the supported and planned features for this extension:

- [x] Creating a new project
- [x] Updating cached project templates and documentation
- [x] Rebuilding intermediate code
- [x] Support for all Venice Unleashed types defined in the [documentation](https://veniceunleashed.net)
  - [x] Frostbite types
  - [x] Shared libraries/types
  - [x] Server libraries/types
  - [x] Client libraries/types
- [x] Support for generating type information for user code
- [x] [Documentation](https://emmylua.github.io/) support

## Examples

The following is the recommended code style for user-defined classes:

```lua
---This is a customized user type containing public fields name and position
---@class MyObject
---@field name string|nil
---@field position Vec3
MyObject = class('MyObject')

---Constructor which initializes the class instance
---@param name string|nil
---@param position Vec3
function MyObject:__init(name, position)
    self.name = name
    self.position = position
end

---Get object's string representation
---@return string @ Returns a string representation of the object
function MyObject:ToString()
    return self.name .. ' : ' .. self.position
end

...

local obj = MyObject('obj', Vec3(1.0, 2.0, 3.0))
```

## Changelog

See [changelog](CHANGELOG.md) for more information.

## Acknowledgements

Some people I want to thank for their hard work.

Venice Unleashed Developers:

- Orfeas "[NoFaTe](https://github.com/OrfeasZ)" Zafeiris
- Allen "[kiwidog](https://github.com/kiwidoggie)" Thomas
- Mats "[Powback](https://github.com/Powback)" Bakken

Contributors:

- [FlashHit](https://github.com/FlashHit) For actively doing research and contributing to this extension ♥

For libraries and technologies used by this extension:

- [sumneko](https://github.com/sumneko) for [vscode-lua](https://github.com/sumneko/vscode-lua)
- [ANTLR](https://github.com/antlr) for [ANTLR4](https://github.com/antlr/antlr4)
