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
import { basename, dirname, extname, join, relative, resolve as absPath, sep } from 'path';
import { promises as fs, existsSync } from 'fs';
import { promisify } from 'util';
import { EOL } from 'os';
import { throttle } from 'throttle-debounce';
import { getApi } from '@microsoft/vscode-file-downloader-api';
import { generate as generateStubs } from './stub-gen/generator';
import { generate as generateCode, GenerationConfig } from './code-gen/generator';

const globAsync = promisify(glob);

interface InterfaceConfig {
    showErrors: boolean;
}

interface GitHubRepository {
    user: string;
    name: string;
    branch: string;
}

interface VsCodeFolder {
    name?: string;
    path: string;
}

interface VsCodeWorkspace {
    readonly folders: VsCodeFolder[];
}

const LIB_REPO: GitHubRepository = { user: 'Imposter', name: 'vscode-lua-vu-lib', branch: 'master' };
const DOCS_REPO: GitHubRepository = { user: 'EmulatorNexus', name: 'VU-Docs', branch: 'master' };
const TEMPLATE_REPO: GitHubRepository = { user: 'Imposter', name: 'vscode-lua-vu-template', branch: 'master' };

const MOD_COMPONENTS = {
    "Shared": [ 'lib', 'types/fb', 'types/shared' ],
    "Server": [ 'lib', 'types/fb', 'types/shared', 'types/server' ],
    "Client": [ 'lib', 'types/fb', 'types/shared', 'types/client' ]
};

const INTERMEDIATE_BUILD_FREQUENCY = 2; // Hz

// Reference to the ExtensionContext
var mainContext = {} as ExtensionContext;

// Menu item
interface ActionItem extends QuickPickItem {
    id: string;
    callback: () => Promise<void>;
}

function getArchiveUrl(r: GitHubRepository) {
    return `https://github.com/${r.user}/${r.name}/archive/${r.branch}.zip`;
}

// Callbacks
async function onDidDeleteFiles(e: FileDeleteEvent) {
    // Delete the matching intermediate files
    for (let file of e.files) {
        let folder = workspace.getWorkspaceFolder(file);
        if (!folder) continue;

        let componentPath = folder.uri.fsPath;
        let imPath = join(componentPath, '.vu', 'intermediate');

        // Ignore delete if the file was an intermediate file
        if (isSubPath(file.fsPath, imPath))
            continue;
        
        let relPath = relative(componentPath, file.fsPath);
        let path = join(imPath, relPath);
        if (existsSync(path))
            await fs.unlink(path);
    }
}

