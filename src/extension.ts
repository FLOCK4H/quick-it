import { execFile as execFileCallback } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFile = promisify(execFileCallback);

interface ScriptDescriptor {
	readonly extension: string;
	readonly label: string;
	readonly languageId?: string;
	readonly interpreterSetting?: string;
	getDefaultInterpreters(): string[];
	buildRunCommand(interpreter: string, scriptPath: string): string;
}

interface CustomInterpreter {
	readonly command: string;
	readonly label?: string;
}

export interface QuickItApi {
	registerInterpreter(extension: string, command: string, label?: string): vscode.Disposable;
}

const BUILTIN_SCRIPT_DESCRIPTORS: readonly ScriptDescriptor[] = [
	{
		extension: '.ps1',
		label: 'PowerShell (.ps1)',
		languageId: 'powershell',
		interpreterSetting: 'interpreters.powershell',
		getDefaultInterpreters: () => ['pwsh', 'powershell'],
		buildRunCommand: (interpreter, scriptPath) => `${interpreter} -NoProfile -ExecutionPolicy Bypass -File ${quoteForCommandArgument(scriptPath)}`
	},
	{
		extension: '.sh',
		label: 'Bash (.sh)',
		languageId: 'shellscript',
		interpreterSetting: 'interpreters.bash',
		getDefaultInterpreters: () => ['bash'],
		buildRunCommand: (interpreter, scriptPath) => `${interpreter} ${quoteForCommandArgument(scriptPath)}`
	},
	{
		extension: '.zsh',
		label: 'Zsh (.zsh)',
		languageId: 'shellscript',
		interpreterSetting: 'interpreters.bash',
		getDefaultInterpreters: () => ['bash'],
		buildRunCommand: (interpreter, scriptPath) => `${interpreter} ${quoteForCommandArgument(scriptPath)}`
	},
	{
		extension: '.py',
		label: 'Python (.py)',
		languageId: 'python',
		interpreterSetting: 'interpreters.python',
		getDefaultInterpreters: () => ['python'],
		buildRunCommand: (interpreter, scriptPath) => `${interpreter} ${quoteForCommandArgument(scriptPath)}`
	},
	{
		extension: '.js',
		label: 'JavaScript (.js)',
		languageId: 'javascript',
		interpreterSetting: 'interpreters.node',
		getDefaultInterpreters: () => ['node'],
		buildRunCommand: (interpreter, scriptPath) => `${interpreter} ${quoteForCommandArgument(scriptPath)}`
	},
	{
		extension: '.ts',
		label: 'TypeScript (.ts)',
		languageId: 'typescript',
		interpreterSetting: 'interpreters.tsNode',
		getDefaultInterpreters: () => ['ts-node'],
		buildRunCommand: (interpreter, scriptPath) => `${interpreter} ${quoteForCommandArgument(scriptPath)}`
	}
];

const BUILTIN_BY_EXTENSION: ReadonlyMap<string, ScriptDescriptor> = new Map(
	BUILTIN_SCRIPT_DESCRIPTORS.map((descriptor) => [descriptor.extension, descriptor])
);

const WINDOWS_RESERVED_BASENAMES = new Set([
	'con',
	'prn',
	'aux',
	'nul',
	'com1',
	'com2',
	'com3',
	'com4',
	'com5',
	'com6',
	'com7',
	'com8',
	'com9',
	'lpt1',
	'lpt2',
	'lpt3',
	'lpt4',
	'lpt5',
	'lpt6',
	'lpt7',
	'lpt8',
	'lpt9'
]);

const SAFETY_NOTICE_STATE_KEY = 'quickIt.safetyNoticeShown';

class ScriptItem extends vscode.TreeItem {
	constructor(
		readonly uri: vscode.Uri,
		readonly descriptor: ScriptDescriptor
	) {
		super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
		this.id = uri.toString();
		this.resourceUri = uri;
		this.contextValue = 'quickIt.script';
		this.description = descriptor.label;
		this.tooltip = uri.fsPath;
		this.command = {
			command: 'quick-it.runScript',
			title: 'Run Script',
			arguments: [this]
		};
	}
}

