import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { __test__ } from '../extension';

suite('QuickIt', () => {
	test('validateScriptNameInput validates names and extensions', () => {
		assert.ok(__test__.validateScriptNameInput('', '.ps1'));
		assert.ok(__test__.validateScriptNameInput('..', '.ps1'));
		assert.ok(__test__.validateScriptNameInput('path/to/script', '.ps1'));
		assert.ok(__test__.validateScriptNameInput('script.sh', '.ps1'));
		assert.ok(__test__.validateScriptNameInput('.ps1', '.ps1'));
		assert.ok(__test__.validateScriptNameInput('name.', '.ps1'));
		assert.ok(__test__.validateScriptNameInput('con', '.ps1'));

		assert.strictEqual(__test__.validateScriptNameInput('my-script', '.ps1'), undefined);
		assert.strictEqual(__test__.validateScriptNameInput('my-script.ps1', '.ps1'), undefined);
	});

	test('normalizeScriptFileName appends missing extension', () => {
		assert.strictEqual(__test__.normalizeScriptFileName('script', '.ps1'), 'script.ps1');
		assert.strictEqual(__test__.normalizeScriptFileName('script.ps1', '.ps1'), 'script.ps1');
	});

	test('resolveDirectoryPath expands tilde', () => {
		assert.strictEqual(__test__.resolveDirectoryPath('~'), os.homedir());
		assert.strictEqual(__test__.resolveDirectoryPath('~/quick-it'), path.resolve(os.homedir(), 'quick-it'));
		assert.strictEqual(__test__.resolveDirectoryPath('~\\quick-it'), path.resolve(os.homedir(), 'quick-it'));
	});

	test('ScriptsTreeProvider filters unsupported scripts and sorts results', async () => {
		const tempDir = path.join(os.tmpdir(), `quick-it-test-${Date.now()}`);
		const tempUri = vscode.Uri.file(tempDir);
		await vscode.workspace.fs.createDirectory(tempUri);

		try {
			for (const fileName of ['b.ps1', 'A.sh', 'c.txt']) {
				await vscode.workspace.fs.writeFile(
					vscode.Uri.joinPath(tempUri, fileName),
					Buffer.from('echo test', 'utf8')
				);
			}

			const provider = new __test__.ScriptsTreeProvider(
				async () => tempUri,
				(uri) => {
					const extension = __test__.normalizeExtension(path.extname(uri.fsPath));
					return __test__.BUILTIN_BY_EXTENSION.get(extension);
				}
			);

			const scripts = await provider.getChildren();
			assert.strictEqual(scripts.length, 2);

			const labels = scripts.map((item) => (typeof item.label === 'string' ? item.label : item.label?.label));
			assert.deepStrictEqual(labels, ['A.sh', 'b.ps1']);
		} finally {
			await vscode.workspace.fs.delete(tempUri, { recursive: true, useTrash: false });
		}
	});
});
