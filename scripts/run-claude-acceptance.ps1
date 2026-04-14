param(
  [ValidateSet('fast', 'full')]
  [string]$Profile = 'fast',
  [string]$OutDir = '.tmp/claude-acceptance',
  [string]$BaseUrl = 'http://127.0.0.1:62100/'
)

$ErrorActionPreference = 'Continue'
$script:SmokeServerProcess = $null
$script:SmokeServerPort = 62100
$script:BridgeProbeListener = $null
$script:BridgeProbeResult = $null
$script:UploadArtifactPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.tmp/artifacts/upload.txt'
$script:ClaudeMcpConfigPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.tmp/claude-tabrix-mcp.json'
$script:ExtensionConnectUrl = 'chrome-extension://njlidkjgkcccdoffkfcbgiefdpaipfdn/connect.html'

function Wait-PortReady {
  param(
    [int]$Port,
    [int]$TimeoutSec = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $Port } |
      Select-Object -First 1
    if ($listening) {
      return $true
    }
    Start-Sleep -Milliseconds 300
  }

  return $false
}

function Stop-SmokeServer {
  if ($script:SmokeServerProcess) {
    try {
      if (-not $script:SmokeServerProcess.HasExited) {
        Stop-Process -Id $script:SmokeServerProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $script:SmokeServerProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
      }
    } catch {
      # ignore cleanup failures
    } finally {
      $script:SmokeServerProcess = $null
    }
  }

  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $script:SmokeServerPort } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
      } catch {
        # ignore cleanup failures
      }
    }
}

function Start-SmokeServer {
  $serverScript = Join-Path $PSScriptRoot 'claude-smoke-server.cjs'
  $script:SmokeServerProcess = Start-Process -FilePath 'node' `
    -ArgumentList $serverScript `
    -WorkingDirectory (Split-Path $PSScriptRoot -Parent) `
    -WindowStyle Hidden `
    -PassThru

  if (-not (Wait-PortReady -Port $script:SmokeServerPort -TimeoutSec 10)) {
    Stop-SmokeServer
    throw "Smoke server failed to start on port $script:SmokeServerPort"
  }
}

function Stop-BridgeProbeListener {
  if ($script:BridgeProbeListener) {
    try {
      $script:BridgeProbeListener.Stop()
      $script:BridgeProbeListener.Close()
    } catch {
      # ignore cleanup failures
    } finally {
      $script:BridgeProbeListener = $null
    }
  }
}

function Ensure-AcceptanceArtifacts {
  $artifactDir = Split-Path $script:UploadArtifactPath -Parent
  New-Item -ItemType Directory -Force $artifactDir | Out-Null
  Set-Content -Path $script:UploadArtifactPath -Value 'tabrix-claude-upload' -Encoding utf8
}

function Ensure-ClaudeMcpConfig {
  $tokenFile = Join-Path $env:USERPROFILE '.tabrix/auth-token.json'
  if (-not (Test-Path $tokenFile)) {
    throw "Missing Tabrix auth token file: $tokenFile"
  }

  $token = (Get-Content $tokenFile -Raw | ConvertFrom-Json).token
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'Tabrix auth token is empty.'
  }

  $configDir = Split-Path $script:ClaudeMcpConfigPath -Parent
  New-Item -ItemType Directory -Force $configDir | Out-Null

  @{
    mcpServers = @{
      tabrix = @{
        type = 'http'
        url = 'http://192.168.5.69:12306/mcp'
        headers = @{
          Authorization = "Bearer $token"
        }
      }
    }
  } | ConvertTo-Json -Depth 8 | Set-Content -Path $script:ClaudeMcpConfigPath -Encoding utf8
}