class ScriptsTreeProvider implements vscode.TreeDataProvider<ScriptItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
	private hasShownReadError = false;
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(
		private readonly getScriptsDirectory: () => Promise<vscode.Uri>,
		private readonly resolveDescriptorForUri: (uri: vscode.Uri) => ScriptDescriptor | undefined
	) {}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	getTreeItem(element: ScriptItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ScriptItem): Promise<ScriptItem[]> {
		if (element) {
			return [];
		}

		try {
			const scriptsDirectory = await this.getScriptsDirectory();
			await vscode.workspace.fs.createDirectory(scriptsDirectory);
			const entries = await vscode.workspace.fs.readDirectory(scriptsDirectory);
			const scriptItems: ScriptItem[] = [];

			for (const [entryName, fileType] of entries) {
				if (fileType !== vscode.FileType.File) {
					continue;
				}

				const uri = vscode.Uri.joinPath(scriptsDirectory, entryName);
				const descriptor = this.resolveDescriptorForUri(uri);
				if (!descriptor) {
					continue;
				}

				scriptItems.push(new ScriptItem(uri, descriptor));
			}

			scriptItems.sort((left, right) => path.basename(left.uri.fsPath).localeCompare(path.basename(right.uri.fsPath), undefined, { sensitivity: 'base' }));
			this.hasShownReadError = false;
			return scriptItems;
		} catch (error) {
			if (!this.hasShownReadError) {
				this.hasShownReadError = true;
				void vscode.window.showErrorMessage(`QuickIt failed to load scripts: ${toErrorMessage(error)}`);
			}

			return [];
		}
	}
}

