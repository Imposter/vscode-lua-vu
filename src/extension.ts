import { 
    window,
    commands,
    workspace,
    ExtensionContext,
    TextDocument,
    StatusBarAlignment,
    QuickPickItem,
    TextDocumentChangeEvent,
    FileDeleteEvent,
    FileRenameEvent,
    WorkspaceFolder,
    ProgressLocation,
    Uri,
    EndOfLine,
} from 'vscode';

import { copy } from 'fs-extra';
import { glob } from 'glob';
import { basename, dirname, extname, join, relative, sep } from 'path';
import { promises as fs, existsSync } from 'fs';
import { promisify } from 'util';
import { EOL, type as osType } from 'os';
import { throttle } from 'throttle-debounce';
import { downloadFile as downloadHttpFile } from './utils/downloader';
import { generate as generateStubs } from './stub-gen/generator';
import { generate as generateCode, GenerationConfig } from './code-gen/generator';

const globAsync = promisify(glob);

interface InterfaceConfig {
    showErrors: boolean;
}

interface GitHubRepository {
    user: string;
    name: string;
    branch?: string;
    tag?: string;
}

interface VsCodeFolder {
    name?: string;
    path: string;
}

interface VsCodeWorkspace {
    readonly folders: VsCodeFolder[];
}

const LIB_REPO: GitHubRepository = { user: 'Imposter', name: 'vscode-lua-vu-lib' };
const TEMPLATE_REPO: GitHubRepository = { user: 'Imposter', name: 'vscode-lua-vu-template' };
const DOCS_REPO: GitHubRepository = { user: 'EmulatorNexus', name: 'VU-Docs', branch: 'master' };

const MOD_COMPONENTS = [ 'Shared', 'Server', 'Client' ];

const INTERMEDIATE_BUILD_FREQUENCY = 2; // Hz

// Reference to the ExtensionContext
var mainContext = {} as ExtensionContext;

// Utility functions
function _M(message: string, details?: string[]) {
    let m = message;
    if (details) m += EOL + EOL + details.join(EOL);
    return m;
}

function _E(error: Error | string | any) {
    if (error instanceof Error) { 
        if (error.stack) {
            return error.message + EOL + EOL + error.stack;
        }
        return error.message; 
    }
    if (typeof error === 'string') { return error; }
    return error;
}

function isSubPath(child: string, parent: string) {
    if (child === parent) return false
    let parentTokens = parent.split(sep).filter(i => i.length)
    return parentTokens.every((t, i) => child.split(sep)[i] === t)
}

// Project functions
function isVuaProject(path: string) {
    let fileName = basename(path);
    let dotPos = fileName.indexOf('.');
    if (dotPos == -1) {
        return false;
    }

    let extName = fileName.substring(dotPos);
    return extName == '.vua.code-workspace';
}

async function findVuaProject(path: string) {
    if (!existsSync(path)) {
        return null;
    }

    var files = await fs.readdir(path);
    for (let f of files) {
        let filePath = join(path, f);
        let stat = await fs.lstat(filePath);
        if (stat.isFile() && isVuaProject(filePath)) {
            return f;
        }
    }

    return null;
}

// Menu item
interface ActionItem extends QuickPickItem {
    id: string;
    callback: () => Promise<void>;
}

function getRepoWithTag(r: GitHubRepository, tag: string) {
    r.tag = tag;
    return r;
}

function getArchiveUrl(r: GitHubRepository) {
    if (r.branch != undefined)
        return `https://github.com/${r.user}/${r.name}/archive/${r.branch}.zip`;
    if (r.tag != undefined)
        return `https://github.com/${r.user}/${r.name}/archive/refs/tags/${r.tag}.zip`;

    throw new Error('Either branch or tag must be specified');
}

