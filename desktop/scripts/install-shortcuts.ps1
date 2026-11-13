# IsleChain 桌面端快捷方式安装器
#
#   powershell -ExecutionPolicy Bypass -File desktop\scripts\install-shortcuts.ps1
#   powershell -ExecutionPolicy Bypass -File desktop\scripts\install-shortcuts.ps1 -Hotkey "Ctrl+Alt+C"
#
# 在「桌面」和「开始菜单」创建带图标的启动快捷方式：
#   IsleChain            后端 + studio 桌面窗口（全局快捷键默认 Ctrl+Alt+C）
#   IsleChain 叠加模式    额外打开透明穿透探针窗口（P0 验证用）
#
# 双击启动的是 dev 模式（仓库根的 main.py + 系统 Python），窗口保持打开，
# Ctrl+C 可停止；关掉窗口就等于全部退出。

param(
    [string]$Hotkey = "Ctrl+Alt+C",
    [switch]$NoHotkey,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent $PSScriptRoot          # desktop/
$cmdPath    = Join-Path $PSScriptRoot "start-desktop.cmd"
$exePath    = Join-Path $desktopDir "IsleChain.exe"
$iconPath   = Join-Path $desktopDir "src-tauri\icons\icon.ico"
$shell      = New-Object -ComObject WScript.Shell

if (-not (Test-Path $cmdPath))  { throw "找不到启动器：$cmdPath" }
if (-not (Test-Path $iconPath)) { throw "找不到图标：$iconPath（先跑 scripts/gen-icons.py）" }

# 优先用带图标的 exe（launcher/ 编译产物）；没有则回退到 .cmd
if (Test-Path $exePath) {
    $launcher = $exePath
    Write-Host "使用启动器：IsleChain.exe"
} else {
    $launcher = $cmdPath
    Write-Host "未找到 IsleChain.exe，退回 start-desktop.cmd（可先跑 npm run launcher）"
}

$targets = @(
    @{ Name = "IsleChain";            Extra = "";          Desc = "IsleChain 桌面端（开发模式）" },
    @{ Name = "IsleChain 叠加模式";   Extra = "--overlay"; Desc = "启动即进透明穿透模式（Ctrl+Alt+O 可随时切回）" }
)

$folders = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Programs")
)

if ($Uninstall) {
    foreach ($folder in $folders) {
        foreach ($t in $targets) {
            $lnk = Join-Path $folder ($t.Name + ".lnk")
            if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "已删除 $lnk" }
        }
    }
    return
}

foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) { continue }
    Write-Host ""
    Write-Host "→ $folder"

    foreach ($t in $targets) {
        $lnkPath = Join-Path $folder ($t.Name + ".lnk")
        $shortcut = $shell.CreateShortcut($lnkPath)
        $shortcut.TargetPath       = $launcher
        $shortcut.Arguments        = $t.Extra
        $shortcut.WorkingDirectory = $desktopDir
        $shortcut.IconLocation     = "$iconPath,0"
        $shortcut.Description      = $t.Desc
        $shortcut.WindowStyle      = 1
        $shortcut.Save()

        # 只给主入口挂全局热键；WScript.Shell 的 Hotkey 仅在桌面/开始菜单快捷方式上生效
        if (-not $NoHotkey -and $t.Extra -eq "" -and $folder -eq $folders[0]) {
            try {
                $shortcut.Hotkey = $Hotkey
                $shortcut.Save()
                Write-Host ("  {0,-22} 快捷键 {1}" -f $t.Name, $Hotkey)
            } catch {
                Write-Host ("  {0,-22} 快捷键设置失败（{1}），可用右键属性手动指定" -f $t.Name, $_.Exception.Message)
            }
        } else {
            Write-Host ("  {0,-22} {1}" -f $t.Name, $(if ($t.Extra) { $t.Extra } else { "双击启动" }))
        }
    }
}

Write-Host ""
Write-Host "完成。图标：$iconPath"
if (-not $NoHotkey) {
    Write-Host "全局快捷键 $Hotkey 需要「桌面」上的快捷方式存在才生效；若被其他软件占用，"
    Write-Host "右键快捷方式 → 属性 → 快捷键，重新指定一个即可。"
}
Write-Host "卸载：本脚本加 -Uninstall 参数。"
