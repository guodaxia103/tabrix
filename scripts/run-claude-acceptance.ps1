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
$script:CleanupTabsScriptPath = Join-Path $PSScriptRoot 'cleanup-acceptance-tabs.cjs'
$script:CaseTimeoutSec = 120

function Start-HiddenProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = ''
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

  if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
    $startInfo.WorkingDirectory = $WorkingDirectory
  }

  if ($ArgumentList.Count -gt 0) {
    $startInfo.Arguments = [string]::Join(' ', ($ArgumentList | ForEach-Object {
      if ($_ -match '\s|"') {
        '"' + ($_ -replace '"', '\"') + '"'
      } else {
        $_
      }
    }))
  }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  return $process
}

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
  $script:SmokeServerProcess = Start-HiddenProcess `
    -FilePath 'node' `
    -ArgumentList @($serverScript) `
    -WorkingDirectory (Split-Path $PSScriptRoot -Parent)

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

function Get-FreeBridgeProbePort {
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    $candidate = Get-Random -Minimum 62050 -Maximum 62999
    $inUse = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $candidate } |
      Select-Object -First 1
    if (-not $inUse) {
      return $candidate
    }
  }

  throw 'Failed to allocate a free bridge probe port.'
}

function Start-BridgeProbeListener {
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $probePort = Get-FreeBridgeProbePort
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:$probePort/")
    try {
      $listener.Start()
      return @{
        Port = $probePort
        Listener = $listener
      }
    } catch {
      try {
        $listener.Close()
      } catch {
        # ignore
      }
    }
  }

  throw 'Failed to start bridge probe listener.'
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
        url = 'http://127.0.0.1:12306/mcp'
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
      $bridge = $status.data.bridge
      if (
        $bridge -and
        $bridge.bridgeState -eq 'READY' -and
        (
          $bridge.commandChannelConnected -eq $true -or
          $status.data.nativeHostAttached -eq $true
        )
      ) {
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

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Stop-BridgeProbeListener
    $script:BridgeProbeResult = $null
    $probe = Start-BridgeProbeListener
    $probePort = $probe.Port
    $listener = $probe.Listener
    $script:BridgeProbeListener = $listener

    $callbackUrl = "http://127.0.0.1:$probePort/"
    $encodedCallbackUrl = [System.Uri]::EscapeDataString($callbackUrl)
    $connectUrl = "$script:ExtensionConnectUrl?callback=$encodedCallbackUrl"
    $chromeProcess = Start-HiddenProcess -FilePath $chromePath -ArgumentList @('--new-tab', $connectUrl)
    try {
      $chromeProcess.Dispose()
    } catch {
      # ignore process disposal failures
    }

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      $asyncContext = $listener.BeginGetContext($null, $null)
      if (-not $asyncContext.AsyncWaitHandle.WaitOne([TimeSpan]::FromSeconds(3))) {
        continue
      }

      try {
        $context = $listener.EndGetContext($asyncContext)
        $body = ''
        $queryPayload = $context.Request.QueryString['payload']
        if ($queryPayload) {
          $payload = $queryPayload | ConvertFrom-Json
        } else {
          $reader = [System.IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
          $body = $reader.ReadToEnd()
          $reader.Dispose()
          $payload = if ($body) { $body | ConvertFrom-Json } else { $null }
        }

        $buffer = [System.Text.Encoding]::UTF8.GetBytes('ok')
        $context.Response.StatusCode = 200
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
        $context.Response.OutputStream.Close()

        if ($payload) {
          $script:BridgeProbeResult = $payload
          if ($payload.status -and $payload.status -ne 'pending') {
            break
          }
        }
      } catch {
        $script:BridgeProbeResult = @{
          status = 'error'
          reason = "probe callback failed: $($_.Exception.Message)"
        }
        break
      }
    }

    Stop-BridgeProbeListener

    $callbackSucceeded =
      $script:BridgeProbeResult `
      -and $script:BridgeProbeResult.status -eq 'success' `
      -and $script:BridgeProbeResult.response `
      -and $script:BridgeProbeResult.response.success -eq $true `
      -and $script:BridgeProbeResult.response.connected -eq $true

    if ($callbackSucceeded) {
      return
    }

    Start-Sleep -Milliseconds 500
  }

  if (-not (Wait-TabrixBridgeReady -TimeoutSec 20)) {
    $probeDetail = if ($script:BridgeProbeResult) {
      ($script:BridgeProbeResult | ConvertTo-Json -Depth 8 -Compress)
    } else {
      'no connect callback received'
    }
    throw "Tabrix bridge did not attach after opening connect.html. Detail: $probeDetail"
  }
}

function Invoke-TabrixAcceptanceCleanup {
  if (-not (Test-Path $script:ClaudeMcpConfigPath) -or -not (Test-Path $script:CleanupTabsScriptPath)) {
    return
  }

  try {
    & node $script:CleanupTabsScriptPath `
      --config $script:ClaudeMcpConfigPath `
      --prefix $BaseUrl `
      --prefix $script:ExtensionConnectUrl | Out-Null
  } catch {
    # ignore cleanup failures
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
严格只按我给出的 URL、选择器、参数执行，不要自行改写为 data: URL、其它网站 URL 或其它选择器。
如果某一步失败，请直接标记 failed，不要用 JS 注入、用户脚本或其它旁路方法伪造成功。

$Prompt
"@
  $file = Join-Path $OutDir "$Name.txt"
  $job = $null

  try {
    $job = Start-Job -ScriptBlock {
      param($ConfigPath, $PromptText, $OutputPath)
      New-Item -ItemType Directory -Force (Split-Path $OutputPath -Parent) | Out-Null
      $out = claude -p --permission-mode bypassPermissions --mcp-config $ConfigPath --strict-mcp-config $PromptText 2>&1
      $out | Out-File -FilePath $OutputPath -Encoding utf8
    } -ArgumentList $script:ClaudeMcpConfigPath, $prefixedPrompt, $file

    if (-not (Wait-Job -Job $job -Timeout $script:CaseTimeoutSec)) {
      Stop-Job -Job $job -ErrorAction SilentlyContinue
      "Timed out after $($script:CaseTimeoutSec)s while running $Name." | Out-File -FilePath $file -Encoding utf8
      throw "$Name timed out after $($script:CaseTimeoutSec)s"
    }

    Receive-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
  } finally {
    if ($job) {
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    Invoke-TabrixAcceptanceCleanup
  }
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

try {
  Stop-SmokeServer
  Ensure-AcceptanceArtifacts
  Ensure-ClaudeMcpConfig
  Start-SmokeServer
  Ensure-TabrixBridge
  Invoke-TabrixAcceptanceCleanup

  $cases = @(
    @{
      name = 'group-core-1'
      kind = 'unattended'
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
      kind = 'unattended'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl
2) chrome_click_element 点击 #clickBtn
3) chrome_fill_or_select 填 #textInput=hello-tabrix
4) chrome_keyboard 对 #textInput 执行 Ctrl+A, Backspace
5) chrome_fill_or_select 再填 #textInput=world
6) chrome_javascript 读取 #textInput 当前值
7) chrome_console(snapshot)
注意：chrome_keyboard 只用于快捷键或特殊按键，不要把纯文本 world 作为 keys 传入。
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-core-3'
      kind = 'unattended'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl
2) chrome_network_request 请求 ${BaseUrl}json
3) chrome_network_capture start(includeStatic=false) -> 再请求 ${BaseUrl}json -> stop
4) chrome_screenshot(savePng=true,name=claude-fast-shot)
5) chrome_history 查询最近1小时 127.0.0.1:62100
最后给每一步返回 success/failed 摘要；如果当前活动标签页不是普通网页，先切回 $BaseUrl 再继续。
"@
    },
    @{
      name = 'group-core-4'
      kind = 'unattended'
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
      kind = 'unattended'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl
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
      kind = 'unattended'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl，并记住返回的 tabId
2) 在同一个 tabId 上调用 chrome_click_element 点击 #promptBtn
3) 立即在同一个 tabId 上调用 chrome_handle_dialog(action=accept,promptText=tabrix-ok)，不要等待页面变化
4) 再在同一个 tabId 上调用 chrome_javascript 读取 #promptOut 文本
要求：第 2-4 步必须始终使用同一个 tabId；第 3 步必须只使用 chrome_handle_dialog；如果失败，直接标记 failed，不要改用 JS 注入或其它绕过方式。
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-full-2-gif'
      kind = 'unattended'
      prompt = @"
请使用 tabrix 工具一次会话连续完成：
1) chrome_navigate 打开 $BaseUrl，确保当前标签页是普通网页而不是 chrome:// 或扩展页面
2) chrome_gif_recorder(action=clear)
3) chrome_gif_recorder(action=start,durationMs=4000,fps=4,filename=claude-full-gif)
4) chrome_gif_recorder(action=stop)
最后给每一步返回 success/failed 摘要。
"@
    },
    @{
      name = 'group-full-3-upload-select'
      kind = 'collaborative'
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
        kind = 'unattended'
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
    cases = @($cases | ForEach-Object { [PSCustomObject]@{ name = $_.name; kind = $_.kind } })
  }
  $summary | ConvertTo-Json | Out-File -FilePath (Join-Path $OutDir '_summary.json') -Encoding utf8
  Write-Host "Done. Summary written to $(Join-Path $OutDir '_summary.json')"
}
finally {
  Invoke-TabrixAcceptanceCleanup
  Stop-BridgeProbeListener
  Stop-SmokeServer
}
