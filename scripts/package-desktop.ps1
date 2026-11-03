param(
  [switch]$SkipWebBuild,
  [switch]$FrameworkDependent,
  [switch]$SkipArchive,
  [ValidatePattern('^AgentFleet(?:-[0-9]+\.[0-9]+\.[0-9]+)?$')]
  [string]$OutputName = 'AgentFleet'
)
$ErrorActionPreference = 'Stop'
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publishPath = [System.IO.Path]::GetFullPath((Join-Path $workspacePath '.tmp\desktop-publish'))
$compiledPath = [System.IO.Path]::GetFullPath((Join-Path $workspacePath '.tmp\desktop-compiled'))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $workspacePath "dist\$OutputName"))
if (!$publishPath.StartsWith($workspacePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Publish path outside workspace' }
if (!$compiledPath.StartsWith($workspacePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Compiled path outside workspace' }
Push-Location -LiteralPath $workspacePath
try {
  $nodeTarget = (& node -p "process.platform + ':' + process.arch").Trim()
  if ($nodeTarget -ne 'win32:x64') { throw 'Desktop packaging requires Windows x64 Node.js' }
  if (!$SkipWebBuild) { & npm run build:web; if ($LASTEXITCODE -ne 0) { throw 'Web build failed' } }
  foreach ($generatedPath in @($publishPath, $compiledPath)) { if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath -Recurse -Force } }
  & npx --no-install tsc --project desktop/tsconfig.runtime.json
  if ($LASTEXITCODE -ne 0) { throw 'Server compilation failed' }
  $selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }
  & dotnet publish desktop/AgentFleet.csproj -c Release -r win-x64 --self-contained $selfContained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=None -p:DebugSymbols=false -o $publishPath
  if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed' }
  & node scripts/package-desktop.mjs $publishPath $outputPath
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
  if (!$SkipArchive) {
    $zipPath = Join-Path $workspacePath 'dist\AgentFleet-2.2.0-win-x64.zip'
    Compress-Archive -LiteralPath $outputPath -DestinationPath $zipPath -Force
    Get-Item -LiteralPath $zipPath | Select-Object FullName,Length
  }
} finally { Pop-Location }