export function activate(context: vscode.ExtensionContext): QuickItApi {
	const customInterpreters = new Map<string, CustomInterpreter>();
	let hasShownWorkspaceConfigurationWarning = false;

	const getQuickItSettingValue = (settingPath: string): string | undefined => {
		const { value, hasWorkspaceOverride } = getQuickItConfigurationValue(settingPath);
		if (hasWorkspaceOverride && !hasShownWorkspaceConfigurationWarning) {
			hasShownWorkspaceConfigurationWarning = true;
			void vscode.window.showWarningMessage(
				'QuickIt ignores workspace-level quickIt settings for security. Configure QuickIt in User settings instead.'
			);
		}

		return value;
	};

	const getScriptsDirectory = async (): Promise<vscode.Uri> => resolveScriptsDirectory(context, getQuickItSettingValue);
	const resolveDescriptorForUri = (uri: vscode.Uri): ScriptDescriptor | undefined => {
		const extension = normalizeExtension(path.extname(uri.fsPath));
		const builtInDescriptor = BUILTIN_BY_EXTENSION.get(extension);
		if (builtInDescriptor) {
			return builtInDescriptor;
		}

		const customInterpreter = customInterpreters.get(extension);
		if (!customInterpreter) {
			return undefined;
		}

		return {
			extension,
			label: customInterpreter.label?.trim() || `Custom (${extension})`,
			getDefaultInterpreters: () => [customInterpreter.command],
			buildRunCommand: (interpreter, scriptPath) => `${interpreter} ${quoteForCommandArgument(scriptPath)}`
		};
	};

	const scriptsTreeProvider = new ScriptsTreeProvider(getScriptsDirectory, resolveDescriptorForUri);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('quickIt.scripts', scriptsTreeProvider));
	let scriptsDirectoryWatcher: vscode.FileSystemWatcher | undefined;

	const watchScriptsDirectory = async (): Promise<void> => {
		if (scriptsDirectoryWatcher) {
			scriptsDirectoryWatcher.dispose();
			scriptsDirectoryWatcher = undefined;
		}

		try {
			const scriptsDirectory = await getScriptsDirectory();
			if (scriptsDirectory.scheme !== 'file') {
				return;
			}

			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(scriptsDirectory.fsPath, '*'));
			const refreshTree = (): void => scriptsTreeProvider.refresh();
			watcher.onDidCreate(refreshTree);
			watcher.onDidChange(refreshTree);
			watcher.onDidDelete(refreshTree);
			scriptsDirectoryWatcher = watcher;
			context.subscriptions.push(watcher);
		} catch (error) {
			console.error(`[QuickIt] Failed to watch scripts directory: ${toErrorMessage(error)}`);
		}
	};

	const addScriptCommand = vscode.commands.registerCommand('quick-it.addScript', async () => {
		try {
			const selectedScriptType = await vscode.window.showQuickPick(
				BUILTIN_SCRIPT_DESCRIPTORS.map((descriptor) => ({
					label: descriptor.label,
					detail: descriptor.extension,
					description: descriptor.languageId,
					descriptor
				})),
				{ title: 'Select a script type to create' }
			);
			if (!selectedScriptType) {
				return;
			}

			const scriptNameInput = await vscode.window.showInputBox({
				title: 'QuickIt: Script Name',
				prompt: `Enter a name for your ${selectedScriptType.descriptor.label} script`,
				placeHolder: `my-script${selectedScriptType.descriptor.extension}`,
				validateInput: (value) => validateScriptNameInput(value, selectedScriptType.descriptor.extension)
			});
			if (scriptNameInput === undefined) {
				return;
			}

			const scriptsDirectory = await getScriptsDirectory();
			await vscode.workspace.fs.createDirectory(scriptsDirectory);

			const scriptFileName = normalizeScriptFileName(scriptNameInput, selectedScriptType.descriptor.extension);
			const scriptUri = vscode.Uri.joinPath(scriptsDirectory, scriptFileName);
			if (await uriExists(scriptUri)) {
				const overwriteSelection = await vscode.window.showWarningMessage(
					`A script named "${scriptFileName}" already exists. Overwrite it?`,
					{ modal: true },
					'Overwrite'
				);
				if (overwriteSelection !== 'Overwrite') {
					return;
				}
			}

			await vscode.workspace.fs.writeFile(
				scriptUri,
				Buffer.from(getInitialTemplateForExtension(selectedScriptType.descriptor.extension), 'utf8')
			);
			scriptsTreeProvider.refresh();

			const scriptDocument = await vscode.workspace.openTextDocument(scriptUri);
			await vscode.window.showTextDocument(scriptDocument);
			void vscode.window.showInformationMessage(`Created "${scriptFileName}" in QuickIt.`);
		} catch (error) {
			notifyQuickItError('QuickIt failed to create the script', error);
		}
	});

	const openSettingsCommand = vscode.commands.registerCommand('quick-it.openSettings', async () => {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'quickIt');
	});

	const runScriptCommand = vscode.commands.registerCommand('quick-it.runScript', async (item?: ScriptItem) => {
		try {
			if (!item) {
				void vscode.window.showErrorMessage('No QuickIt script selected.');
				return;
			}

			const interpreterCommand = await resolveInterpreterCommand(item.descriptor);
			if (!interpreterCommand) {
				void vscode.window.showErrorMessage(`No interpreter found for ${item.descriptor.label}. Configure one in QuickIt settings.`);
				return;
			}

			if (!(await isCommandAvailable(interpreterCommand))) {
				void vscode.window.showErrorMessage(`Interpreter "${interpreterCommand}" was not found on PATH.`);
				return;
			}

			const scriptName = path.basename(item.uri.fsPath);
			void vscode.window.showInformationMessage(`QuickIt: Executing "${scriptName}"...`);

			const runId = createRunId();
			const task = createQuickItShellTask(
				{ type: 'quick-it', runId },
				`QuickIt: ${scriptName}`,
				item.descriptor.buildRunCommand(interpreterCommand, item.uri.fsPath)
			);

			const exitCode = await executeQuickItTask(task, runId);
			if (exitCode === undefined || exitCode === 0) {
				void vscode.window.showInformationMessage(`QuickIt: Finished "${scriptName}".`);
				return;
			}

			void vscode.window.showWarningMessage(`QuickIt: Finished "${scriptName}" (exit code ${exitCode}).`);
		} catch (error) {
			notifyQuickItError('QuickIt failed to run the selected script', error);
		}
	});

	const editScriptCommand = vscode.commands.registerCommand('quick-it.editScript', async (item?: ScriptItem) => {
		try {
			if (!item) {
				void vscode.window.showErrorMessage('No QuickIt script selected.');
				return;
			}

			const document = await vscode.workspace.openTextDocument(item.uri);
			await vscode.window.showTextDocument(document);
		} catch (error) {
			notifyQuickItError('QuickIt failed to open the selected script', error);
		}
	});

	const removeScriptCommand = vscode.commands.registerCommand('quick-it.removeScript', async (item?: ScriptItem) => {
		try {
			if (!item) {
				void vscode.window.showErrorMessage('No QuickIt script selected.');
				return;
			}

			const scriptName = path.basename(item.uri.fsPath);
			const confirmation = await vscode.window.showWarningMessage(
				`Remove "${scriptName}" from QuickIt?`,
				{ modal: true },
				'Remove'
			);
			if (confirmation !== 'Remove') {
				return;
			}

			if (!(await uriExists(item.uri))) {
				void vscode.window.showWarningMessage(`"${scriptName}" was already removed.`);
				scriptsTreeProvider.refresh();
				return;
			}

			await vscode.workspace.fs.delete(item.uri, { useTrash: true });
			scriptsTreeProvider.refresh();
		} catch (error) {
			notifyQuickItError('QuickIt failed to remove the selected script', error);
		}
	});

	const saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
		void handleDocumentSaved(document);
	});

	const renameSubscription = vscode.workspace.onDidRenameFiles(() => {
		scriptsTreeProvider.refresh();
	});

	const createSubscription = vscode.workspace.onDidCreateFiles(() => {
		scriptsTreeProvider.refresh();
	});

	const deleteSubscription = vscode.workspace.onDidDeleteFiles(() => {
		scriptsTreeProvider.refresh();
	});

	const configChangeSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
		if (!event.affectsConfiguration('quickIt')) {
			return;
		}

		scriptsTreeProvider.refresh();
		void watchScriptsDirectory();
	});

	context.subscriptions.push(
		addScriptCommand,
		openSettingsCommand,
		runScriptCommand,
		editScriptCommand,
		removeScriptCommand,
		saveSubscription,
		renameSubscription,
		createSubscription,
		deleteSubscription,
		configChangeSubscription
	);

	void ensureScriptsDirectoryExists(getScriptsDirectory);
	void watchScriptsDirectory();
	void showSafetyNoticeOnce(context);

	const handleDocumentSaved = async (document: vscode.TextDocument): Promise<void> => {
		try {
			if (await isInScriptsDirectory(document.uri, getScriptsDirectory)) {
				scriptsTreeProvider.refresh();
			}
		} catch (error) {
			console.error(`[QuickIt] Failed to refresh scripts after save: ${toErrorMessage(error)}`);
		}
	};

	const api: QuickItApi = {
		registerInterpreter(extension: string, command: string, label?: string): vscode.Disposable {
			const normalizedExtension = normalizeExtension(extension);
			if (!normalizedExtension) {
				throw new Error('Extension must be provided.');
			}

			const normalizedCommand = command.trim();
			if (!normalizedCommand) {
				throw new Error('Interpreter command must be provided.');
			}

			if (BUILTIN_BY_EXTENSION.has(normalizedExtension)) {
				throw new Error(`"${normalizedExtension}" is already handled by a built-in QuickIt interpreter.`);
			}

			customInterpreters.set(normalizedExtension, { command: normalizedCommand, label });
			scriptsTreeProvider.refresh();

			return new vscode.Disposable(() => {
				const currentValue = customInterpreters.get(normalizedExtension);
				if (!currentValue || currentValue.command !== normalizedCommand) {
					return;
				}

				customInterpreters.delete(normalizedExtension);
				scriptsTreeProvider.refresh();
			});
		}
	};

	return api;

	async function resolveInterpreterCommand(descriptor: ScriptDescriptor): Promise<string | undefined> {
		if (descriptor.interpreterSetting) {
			const configuredValue = getQuickItSettingValue(descriptor.interpreterSetting);
			if (configuredValue) {
				return configuredValue;
			}
		}

		for (const candidate of descriptor.getDefaultInterpreters()) {
			if (await isCommandAvailable(candidate)) {
				return candidate;
			}
		}

		return undefined;
	}
}

