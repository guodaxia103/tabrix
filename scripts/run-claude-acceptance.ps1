param(
  [ValidateSet('fast', 'full')]
  [string]$Profile = 'fast',
  [string]$OutDir = '.tmp/claude-acceptance',
  [string]$BaseUrl = 'http://127.0.0.1:62100/'
)

$ErrorActionPreference = 'Continue'
$script:SmokeServerProcess = $null
$script:SmokeServerPort = 62100

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

function Run-Case {
  param(
    [string]$Name,
    [string]$Prompt
  )
  Write-Host "Running $Name ..."
  $out = claude -p --permission-mode bypassPermissions $Prompt 2>&1
  $file = Join-Path $OutDir "$Name.txt"
  $out | Out-File -FilePath $file -Encoding utf8
}

New-Item -ItemType Directory -Force $OutDir | Out-Null

try {
  Stop-SmokeServer
  Start-SmokeServer

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
2) chrome_upload_file(selector=#fileInput,filePath=E:/projects/AI/copaw/mcp-chrome/.tmp/artifacts/upload.txt)
3) chrome_request_element_selection(requests=[{name:'Login按钮'}],timeoutMs=5000)
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
  Stop-SmokeServer
}