// Callbacks
async function onDidDeleteFiles(e: FileDeleteEvent) {
    if (!workspace.workspaceFile || !isVuaProject(workspace.workspaceFile.fsPath)) {
        return;
    }

    let projectPath = dirname(workspace.workspaceFile.fsPath);
    let imPath = join(projectPath, '.vu', 'intermediate');

    // Delete the matching intermediate files
    for (let file of e.files) {        
        let folder = workspace.getWorkspaceFolder(file);
        if (!folder) continue;

        let componentPath = folder.uri.fsPath;
        let componentImPath = join(imPath, basename(folder.uri.fsPath));

        // Ignore delete if the file was an intermediate file
        if (isSubPath(file.fsPath, componentImPath))
            continue;
        
        let relPath = relative(componentPath, file.fsPath);
        let path = join(componentImPath, relPath);
        if (existsSync(path))
            await fs.unlink(path);
    }
}

async function onDidRenameFiles(e: FileRenameEvent) {
    if (!workspace.workspaceFile || !isVuaProject(workspace.workspaceFile.fsPath)) {
        return;
    }

    let projectPath = dirname(workspace.workspaceFile.fsPath);
    let imPath = join(projectPath, '.vu', 'intermediate');

    // Rename the matching intermediate files
    for (let file of e.files) {
        let folder = workspace.getWorkspaceFolder(file.oldUri);
        if (!folder) continue;

        let componentPath = folder.uri.fsPath;
        let componentImPath = join(imPath, basename(folder.uri.fsPath));

        // Ignore rename if the file was an intermediate file
        if (isSubPath(file.oldUri.fsPath, componentImPath))
            continue;
        
        let oldExt = extname(file.oldUri.fsPath);
        let newExt = extname(file.newUri.fsPath);
        if (oldExt == '.lua') {
            if (newExt == '.lua') {
                // Rename the intermediate file
                let oldRelPath = relative(componentPath, file.oldUri.fsPath);
                let newRelPath = relative(componentPath, file.newUri.fsPath);
                
                let oldPath = join(componentImPath, oldRelPath);
                let newPath = join(componentImPath, newRelPath);

                if (existsSync(oldPath))
                    await fs.rename(oldPath, newPath);
            } else {
                // Delete the intermediate file
                let relPath = relative(componentPath, file.oldUri.fsPath);
                let path = join(componentImPath, relPath);
                if (existsSync(path))
                    await fs.unlink(path);
            }
        } else {
            if (newExt == '.lua') {
                // Generate intermediate types for this file
                await generateIntermediateCode(folder, file.newUri.fsPath, await fs.readFile(file.newUri.fsPath, 'utf8'));
            }
        }
    }
}

async function onDidSaveTextDocument(d: TextDocument) {
    let folder = workspace.getWorkspaceFolder(d.uri);
    if (!folder) return;

    await generateIntermediateCode(folder, d.uri.fsPath, d.getText());
}

async function onDidChangeTextDocument(e: TextDocumentChangeEvent) {
    let folder = workspace.getWorkspaceFolder(e.document.uri);
    if (!folder) return;

    // Only proceed on the specified characters
    let build = false;
    if (e.contentChanges) {
        for (let change of e.contentChanges) {
            if (change.text == ' ' || change.text == '\t' || change.text == ')' 
                || change.text == (e.document.eol == EndOfLine.LF ? '\n' : '\r\n')) {
                build = true;
                break;
            }
        }
    }

    if (!build) return;

    // Generate code
    await generateIntermediateCode(folder, e.document.uri.fsPath, e.document.getText());
}