export function deactivate(): void {
}

async function showSafetyNoticeOnce(context: vscode.ExtensionContext): Promise<void> {
	const hasShownNotice = context.globalState.get<boolean>(SAFETY_NOTICE_STATE_KEY);
	if (hasShownNotice) {
		return;
	}

	void vscode.window.showWarningMessage('QuickIt runs local scripts. Only run scripts and interpreters you trust.');
	await context.globalState.update(SAFETY_NOTICE_STATE_KEY, true);
}

async function resolveScriptsDirectory(
	context: vscode.ExtensionContext,
	getQuickItSettingValue: (settingPath: string) => string | undefined
): Promise<vscode.Uri> {
	const configuredDirectory = getQuickItSettingValue('scriptDirectory');
	if (configuredDirectory) {
		return vscode.Uri.file(resolveDirectoryPath(configuredDirectory));
	}

	return vscode.Uri.joinPath(context.globalStorageUri, 'scripts');
}

async function ensureScriptsDirectoryExists(getScriptsDirectory: () => Promise<vscode.Uri>): Promise<void> {
	try {
		await vscode.workspace.fs.createDirectory(await getScriptsDirectory());
	} catch (error) {
		notifyQuickItError('QuickIt failed to create its scripts directory', error);
	}
}

async function isInScriptsDirectory(
	uri: vscode.Uri,
	getScriptsDirectory: () => Promise<vscode.Uri>
): Promise<boolean> {
	if (uri.scheme !== 'file') {
		return false;
	}

	const scriptsDirectory = await getScriptsDirectory();
	if (scriptsDirectory.scheme !== 'file') {
		return false;
	}

	return isPathInside(scriptsDirectory.fsPath, uri.fsPath);
}

