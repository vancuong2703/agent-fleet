# Agent Fleet Desktop

Native Windows host: C#/.NET 10 WinForms + Microsoft Edge WebView2. The app
uses the Windows WebView2 runtime and launches its bundled Node.js server with
`CreateNoWindow`, redirected output and a separate data directory. It does not
open a console window or an external browser for the workspace.

## Build portable EXE

From the repository root with Node.js 24, npm dependencies and .NET 10 SDK:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-desktop.ps1 -OutputName AgentFleet-2.2.0
```

Output: `dist/AgentFleet-2.2.0/AgentFleet.exe` and
`dist/AgentFleet-2.2.0-win-x64.zip`. Close the older app first. Extract the whole folder before opening the
EXE. The default build includes the .NET runtime, Node and only reachable
production Node dependencies. The server is compiled to JavaScript before packaging,
so no TypeScript runner or esbuild process stays running. WebView2 Evergreen
Runtime must be installed on Windows; Windows 11 normally includes it.

Without `-OutputName`, the output folder is `dist/AgentFleet`. `-FrameworkDependent` creates a smaller build for machines that already have
.NET 10 Windows Desktop Runtime. `-SkipWebBuild` reuses the current web build;
`-SkipArchive` skips ZIP creation. The output is a local unsigned portable
build; a signed MSI/MSIX/auto-update channel requires a signing certificate.

## Data, processes and close behavior

Data defaults to `%LOCALAPPDATA%\AgentFleetDesktop\`, separate from the older
CLI/web Fleet server. `FLEET_DESKTOP_DATA_DIR` or `--data-dir <directory>` selects
another directory. A named per-data-directory mutex prevents accidental duplicate
instances. The host allocates a loopback port and persists it in that profile's
`fleet.config.json`, preserving the other agent settings. API cookies are bootstrapped
through the existing local `/auth` route. Tokens stay in the data directory.

The host closes the server it started. If any tasks are running, queued or taken
over, a confirmation defaults to keeping the app open. A graceful server shutdown
runs first, then a bounded tree termination fallback. A Windows Job Object owns
the server tree and also terminates it if the desktop process crashes. Window size/position and the
WebView2 profile persist in the same data directory.

`server.log` receives server output. `desktop.log` records startup failures.
`resources.json` is an atomic native sample of the desktop descendant process
tree, taken every four seconds; CPU is normalized to the logical processor count.
RAM means the sum of process working sets and may include shared pages. GPU uses
Windows driver GPU Engine and GPU Process Memory counters in-process, with the
busiest engine across owned processes and their dedicated GPU memory. When the
driver counters are unavailable, `nvidia-smi.exe` is queried at most once every
15 seconds with a 1.5-second timeout, hidden; its reading is explicitly marked
as whole-system GPU usage. Every GPU sample has `scope` to distinguish the two.
GPU is `null` when neither source works; no usage or billing numbers are invented.

## Native bridge

The host injects `window.__FLEET_DESKTOP__ = { version: '2.2.0', platform: 'win32' }`.
The marker also includes the saved `theme` preference (`system`, `light`, `dark`).
Trusted `{type:'fleet:set-theme', theme}` messages persist the choice in
`desktop-settings.json` and update the native title bar, surviving random-port
changes between launches. The saved `layout` stores sidebar/inspector width and terminal
height through `fleet:set-layout`. Small viewports clamp only the rendered size, preserving
the preferred size for a larger window. Browser-local storage remains a web fallback.
Only messages from the exact authenticated loopback origin are accepted:

```javascript
window.chrome.webview.postMessage({
  type: 'fleet:open-path', requestId: crypto.randomUUID(),
  taskId: 't-example', // or planId; never an arbitrary root path
  relativePath: 'src/main.ts', action: 'reveal' // or 'open' for a directory
});
```

Replies are `fleet:native-result` messages with `requestId`, `ok` and optional
`error`. The native host resolves roots from the authenticated API, validates
relative containment, rejects symbolic links/junction traversal and opens Explorer.
Files are revealed, never executed. External navigation permits user-initiated
HTTP/HTTPS links only. Other protocols and browser permissions are blocked.
Reports downloaded from the trusted origin use a native Save dialog.

## Smoke test

```powershell
Start-Process -FilePath .\dist\AgentFleet-2.2.0\AgentFleet.exe -ArgumentList '--smoke-test --data-dir "C:\Qoder\agent-fleet-upgrade\.tmp\desktop-smoke"' -WindowStyle Hidden -Wait
```

The app boots, authenticates, verifies the React `.app` root and native marker,
records `desktop-smoke.json`, a WebView screenshot and native resource sample,
waits for native telemetry, verifies `/api/observability`, saves a dark preference
and then shuts down. Run twice with the same test profile to verify the second
run has `initialTheme: 'dark'` and `renderedTheme: 'dark'` despite a different
port. Exit code is nonzero on failure. Use a fresh directory and the
fake agent for any additional task smoke test; do not disturb a production profile.

Native policy regression tests:

```powershell
dotnet run --project desktop/tests/PathPolicy.Tests.csproj
```

The 17 cases cover safe/unsafe paths, canonical profile identity, TCP listener
ownership, job-object enumeration/kill-on-close and theme/layout persistence. Run outside the restricted
agent sandbox because Windows TCP ownership tables are filtered inside it.

See [2.1 release verification](../docs/releases/2.2.0.md) for the current build.

## Historical 2.0 build — 03/11/2026

- Self-contained Windows x64 EXE: 51,983,291 bytes; portable ZIP: 92,100,431 bytes.
- Unpacked folder: approximately 177.9 MiB; 90 runtime Node packages. The server
  runs compiled JavaScript directly, with no tsx/esbuild runtime processes.
- 15 native policy cases passed. Real native smoke launches passed twice with
  the same test profile and different loopback ports; dark theme persisted.
- The protected observability endpoint received native CPU/RAM/GPU samples.
  Both graceful closes removed the owned server PID file. A separate forced
  host termination test verified the Job Object terminated its owned Node server.
- One idle sample after startup: 0.16% machine-normalized CPU, 550.4 MiB summed
  working sets (includes shared pages), 325.0 MiB summed private memory, nine
  processes. This is an example on the development machine, not a resource cap.
  GPU driver counters reported app-scope utilization and dedicated GPU memory.
- Source SHA-256 values in `runtime-manifest.json` match 47 current source/build
  assets. Node's full license and available WebView2 license notices are included.

Evidence is local in `.tmp/desktop-smoke-final/` and
`.tmp/desktop-crash-test/`; these profiles are independent of the default app.
The restricted restore could not retrieve NuGet vulnerability metadata (NU1900);
the cached pinned package restored, compiled and published successfully.