async function generateIntermediateCode(folder: WorkspaceFolder, path: string, content: string) {
    if (!workspace.workspaceFile || !isVuaProject(workspace.workspaceFile.fsPath)) {
        return;
    }

    let projectPath = dirname(workspace.workspaceFile.fsPath);
    let imPath = join(projectPath, '.vu', 'intermediate');

    // Check if an intermediate dir path exists and create it if it doesn't
    let componentPath = folder.uri.fsPath;
    let componentImPath = join(imPath, basename(folder.uri.fsPath));
    if (!existsSync(componentImPath))
        await fs.mkdir(componentImPath, { recursive: true });
    
    // Get a relative path to the file from the component root
    let relPath = relative(componentPath, path);
    
    // Get configuration for code generation
    let configuration = workspace.getConfiguration();
    let interfaceConfig = configuration.get<InterfaceConfig>('vua.interface');
    let generationConfig = configuration.get<GenerationConfig>('vua.generation');
    if (!interfaceConfig || !generationConfig) return;
    
    try {
        // Generate the code
        await generateCode(componentImPath, relPath, content, generationConfig);
    } catch (error) {
        // Show error if required
        if (interfaceConfig.showErrors) {
            window.showErrorMessage(`Error analyzing file ${relPath} | ${error}`);
        }
    }
}

// TODO: Extract to temporary locations and return the paths, leave it up to the user to move them
async function downloadFile(name: string, uri: Uri, outPath: string, extract?: boolean) {
    return await window.withProgress<string>({
        location: ProgressLocation.Notification,
        title: `Downloading ${name}`,
        cancellable: true
    }, (progress, token) => {
        return new Promise(async (resolve, reject) => {            
            try {
                let lastProgress = 0;
                let file = await downloadHttpFile(uri, true, token, async (downloaded, total) => {
                    // Just return if we don't know how large the file is
                    if (!total) {
                        progress.report({ message: 'Please wait...' });
                        return;
                    }
    
                    // Otherwise, update the progress
                    progress.report({ message: `Please wait...`, increment: (downloaded - lastProgress) / total * 100 });
                    lastProgress = downloaded;
                });
    
                // Return the final path of the downloaded file
                resolve(file.fsPath);
            } catch (error) {
                // The file failed to download, pass the error along
                reject(`Failed to download ${name} (URL: ${uri}) | ${_E(error)}`);
            }
        });
    });
}

async function prepareContent(): Promise<string> {
    let extDataPath = mainContext.globalStorageUri.fsPath;

    // Download the libraries to a temporary data dir
    let tempDataPath = join(extDataPath, 'temp-data');
    if (existsSync(tempDataPath))
        await fs.rm(tempDataPath, { recursive: true, force: true });

    await fs.mkdir(tempDataPath, { recursive: true });

    // Set repository tags to the version of the extension
    let packageInfo = JSON.parse(await fs.readFile(join(mainContext.extensionPath, 'package.json'), 'utf8'));
    let tag = `v${packageInfo.version}`;

    // Download content to temporary paths
    let libPath = await downloadFile('Libraries', Uri.parse(getArchiveUrl(getRepoWithTag(LIB_REPO, tag))), 'dl-lib', true);
    let templatePath = await downloadFile('Project Template', Uri.parse(getArchiveUrl(getRepoWithTag(TEMPLATE_REPO, tag))), 'dl-template', true);
    let docsPath = await downloadFile('VU Docs', Uri.parse(getArchiveUrl(DOCS_REPO)), 'dl-docs', true);

    // Show progress while generating stubs
    return await window.withProgress({
        location: ProgressLocation.Notification,
        title: 'Generating type information',
        cancellable: false
    }, () => {
        return new Promise(async (resolve, reject) => {
            try {
                // Create paths
                let targetLibPath = join(tempDataPath, 'lib');
                let targetTemplatePath = join(tempDataPath, 'template');
                let targetDocsPath = join(tempDataPath, 'docs');

                // Rearrange files
                await fs.rename(join(libPath, (await fs.readdir(libPath))[0]), targetLibPath);
                await fs.rename(join(templatePath, (await fs.readdir(templatePath))[0]), targetTemplatePath);
                await fs.rename(join(docsPath, (await fs.readdir(docsPath))[0]), targetDocsPath);

                // Delete the temporary paths
                await fs.rm(libPath, { recursive: true, force: true });
                await fs.rm(templatePath, { recursive: true, force: true });
                await fs.rm(docsPath, { recursive: true, force: true });

                // Generate stubs
                await generateStubs(join(targetDocsPath, 'types'), join(tempDataPath, 'types'));

                // Since the content was prepared successfully, overwrite any existing data
                // and write a file to signal that the libraries have been prepared successfully
                let dataPath = join(extDataPath, 'data');
                if (existsSync(dataPath)) 
                    await fs.rm(dataPath, { recursive: true, force: true });

                await fs.rename(tempDataPath, dataPath);
                await fs.writeFile(join(dataPath, '.complete'), '');
                await fs.writeFile(join(dataPath, '.version'), packageInfo.version);

                // Return the data path
                resolve(dataPath);
            } catch (error) {
                reject(error);
            }
        });
    });    
}

