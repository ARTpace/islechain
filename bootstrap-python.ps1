# bootstrap-python.ps1
# 一键引导：使用系统已安装的标准 Python 创建项目 .venv，可选安装依赖。
# 用法：
#   pwsh -File bootstrap-python.ps1                    # 仅创建 .venv，不装依赖
#   pwsh -File bootstrap-python.ps1 -Install           # 创建 .venv 并安装 requirements.txt
#   pwsh -File bootstrap-python.ps1 -PythonExe "C:\Python311\python.exe" -Install  # 指定 Python 解释器
#
# 区别于 python-env.bat（旧入口，基于 python/ embeddable 环境）；
# 本脚本产出标准 .venv，后续启动：.venv\Scripts\Activate.ps1 后 python main.py

param(
    [Parameter(Mandatory=$false)]
    [string]$PythonExe = "",          # 可选：指定 python.exe 完整路径，默认按 PATH 查找 python3 / python
    [Parameter(Mandatory=$false)]
    [switch]$Install                  # 可选：创建后立即安装 requirements.txt
)

$ErrorActionPreference = "Stop"

# 以脚本所在目录为项目根
$PROJECT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PROJECT_DIR = (Get-Item $PROJECT_DIR).FullName
$VENV_DIR    = Join-Path $PROJECT_DIR ".venv"
$REQ_FILE    = Join-Path $PROJECT_DIR "requirements.txt"
$PYTHON_CMD  = "python"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  art-canvas Python Bootstrap (.venv)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project: $PROJECT_DIR"
Write-Host ""

# --- 1. 解析 Python 解释器 ---
if ($PythonExe) {
    if (-not (Test-Path $PythonExe)) {
        Write-Host "ERROR: 指定的 PythonExe 不存在: $PythonExe" -ForegroundColor Red
        exit 1
    }
    $PYTHON_CMD = $PythonExe
    Write-Host "[Python] 使用指定解释器: $PYTHON_CMD" -ForegroundColor Green
} else {
    # 尝试按优先级查找：python3 → python → py -3
    $candidates = @("python3", "python")
    foreach ($cmd in $candidates) {
        $path = (Get-Command $cmd -ErrorAction SilentlyContinue).Source
        if ($path) {
            $PYTHON_CMD = $cmd
            Write-Host "[Python] 找到 ${cmd}: $path" -ForegroundColor Green
            break
        }
    }
    if ($PYTHON_CMD -eq "python") {
        # 兜底：尝试 py -3
        $py3 = (Get-Command "py" -ErrorAction SilentlyContinue)
        if ($py3) {
            $PYTHON_CMD = "py -3"
            Write-Host "[Python] 使用 py -3" -ForegroundColor Green
        } else {
            Write-Host "ERROR: 未找到可用的 Python 解释器。请安装 Python 3.11+ 或使用 -PythonExe 参数指定路径。" -ForegroundColor Red
            Write-Host "       例如: pwsh -File bootstrap-python.ps1 -PythonExe `"C:\Python311\python.exe`" -Install" -ForegroundColor Yellow
            exit 1
        }
    }
}

# 验证版本 ≥ 3.11
try {
    $versionOutput = & $PYTHON_CMD -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1
    if ($LASTEXITCODE -ne 0 -or -not $versionOutput) {
        throw "Python 执行失败或无输出"
    }
    $versionParts = $versionOutput.Trim().Split('.')
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 11)) {
        Write-Host "WARNING: 检测到 Python $major.$minor，建议 3.11+。继续可能遇到兼容性问题。" -ForegroundColor Yellow
    } else {
        Write-Host "[Python] 版本检查通过: $major.$minor" -ForegroundColor Green
    }
} catch {
    Write-Host "WARNING: 无法获取 Python 版本 ($($_.Exception.Message))，尝试继续..." -ForegroundColor Yellow
}

# --- 2. 创建 .venv ---
if (Test-Path $VENV_DIR) {
    Write-Host "[skip] .venv 已存在，跳过创建" -ForegroundColor Yellow
} else {
    Write-Host "[1/2] 创建虚拟环境: .venv" -ForegroundColor Green
    & $PYTHON_CMD -m venv $VENV_DIR
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: 虚拟环境创建失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "       .venv 创建成功" -ForegroundColor DarkGray
}

# --- 3. 确定 venv 内的 python/pip 路径 ---
$VENV_PYTHON = Join-Path $VENV_DIR "Scripts\python.exe"
$VENV_PIP    = Join-Path $VENV_DIR "Scripts\pip.exe"

if (-not (Test-Path $VENV_PYTHON)) {
    Write-Host "ERROR: .venv 创建后未找到 python.exe: $VENV_PYTHON" -ForegroundColor Red
    exit 1
}

# --- 4. 可选：安装依赖 ---
if ($Install) {
    if (-not (Test-Path $REQ_FILE)) {
        Write-Host "ERROR: requirements.txt 不存在: $REQ_FILE" -ForegroundColor Red
        exit 1
    }
    Write-Host "[2/2] 安装依赖: pip install -r requirements.txt" -ForegroundColor Green
    & $VENV_PIP install -r $REQ_FILE
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: pip install 失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "       依赖安装完成" -ForegroundColor DarkGray
} else {
    Write-Host "[2/2] 跳过依赖安装（使用 -Install 开启）" -ForegroundColor Yellow
}

# --- 5. 输出后续启动命令 ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Bootstrap 完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "虚拟环境: $VENV_DIR"
Write-Host "Python:   $VENV_PYTHON"
& $VENV_PYTHON --version
Write-Host ""
Write-Host "后续启动后端（两种方式均可）：" -ForegroundColor Yellow
Write-Host "  1) 激活环境后直接运行：" -ForegroundColor Yellow
Write-Host "     .venv\Scripts\Activate.ps1" -ForegroundColor Cyan
Write-Host "     python main.py" -ForegroundColor Cyan
Write-Host ""
Write-Host "  2) 直接使用完整路径（无需激活）：" -ForegroundColor Yellow
Write-Host "     .venv\Scripts\python.exe main.py" -ForegroundColor Cyan
Write-Host ""
Write-Host "旧入口 python-env.bat 仍可用（基于 python/ embeddable），但推荐改用标准 .venv。" -ForegroundColor Gray
pause