function normalizeExtension(extension: string): string {
	const normalizedValue = extension.trim().toLowerCase();
	if (!normalizedValue) {
		return '';
	}

	return normalizedValue.startsWith('.') ? normalizedValue : `.${normalizedValue}`;
}

function normalizeScriptFileName(rawName: string, extension: string): string {
	const trimmedName = rawName.trim();
	const normalizedExtension = normalizeExtension(extension);
	const existingExtension = normalizeExtension(path.extname(trimmedName));
	if (existingExtension && existingExtension === normalizedExtension) {
		return trimmedName;
	}

	return `${trimmedName}${normalizedExtension}`;
}

function validateScriptNameInput(value: string, extension: string): string | undefined {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return 'Script name is required.';
	}

	if (trimmedValue === '.' || trimmedValue === '..') {
		return 'Enter a valid script name.';
	}

	if (/[\\/]/.test(trimmedValue)) {
		return 'Use only a file name, not a path.';
	}

	if (/[<>:"|?*\x00-\x1F]/.test(trimmedValue)) {
		return 'Name contains invalid filename characters.';
	}

	if (/[. ]$/.test(trimmedValue)) {
		return 'Name cannot end with a period or space.';
	}

	const expectedExtension = normalizeExtension(extension);
	if (trimmedValue.toLowerCase() === expectedExtension) {
		return `Enter a file name before ${expectedExtension}.`;
	}

	const fileNameBase = path.parse(trimmedValue).name.toLowerCase();
	if (WINDOWS_RESERVED_BASENAMES.has(fileNameBase)) {
		return 'Name is reserved on Windows.';
	}

	const providedExtension = normalizeExtension(path.extname(trimmedValue));
	if (providedExtension && providedExtension !== expectedExtension) {
		return `Use ${expectedExtension} or leave the extension blank.`;
	}

	return undefined;
}

function resolveDirectoryPath(inputPath: string): string {
	const expandedPath = inputPath === '~'
		? os.homedir()
		: inputPath.startsWith('~/') || inputPath.startsWith('~\\')
			? path.join(os.homedir(), inputPath.slice(2))
			: inputPath;
	return path.isAbsolute(expandedPath)
		? expandedPath
		: path.resolve(os.homedir(), expandedPath);
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

function isPathInside(directoryPath: string, filePath: string): boolean {
	const resolvedDirectory = path.resolve(directoryPath);
	const resolvedFile = path.resolve(filePath);
	const normalizedDirectory = process.platform === 'win32' ? resolvedDirectory.toLowerCase() : resolvedDirectory;
	const normalizedFile = process.platform === 'win32' ? resolvedFile.toLowerCase() : resolvedFile;

	if (normalizedFile === normalizedDirectory) {
		return true;
	}

	return normalizedFile.startsWith(`${normalizedDirectory}${path.sep}`);
}

function getInitialTemplateForExtension(extension: string): string {
	switch (extension) {
	case '.ps1':
		return '# QuickIt PowerShell script\n';
	case '.sh':
		return '#!/usr/bin/env bash\n';
	case '.zsh':
		return '#!/usr/bin/env zsh\n';
	case '.py':
		return '#!/usr/bin/env python3\n';
	case '.js':
		return '// QuickIt JavaScript script\n';
	case '.ts':
		return '// QuickIt TypeScript script\n';
	default:
		return '';
	}
}

async function isCommandAvailable(command: string): Promise<boolean> {
	const executable = extractCommandToken(command);
	if (!executable) {
		return false;
	}

	if (path.isAbsolute(executable)) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(executable));
			return true;
		} catch {
			return false;
		}
	}

	try {
		await execFile(process.platform === 'win32' ? 'where.exe' : 'which', [executable]);
		return true;
	} catch {
		return false;
	}
}