function Wait-TabrixBridgeReady {
  param(
    [int]$TimeoutSec = 15
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = tabrix status --json | ConvertFrom-Json
      if ($status.data.nativeHostAttached) {
        return $true
      }
    } catch {
      # keep polling
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Ensure-TabrixBridge {
  if (Wait-TabrixBridgeReady -TimeoutSec 2) {
    return
  }

  $chromePath = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if (-not $chromePath) {
    throw 'Chrome executable not found while ensuring Tabrix bridge.'
  }

  Stop-BridgeProbeListener
  $script:BridgeProbeResult = $null
  $probePort = 62101
  $listener = [System.Net.HttpListener]::new()
  $listener.Prefixes.Add("http://127.0.0.1:$probePort/")
  $listener.Start()
  $script:BridgeProbeListener = $listener

  $connectUrl = "$script:ExtensionConnectUrl?callback=http://127.0.0.1:$probePort/"
  Start-Process -FilePath $chromePath -ArgumentList $connectUrl | Out-Null

  $asyncContext = $listener.BeginGetContext($null, $null)
  if ($asyncContext.AsyncWaitHandle.WaitOne([TimeSpan]::FromSeconds(15))) {
    try {
      $context = $listener.EndGetContext($asyncContext)
      $reader = [System.IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
      $body = $reader.ReadToEnd()
      $reader.Dispose()
      $script:BridgeProbeResult = if ($body) { $body | ConvertFrom-Json } else { $null }
      $buffer = [System.Text.Encoding]::UTF8.GetBytes('ok')
      $context.Response.StatusCode = 200
      $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
      $context.Response.OutputStream.Close()
    } catch {
      $script:BridgeProbeResult = @{
        status = 'error'
        reason = "probe callback failed: $($_.Exception.Message)"
      }
    }
  }

  Stop-BridgeProbeListener

  if (-not (Wait-TabrixBridgeReady -TimeoutSec 20)) {
    $probeDetail = if ($script:BridgeProbeResult) {
      ($script:BridgeProbeResult | ConvertTo-Json -Depth 8 -Compress)
    } else {
      'no connect callback received'
    }
    throw "Tabrix bridge did not attach after opening connect.html. Detail: $probeDetail"
  }
}

function Run-Case {
  param(
    [string]$Name,
    [string]$Prompt
  )
  Write-Host "Running $Name ..."
  $prefixedPrompt = @"
仅使用已连接的 tabrix MCP 工具完成以下任务。
不要使用 Playwright 或其他 MCP/内置浏览器工具。
如果 tabrix 工具不可用，请明确说明“tabrix 不可用”，不要回退到其它工具。

$Prompt
"@
  $out = claude -p --permission-mode bypassPermissions --mcp-config $script:ClaudeMcpConfigPath --strict-mcp-config $prefixedPrompt 2>&1
  $file = Join-Path $OutDir "$Name.txt"
  $out | Out-File -FilePath $file -Encoding utf8
}

New-Item -ItemType Directory -Force $OutDir | Out-Null

try {
  Stop-SmokeServer
  Ensure-AcceptanceArtifacts
  Ensure-ClaudeMcpConfig
  Start-SmokeServer
  Ensure-TabrixBridge

  $cases = @(
    @{
      name = 'group-core-1'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) get_windows_and_tabs
2) chrome_navigate 打开 $BaseUrl
3) chrome_get_web_content 读取文本
4) chrome_read_page(filter=interactive, depth=3)
5) chrome_get_interactive_elements(textQuery=Download)
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-core-2'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_click_element 点击 #clickBtn
2) chrome_fill_or_select 填 #textInput=hello-tabrix
3) chrome_keyboard 对 #textInput 执行 Ctrl+A Backspace 并输入 world
4) chrome_javascript 读取 #textInput 当前值
5) chrome_console(snapshot)
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-core-3'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_network_request 请求 ${BaseUrl}json
2) chrome_network_capture start(includeStatic=false) -> 再请求 ${BaseUrl}json -> stop
3) chrome_screenshot(savePng=true,name=claude-fast-shot)
4) chrome_history 查询最近1小时 127.0.0.1:62100
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-core-4'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_bookmark_add(url=$BaseUrl,title=TabrixSmokeBookmarkFast)
2) chrome_bookmark_search(query=TabrixSmokeBookmarkFast)
3) chrome_bookmark_delete(url=$BaseUrl,title=TabrixSmokeBookmarkFast)
4) chrome_handle_download(url=${BaseUrl}download.txt, filename=claude-fast-download.txt, saveAs=false, waitForComplete=true)
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-core-5'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_switch_tab 切换到 URL 包含 127.0.0.1:62100 的标签
2) chrome_computer(action=screenshot, saveToDownloads=false)
3) performance_start_trace(autoStop=true,durationMs=1200)
4) performance_stop_trace(saveToDownloads=false)
5) performance_analyze_insight
最后给每一步返回 success/failed 摘要。
"@
    }
  )

  if ($Profile -eq 'full') {
    $cases += @(
    @{
      name = 'group-full-1-dialog'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl
2) chrome_click_element 点击 #promptBtn
3) chrome_handle_dialog(action=accept,promptText=tabrix-ok)
4) chrome_javascript 读取 #promptOut 文本
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-full-2-gif'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_gif_recorder(action=clear)
2) chrome_gif_recorder(action=start,durationMs=1200,fps=4,filename=claude-full-gif)
3) chrome_gif_recorder(action=stop)
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-full-3-upload-select'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl
2) chrome_upload_file(selector=#fileInput,filePath=$($script:UploadArtifactPath -replace '\\','/'))
3) chrome_request_element_selection(requests=[{name:'Login按钮'}],timeoutMs=5000)
最后给每一步返回 success/failed 摘要。
"@
      },
      @{
        name = 'group-full-4-close-tabs'
        prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 ${BaseUrl}page2.html 并使用 newWindow=true
2) get_windows_and_tabs 列出当前窗口和标签页
3) 找到标题为 Page2 或 URL 包含 /page2.html 的标签页并调用 chrome_switch_tab 切换过去
4) chrome_close_tabs 关闭刚才这个 Page2 标签页
最后给每一步返回 success/failed 摘要。
"@
      }
    )
  }

  $startedAt = Get-Date
  foreach ($case in $cases) {
    Run-Case -Name $case.name -Prompt $case.prompt
  }
  $endedAt = Get-Date

  $summary = [PSCustomObject]@{
    profile = $Profile
    outDir = (Resolve-Path $OutDir).Path
    startedAt = $startedAt.ToString('s')
    endedAt = $endedAt.ToString('s')
    elapsedSec = [math]::Round(($endedAt - $startedAt).TotalSeconds, 1)
    caseCount = $cases.Count
  }
  $summary | ConvertTo-Json | Out-File -FilePath (Join-Path $OutDir '_summary.json') -Encoding utf8
  Write-Host "Done. Summary written to $(Join-Path $OutDir '_summary.json')"
}
finally {
  Stop-BridgeProbeListener
  Stop-SmokeServer
}