// Action callbacks
async function newProject() {
    // Get the extension package information
    let packageInfo = JSON.parse(await fs.readFile(join(mainContext.extensionPath, 'package.json'), 'utf8'));

    // See if the types have already been downloaded and generated
    let extDataPath = mainContext.globalStorageUri.fsPath;
    let dataPath = join(extDataPath, 'data');
    if (!existsSync(join(dataPath, '.complete')) 
        || !existsSync(join(dataPath, '.version')) 
        || await fs.readFile(join(dataPath, '.version'), 'utf8') !== packageInfo.version) {
        // If not, download and generate the content first
        await prepareContent();
    }

    // Ask for a project name
    let name = await window.showInputBox({
        prompt: 'Project name',
        placeHolder: 'VUMod',
        ignoreFocusOut: true
    });

    if (name == null) return;

    name = name.trim();
    if (name.length == 0) {
        window.showErrorMessage(`Invalid project name`);
        return;
    }

    // Ask for a project path
    let defaultPath = workspace.workspaceFolders && workspace.workspaceFolders.length ? workspace.workspaceFolders[0].uri.fsPath : '';
    let path = await window.showInputBox({
        prompt: 'Project path',
        value: defaultPath,
        ignoreFocusOut: true
    }) as string;
    
    if (path == null) return;

    path = path.trim();
    if (path.length == 0) {
        window.showErrorMessage(`Invalid project path`);
        return;
    }

    // Check if a project exists in the directory already
    let existingProjectPath = await findVuaProject(path);
    if (existingProjectPath != null) {
        window.showErrorMessage(`A project already exists at ${path}`);
        return;
    }

    // Get the temporary project path
    let tempProjectFile = join(path, 'project.vua.code-workspace');

    // Ask if WebUI should be enabled for the project
    let webui = await window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Enable WebUI',
        ignoreFocusOut: true
    }) == 'Yes';

    await window.withProgress({
        location: ProgressLocation.Notification,
        title: 'Creating project',
        cancellable: false
    }, () => {
        return new Promise<void>(async (resolve, reject) => {
            try {
                // Check if code already exists at the path
                var codeExists = existsSync(path);

                // Check if the path exists
                if (!codeExists) {
                    // Make a new directory at the target path
                    await fs.mkdir(path, { recursive: true });
                }     

                // Copy the template files, types and libs to the specified path
                await copy(join(dataPath, 'template'), path, {
                    overwrite: false    
                });

                if (!codeExists) {
                    // Update the project.code-workspace file
                    if (webui) {
                        let project = JSON.parse(await fs.readFile(tempProjectFile, 'utf8')) as VsCodeWorkspace;
                        project.folders.push({
                            name: 'Web UI',
                            path: 'WebUI'
                        });

                        await fs.writeFile(tempProjectFile, JSON.stringify(project, null, 4));

                        // Create a WebUI directory
                        await fs.mkdir(join(path, 'WebUI'), { recursive: true });
                    }

                    // Update the mod.json
                    let modPath = join(path, 'mod.json');
                    let mod = JSON.parse(await fs.readFile(modPath, 'utf8'));
                    mod['Name'] = name;
                    mod['Authors'] = [ process.env['USERNAME'] || process.env['USER'] || '' ];
                    mod['HasWebUI'] = webui;
                    await fs.writeFile(modPath, JSON.stringify(mod, null, 4));
                }
            
                // Rename the project file and open the workspace
                let projectFile = join(path, `${name}.vua.code-workspace`);
                await fs.rename(tempProjectFile, projectFile);
                commands.executeCommand('vscode.openFolder', Uri.file(projectFile));

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function openModConfigEditor() {
    if (!workspace.workspaceFile || !isVuaProject(workspace.workspaceFile.fsPath)) {
        window.showErrorMessage('A project workspace is not open');
        return;
    }

    let path = dirname(workspace.workspaceFile.fsPath);
    
    // Open the mod.json file in an editor
    let modPath = join(path, 'mod.json');
    await commands.executeCommand('vscode.open', Uri.file(modPath));
}

async function downloadContent() {
    try {
        await prepareContent();
    } catch (error) {
        // TODO: Show console errors instead of modals
        console.error(error);
        window.showErrorMessage(_M('Failed to download content', [ _E(error) ]), { modal: true });
    }
}

async function rebuildIntermediate(path?: string) {
    if (!path) {
        if (!workspace.workspaceFile || !isVuaProject(workspace.workspaceFile.fsPath)) {
            window.showErrorMessage('A project workspace is not open');
            return;
        }

        path = dirname(workspace.workspaceFile.fsPath);
    }

    // Copy the required libraries for each component of the mod
    for (let component of MOD_COMPONENTS) {
        let componentPath = join(path, 'ext', component);
        let componentImPath = join(path, '.vu', 'intermediate', component);
        
        // Show a progress dialog for each folder
        await window.withProgress({
            location: ProgressLocation.Notification,
            title: `Building intermediate files`,
            cancellable: true
        }, (progress, token) => {
            return new Promise<void>(async (resolve, reject) => {
                // Get configuration for code generation
                let configuration = workspace.getConfiguration();
                let generationConfig = configuration.get<GenerationConfig>('vua.generation');
                if (!generationConfig) return;

                let file = '';
                try {
                    // Delete any intermediate files
                    if (existsSync(componentImPath))
                    await fs.rm(componentImPath, { recursive: true, force: true });

                    // Make a new intermediate file directory
                    await fs.mkdir(componentImPath, { recursive: true });

                    // Get all lua files within the folder
                    let luaFiles = await globAsync(join(componentPath, '**/*.lua'));

                    // Show initial progress report since we now have the maximum progress value
                    let increment = 100 / luaFiles.length;
                    progress.report({ message: 'Starting...' });

                    // Generate intermediate files for them
                    for (file of luaFiles) {
                        // Read file
                        let content = await fs.readFile(file, 'utf8');

                        let relPath = relative(componentPath, file);
                        await generateCode(componentImPath, relPath, content, generationConfig);

                        progress.report({ message: `Done ${relPath}`, increment: increment });
                    }

                    progress.report({ message: 'Done building intermediate types for folder' });
                    resolve();
                } catch (error) {
                    // If a failure happened while generating code, report it and return
                    reject(`An error occurred while building intermediate types for component ${component}. IntelliSense may not work correctly. File: ${file}. ${_E(error)}`);
                }
            });
        });
    }    
}

function showActionMenu() {
    let quickPick = window.createQuickPick<ActionItem>();
    quickPick.title = 'Vua Actions';
    quickPick.placeholder = 'Type to select an action';
    quickPick.items = [
        {
            id: 'new_project',
            label: 'Create New Project',
            description: 'Creates a new project with the pre-prepared mod template',
            callback: newProject
        },
        {
            id: 'edit_mod_config',
            label: 'Edit Mod Config',
            description: 'Opens the mod.json file in an editor',
            callback: openModConfigEditor
        },
        {
            id: 'download_content',
            label: 'Download and Build Content',
            description: 'Downloads and builds the latest VU types, support libraries and project templates',
            callback: downloadContent
        },
        {
            id: 'rebuild_intermediate',
            label: 'Rebuild Intermediate Files',
            description: 'Rebuilds intermediate files used to help VS Code with IntelliSense for Lua in VU',
            callback: rebuildIntermediate,
        }
    ];

    quickPick.onDidAccept(async _ => {
        if (quickPick.selectedItems.length > 0) {
            let action = quickPick.selectedItems[0];
            
            // Run the selected action
            console.log(`Executing action ${action.id}`);
            quickPick.hide();

            try {
                await action.callback();
            } catch (error) {
                // TODO: Show console errors instead of modals
                console.error(error);
                window.showErrorMessage(_M('Failed to execute action', [ _E(error) ]), { modal: true });
            } finally {
                quickPick.dispose();
            }
        }
    });

    quickPick.onDidHide(_ => { quickPick.dispose(); });

    // Show menu
    quickPick.show();
}

export async function activate(context: ExtensionContext) {
    // Check operating system, if not windows, show error and exit
    let osName = osType();
    if (osName != 'Windows_NT') {
        window.showErrorMessage(`Vua only supports Windows (Current OS: ${osName})`);
        return;
    }

    // Store extension context
    mainContext = context;

    // Register event handlers
    let deleteDisposable = workspace.onDidDeleteFiles(onDidDeleteFiles);
    let renameDisposable = workspace.onDidRenameFiles(onDidRenameFiles);
    let saveDisposable = workspace.onDidSaveTextDocument(throttle(1000 / INTERMEDIATE_BUILD_FREQUENCY, false, onDidSaveTextDocument));
    let changeDisposable = workspace.onDidChangeTextDocument(throttle(1000 / INTERMEDIATE_BUILD_FREQUENCY, false, onDidChangeTextDocument));

    // Register command to show the quick pick above
    let menuCommandDisposable = commands.registerCommand('vua.showMenu', () => { showActionMenu(); });

    // Add status bar button for actions
    let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    statusBarItem.text = 'Vua';
    statusBarItem.tooltip = 'Lua helper extension for Venice Unleashed';
    statusBarItem.color = '#00c3ff';
    statusBarItem.command = 'vua.showMenu';

    // Show status bar item
    statusBarItem.show();

    // Check if the workspace contains intermediate files, if it does, rebuild them
    if (workspace.workspaceFile) {
        try {
            // Get the extension package information
            let packageInfo = JSON.parse(await fs.readFile(join(mainContext.extensionPath, 'package.json'), 'utf8'));

            // See if the types have already been downloaded and generated
            let extDataPath = mainContext.globalStorageUri.fsPath;
            let dataPath = join(extDataPath, 'data');
            if (!existsSync(join(dataPath, '.complete')) 
                || !existsSync(join(dataPath, '.version')) 
                || await fs.readFile(join(dataPath, '.version'), 'utf8') !== packageInfo.version) {
                // If not, download and generate the content first
                await prepareContent();
            }
        } catch (error) {
            // TODO: Show console errors instead of modals
            console.error(error);
            window.showErrorMessage(_M('Failed to download content', [ _E(error) ]), { modal: true });
        }
        
        try {
            await rebuildIntermediate();
        } catch (error) {
            // TODO: Show console errors instead of modals
            console.error(error);
            window.showErrorMessage(_M('Failed to build intermediate files', [ _E(error) ]), { modal: true });
        }
    }

    window.setStatusBarMessage('Vua is ready!', 5000);

    // Push disposables
    context.subscriptions.push(menuCommandDisposable);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(changeDisposable);
    context.subscriptions.push(saveDisposable);
    context.subscriptions.push(renameDisposable);
    context.subscriptions.push(deleteDisposable);
}