function extractCommandToken(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) {
		return '';
	}

	if (trimmed.startsWith('"') || trimmed.startsWith('\'')) {
		const quote = trimmed[0];
		const closingIndex = trimmed.indexOf(quote, 1);
		if (closingIndex > 1) {
			return trimmed.slice(1, closingIndex);
		}
	}

	const separatorIndex = trimmed.search(/\s/);
	return separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
}

function quoteForCommandArgument(value: string): string {
	if (process.platform === 'win32') {
		return `"${value.replace(/"/g, '""')}"`;
	}

	return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

function getQuickItConfigurationValue(settingPath: string): { value: string | undefined; hasWorkspaceOverride: boolean } {
	const configuration = vscode.workspace.getConfiguration('quickIt');
	const inspected = configuration.inspect<string>(settingPath);
	if (!inspected) {
		return {
			value: normalizeOptionalString(configuration.get<string>(settingPath)),
			hasWorkspaceOverride: false
		};
	}

	const value = normalizeOptionalString(inspected.globalValue ?? inspected.defaultValue ?? configuration.get<string>(settingPath));
	const hasWorkspaceOverride = inspected.workspaceValue !== undefined || inspected.workspaceFolderValue !== undefined;
	return { value, hasWorkspaceOverride };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function notifyQuickItError(prefix: string, error: unknown): void {
	void vscode.window.showErrorMessage(`${prefix}: ${toErrorMessage(error)}`);
}

function createRunId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createQuickItShellTask(definition: vscode.TaskDefinition, name: string, commandLine: string): vscode.Task {
	const task = new vscode.Task(
		definition,
		vscode.TaskScope.Global,
		name,
		'QuickIt',
		new vscode.ShellExecution(commandLine)
	);

	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		panel: vscode.TaskPanelKind.Dedicated,
		clear: true,
		showReuseMessage: false
	};

	return task;
}

async function executeQuickItTask(task: vscode.Task, runId: string): Promise<number | undefined> {
	return await new Promise<number | undefined>((resolve, reject) => {
		let settled = false;
		const settle = (callback: () => void): void => {
			if (settled) {
				return;
			}

			settled = true;
			endTaskSubscription.dispose();
			endTaskProcessSubscription.dispose();
			callback();
		};

		const endTaskProcessSubscription = vscode.tasks.onDidEndTaskProcess((event) => {
			const definition = event.execution.task.definition as { type?: unknown; runId?: unknown } | undefined;
			if (definition?.type !== 'quick-it' || definition.runId !== runId) {
				return;
			}

			settle(() => resolve(event.exitCode));
		});

		const endTaskSubscription = vscode.tasks.onDidEndTask((event) => {
			const definition = event.execution.task.definition as { type?: unknown; runId?: unknown } | undefined;
			if (definition?.type !== 'quick-it' || definition.runId !== runId) {
				return;
			}

			settle(() => resolve(undefined));
		});

		vscode.tasks.executeTask(task).then(
			() => undefined,
			(error) => settle(() => reject(error))
		);
	});
}

export const __test__ = {
	ScriptsTreeProvider,
	BUILTIN_BY_EXTENSION,
	getInitialTemplateForExtension,
	isPathInside,
	normalizeExtension,
	normalizeScriptFileName,
	resolveDirectoryPath,
	validateScriptNameInput
};
