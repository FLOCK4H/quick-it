<div align="center">
  <img src="media/quick-it-logo-white.png" alt="QuickIt Logo" width="220"/>
</div>

# QuickIt

Run and manage your personal automation scripts directly from the VS Code sidebar.

QuickIt gives you a dedicated **Activity Bar view** to create, organize, edit, run, and remove reusable scripts without jumping between terminals or project-specific task files.

## Installation

### Option 1: Run in development mode

```bash
npm install
npm run compile
```

Open the project in VS Code and press `F5` (Run Extension).  
QuickIt will load in a new Extension Development Host window.

### Option 2: Install from a VSIX package

```bash
npm install
npm run compile
npx @vscode/vsce package
```

Then install the generated `.vsix` file:

1. Open VS Code
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run `Extensions: Install from VSIX...`
4. Select the generated `.vsix` file from this repository
5. Reload VS Code if prompted

Tip: if the Extensions `...` menu item is missing in your layout, use the Command Palette flow above.

## Why QuickIt

- Central script library that persists across workspaces
- One-click run/edit/remove actions from a tree view
- Built-in support for PowerShell, Bash/Zsh, Python, JavaScript, and TypeScript
- Configurable interpreters and script storage directory
- Secure-by-default settings behavior (workspace overrides are ignored)

## Features

### Script sidebar

- Activity Bar icon opens the **QuickIt** panel
- `Scripts` view shows supported scripts from your QuickIt storage folder
- Inline actions on each item:
  - Run
  - Edit
  - Remove

### Add scripts fast

1. Click **Add Script** in the view title bar.
2. Choose a script type.
3. Enter script name once.
4. QuickIt creates the file in its scripts directory and opens it instantly.

No Save As flow is required.

### Run scripts with the right interpreter

QuickIt maps script extensions to interpreter commands:

- `.ps1` -> PowerShell (`pwsh`/`powershell`)
- `.sh`, `.zsh` -> Bash (`bash`)
- `.py` -> Python (`python`)
- `.js` -> Node.js (`node`)
- `.ts` -> ts-node (`ts-node`)

You can override each interpreter in settings.

### Global persistence

By default, scripts are stored under extension global storage, so they remain available across all workspaces and after restart.

## Commands

| Command | ID |
|---|---|
| Add Script | `quick-it.addScript` |
| Run Script | `quick-it.runScript` |
| Edit Script | `quick-it.editScript` |
| Remove Script | `quick-it.removeScript` |
| Open Settings | `quick-it.openSettings` |

## Configuration

All QuickIt settings are machine-scoped for safety.

| Setting | Type | Default | Description |
|---|---|---|---|
| `quickIt.scriptDirectory` | string | `""` | Optional custom script folder. Empty means extension global storage. |
| `quickIt.interpreters.powershell` | string | `""` | Interpreter command for `.ps1`. |
| `quickIt.interpreters.bash` | string | `""` | Interpreter command for `.sh` and `.zsh`. |
| `quickIt.interpreters.python` | string | `""` | Interpreter command for `.py`. |
| `quickIt.interpreters.node` | string | `""` | Interpreter command for `.js`. |
| `quickIt.interpreters.tsNode` | string | `""` | Interpreter command for `.ts`. |

## Security Notes

- QuickIt executes **user-authored local scripts** in an integrated terminal.
- QuickIt does not upload scripts.
- Workspace-level `quickIt.*` settings are ignored to reduce configuration-injection risk from untrusted repositories.
- Treat scripts and interpreter configuration as code execution surfaces.

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- VS Code 1.105+

### Setup

```bash
npm install
npm run compile
npm run lint
npm test
```

### Package extension

```bash
npm run vscode:prepublish
```

## License

MIT. See `LICENSE`.