async function onDidRenameFiles(e: FileRenameEvent) {
    // Rename the matching intermediate files
    for (let file of e.files) {
        let folder = workspace.getWorkspaceFolder(file.oldUri);
        if (!folder) continue;

        let componentPath = folder.uri.fsPath;
        let imPath = join(componentPath, '.vu', 'intermediate');

        // Ignore rename if the file was an intermediate file
        if (isSubPath(file.oldUri.fsPath, imPath))
            continue;
        
        let oldExt = extname(file.oldUri.fsPath);
        let newExt = extname(file.newUri.fsPath);
        if (oldExt == '.lua') {
            if (newExt == '.lua') {
                // Rename the intermediate file
                let oldRelPath = relative(componentPath, file.oldUri.fsPath);
                let newRelPath = relative(componentPath, file.newUri.fsPath);
                
                let oldPath = join(imPath, oldRelPath);
                let newPath = join(imPath, newRelPath);

                if (existsSync(oldPath))
                    await fs.rename(oldPath, newPath);
            } else {
                // Delete the intermediate file
                let relPath = relative(componentPath, file.oldUri.fsPath);
                let path = join(imPath, relPath);
                if (existsSync(path))
                    await fs.unlink(path);
            }
        } else {
            if (newExt == '.lua') {
                // Generate intermediate types for this file
                await generateIntermediateCode(folder, file.newUri.fsPath, (await fs.readFile(file.newUri.fsPath)).toString());
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
    // Check if an intermediate dir path exists and create it if it doesn't
    let componentPath = folder.uri.fsPath;
    let imPath = join(componentPath, '.vu', 'intermediate');
    if (!existsSync(imPath))
        await fs.mkdir(imPath, { recursive: true });
    
    // Get a relative path to the file from the component root
    let relPath = relative(componentPath, path);
    
    // Get configuration for code generation
    let configuration = workspace.getConfiguration();
    let interfaceConfig = configuration.get<InterfaceConfig>('vua.interface');
    let generationConfig = configuration.get<GenerationConfig>('vua.generation');
    if (!interfaceConfig || !generationConfig) return;
    
    try {
        // Generate the code
        await generateCode(imPath, relPath, content, generationConfig);
    } catch (error) {
        // Show error if required
        if (interfaceConfig.showErrors) {
            window.showErrorMessage(`Error analyzing file ${relPath} | ${error}`);
        }
    }
}

function isSubPath(child: string, parent: string) {
    if (child === parent) return false
    let parentTokens = parent.split(sep).filter(i => i.length)
    return parentTokens.every((t, i) => child.split(sep)[i] === t)
}

// Utility functions
function _M(message: string, details?: string[]) {
    let m = message;
    if (details) m += EOL + EOL + details.join(EOL);
    return m;
}

async function downloadFile(name: string, uri: Uri, outPath: string, extract?: boolean) {
    return await window.withProgress<string>({
        location: ProgressLocation.Notification,
        title: `Downloading ${name}`,
        cancellable: true
    }, (progress, token) => {
        return new Promise(async (resolve, reject) => {
            // Get downloader API and begin to download the requested file
            let fileDownloader = await getApi();
            let lastProgress = 0;
            
            try {
                let file = await fileDownloader.downloadFile(uri, outPath, mainContext, token, (downloaded, total) => {
                    // Just return if we don't know how large the file is
                    if (!total) {
                        progress.report({ message: 'Please wait...' });
                        return;
                    }
    
                    // Otherwise, update the progress
                    progress.report({ message: `Please wait...`, increment: downloaded - lastProgress });
                    lastProgress = downloaded;
                }, { shouldUnzip: extract });
    
                // Return the final path of the downloaded file
                resolve(file.fsPath);   
            } catch (error) {
                // The file failed to download, pass the error along
                reject(error);
            }
        });
    });
}

async function prepareContent(): Promise<string> {
    let extPath = mainContext.globalStorageUri.fsPath;

    // Download the libraries to a temporary data dir
    let tempDataPath = join(extPath, 'temp-data');
    if (existsSync(tempDataPath))
        await fs.rmdir(tempDataPath, { recursive: true });

    await fs.mkdir(tempDataPath, { recursive: true });

    // Download content to temporary paths
    let libPath = await downloadFile('Libraries', Uri.parse(getArchiveUrl(LIB_REPO)), 'dl-lib', true);
    let docsPath = await downloadFile('VU Docs', Uri.parse(getArchiveUrl(DOCS_REPO)), 'dl-docs', true);
    let templatePath = await downloadFile('Project Template', Uri.parse(getArchiveUrl(TEMPLATE_REPO)), 'dl-template', true);

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
                let targetDocsPath = join(tempDataPath, 'docs');
                let targetTemplatePath = join(tempDataPath, 'template');

                // Rearrange files
                await fs.rename(join(libPath, `${LIB_REPO.name}-${LIB_REPO.branch}`), targetLibPath);
                await fs.rename(join(docsPath, `${DOCS_REPO.name}-${DOCS_REPO.branch}`), targetDocsPath);
                await fs.rename(join(templatePath, `${TEMPLATE_REPO.name}-${TEMPLATE_REPO.branch}`), targetTemplatePath);

                // Generate stubs
                await generateStubs(join(targetDocsPath, 'types'), join(tempDataPath, 'types'));

                // Since the content was prepared successfully, overwrite any existing data
                // and write a file to signal that the libraries have been prepared successfully
                let dataPath = join(extPath, 'data');
                if (existsSync(dataPath)) 
                    await fs.rmdir(dataPath, { recursive: true });

                await fs.rename(tempDataPath, dataPath);
                await fs.writeFile(join(dataPath, '.complete'), '');

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
    // See if the types have already been downloaded and generated
    let extPath = mainContext.globalStorageUri.fsPath;
    let dataPath = join(extPath, 'data');
    if (!existsSync(join(dataPath, '.complete'))) {
        window.showErrorMessage('VU content has not been downloaded. Please download it first.');
        return;
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

    // Ensure the project doesn't exist already
    let projectPath = join(path, 'project.code-workspace');
    if (existsSync(projectPath)) {
        window.showErrorMessage(`A project already exists at ${path}`);
        return;
    }

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

                // Copy the required libraries for each component of the mod
                for (let [name, libs] of Object.entries(MOD_COMPONENTS)) {
                    let componentPath = join(path, 'ext', name);

                    for (let lib of libs) {
                        await copy(join(dataPath, lib), join(componentPath, '.vu', lib));
                    }
                }

                if (!codeExists) {
                    // Update the project.code-workspace file
                    if (webui) {
                        let projectFile = join(path, 'project.code-workspace');
                        let project = JSON.parse(await fs.readFile(projectFile, 'utf8')) as VsCodeWorkspace;
                        project.folders.push({
                            name: 'Web UI',
                            path: 'WebUI'
                        });

                        await fs.writeFile(projectFile, JSON.stringify(project, null, 4));

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
            
                // Open the workspace
                commands.executeCommand('vscode.openFolder', Uri.file(projectPath));

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function updateProject() {
    // See if the types have already been downloaded and generated
    let extPath = mainContext.globalStorageUri.fsPath;
    let dataPath = join(extPath, 'data');
    if (!existsSync(join(dataPath, '.complete'))) {
        window.showErrorMessage('VU content has not been downloaded. Please download it first.');
        return;
    }

    if (!workspace.workspaceFile || basename(workspace.workspaceFile.fsPath) != 'project.code-workspace') {
        window.showErrorMessage('A project workspace is not open');
        return;
    }

    let path = dirname(workspace.workspaceFile.fsPath);
    await window.withProgress({
        location: ProgressLocation.Notification,
        title: 'Updating project',
        cancellable: false
    }, () => {
        return new Promise<void>(async (resolve, reject) => {
            try {
                // Copy the required libraries for each component of the mod
                for (let [name, libs] of Object.entries(MOD_COMPONENTS)) {
                    let componentPath = join(path, 'ext', name);

                    // Remove local copy of the libs and update them
                    for (let lib of libs) {
                        let targetLibPath = join(componentPath, '.vu', lib);

                        await fs.rmdir(targetLibPath, { recursive: true });
                        await copy(join(dataPath, lib), targetLibPath);
                    }
                }

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function openModConfigEditor() {
    if (!workspace.workspaceFile || basename(workspace.workspaceFile.fsPath) != 'project.code-workspace') {
        window.showErrorMessage('A project workspace is not open');
        return;
    }

    let path = dirname(workspace.workspaceFile.fsPath);
    
    // Open the mod.json file in an editor
    let modPath = join(path, 'mod.json');
    let uri = Uri.file(modPath);
    await commands.executeCommand('vscode.open', uri);
}

async function downloadContent() {
    // Prepare the content
    let dataPath = await prepareContent();

    // If a workspace is not open, bail, otherwise update the types in the project
    if (!workspace.workspaceFile || basename(workspace.workspaceFile.fsPath) != 'project.code-workspace')
        return;

    // Only continue if a project file exists
    let path = dirname(workspace.workspaceFile.fsPath);

    // Copy the required libraries for each component of the mod
    for (let [name, libs] of Object.entries(MOD_COMPONENTS)) {
        let componentPath = join(path, 'ext', name);

        for (let lib of libs) {
            await copy(join(dataPath, lib), join(componentPath, '.vu', lib));
        }
    }
}

async function rebuildIntermediate(path?: string) {
    if (!path) {
        if (!workspace.workspaceFile || basename(workspace.workspaceFile.fsPath) != 'project.code-workspace') {
            window.showErrorMessage('A project workspace is not open');
            return;
        }

        path = dirname(workspace.workspaceFile.fsPath);
    }

    // Copy the required libraries for each component of the mod
    for (let component of Object.keys(MOD_COMPONENTS)) {
        let componentPath = join(path, 'ext', component);
        
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

                // Delete any intermediate files
                let imPath = join(componentPath, '.vu', 'intermediate');
                if (existsSync(imPath))
                    await fs.rmdir(imPath, { recursive: true });

                // Make a new intermediate file directory
                await fs.mkdir(imPath, { recursive: true });

                // Get all lua files within the folder
                let luaFiles = await globAsync(join(componentPath, '**/*.lua'));

                // Show initial progress report since we now have the maximum progress value
                let increment = 100 / luaFiles.length;
                progress.report({ message: 'Starting...' });

                // Generate intermediate files for them
                let file = '';
                try {
                    for (file of luaFiles) {
                        // Read file
                        let buffer = await fs.readFile(file);
                        let content = buffer.toString();

                        let relPath = relative(componentPath, file);
                        await generateCode(imPath, relPath, content, generationConfig);

                        progress.report({ message: `Done ${relPath}`, increment: increment });
                    }

                    progress.report({ message: 'Done building intermediate types for folder' });
                    resolve();
                } catch (error) {
                    // If a failure happened while generating code, report it and return
                    reject(`An error occurred while building intermediate types for component ${component}. IntelliSense may not work correctly. File: ${file}. ${error}`);
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
            id: 'update_project',
            label: 'Update Project',
            description: 'Updates the current project with the latest VU types and support libraries',
            callback: updateProject
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
                window.showErrorMessage(_M('Failed to execute action', [ error as string ]), { modal: true });
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
            await rebuildIntermediate();
        } catch (error) {
            // TODO: Show console errors instead of modals
            window.showErrorMessage(_M('Failed to build intermediate files', [ error as string ]), { modal: true });
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