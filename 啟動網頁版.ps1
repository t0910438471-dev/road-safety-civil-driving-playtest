[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$staticRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $staticRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

function Get-ContentType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.js' { return 'text/javascript; charset=utf-8' }
        '.css' { return 'text/css; charset=utf-8' }
        '.wasm' { return 'application/wasm' }
        '.pck' { return 'application/octet-stream' }
        '.png' { return 'image/png' }
        '.svg' { return 'image/svg+xml' }
        default { return 'application/octet-stream' }
    }
}

function Resolve-RequestedFile([string]$absolutePath) {
    $relativePath = [System.Uri]::UnescapeDataString($absolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relativePath) -or $relativePath.EndsWith('/')) {
        $relativePath += 'index.html'
    }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $staticRoot $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
    if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    return $candidate
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
try {
    $address = "http://127.0.0.1:$Port/"
    Write-Host "Road Safety Civilized Driving Web is running: $address"
    Write-Host 'Close this window to stop the local server.'
    if (-not $NoBrowser) { Start-Process $address }

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $filePath = Resolve-RequestedFile $context.Request.Url.AbsolutePath
            if ($null -eq $filePath) {
                $context.Response.StatusCode = 404
                continue
            }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $context.Response.StatusCode = 200
            $context.Response.ContentType = Get-ContentType $filePath
            $context.Response.Headers['Cache-Control'] = 'no-store'
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } finally {
            $context.Response.Close()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
