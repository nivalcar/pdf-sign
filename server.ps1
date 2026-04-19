param(
  [int]$Port = 8080
)

$root = $PSScriptRoot
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "Server running on http://localhost:$Port"
Write-Host "Root: $root"
Write-Host "Press Ctrl+C to stop the server"

$contentTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".pdf" = "application/pdf"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg" = "image/svg+xml"
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
      $relativePath = $request.Url.LocalPath
      if ($relativePath -eq "/") {
        $relativePath = "/index.html"
      }

      $safePath = $relativePath.TrimStart("/").Replace("/", "\")
      $fullPath = Join-Path $root $safePath

      if ((Test-Path $fullPath -PathType Leaf) -and $fullPath.StartsWith($root)) {
        $content = [System.IO.File]::ReadAllBytes($fullPath)
        $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $response.ContentType = $contentTypes[$extension]
        if (-not $response.ContentType) {
          $response.ContentType = "application/octet-stream"
        }
        $response.ContentLength64 = $content.Length
        $response.OutputStream.Write($content, 0, $content.Length)
      } else {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
      }
    } catch {
      $response.StatusCode = 500
      $message = [System.Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      $response.OutputStream.Write($message, 0, $message.Length)
    } finally {
      $response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
