"""
通配符引擎 - 提示词预处理模块
支持语法：
  {a|b|c}       内联随机选择
  __name__      引用 data/wildcards/name.txt
  [text]        50%概率出现
  嵌套          由内向外解析

功能：
  - 解析通配符
  - 导入外部通配符文件（.txt / .zip / URL）
  - 管理通配符文件（列出、删除）
"""

import random
import re
import zipfile
import shutil
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional, Dict, List, Any


class WildcardEngine:
    """通配符引擎 - 可注入任何提示词处理流程"""

    def __init__(self, wildcard_dir: Optional[str] = None):
        """初始化通配符引擎

        Args:
            wildcard_dir: 通配符文件目录，默认为 data/wildcards/
        """
        if wildcard_dir is None:
            self.wildcard_dir = Path(__file__).parent / "data" / "wildcards"
        else:
            self.wildcard_dir = Path(wildcard_dir)
        self.wildcard_dir.mkdir(parents=True, exist_ok=True)
        self.imported_dir = self.wildcard_dir / "imported"
        self.imported_dir.mkdir(parents=True, exist_ok=True)

    def resolve(self, text: str, seed: Optional[int] = None) -> str:
        """解析通配符，返回替换后的字符串

        Args:
            text: 包含通配符的文本
            seed: 随机种子，用于可复现的结果

        Returns:
            解析后的文本
        """
        if seed is not None:
            random.seed(seed)
        # 多轮解析以处理嵌套
        for _ in range(10):
            new_text = self._resolve_once(text)
            if new_text == text:
                break
            text = new_text
        return text

    def _resolve_once(self, text: str) -> str:
        """单次解析所有通配符"""
        # {a|b|c} 内联随机选择
        text = re.sub(r'\{([^{}]+\|[^{}]+)\}', self._pick_choice, text)
        # __name__ 引用通配符文件
        text = re.sub(r'__([a-zA-Z0-9_]+)__', self._pick_from_file, text)
        # [text] 50%概率出现
        text = re.sub(r'\[([^\[\]]+)\]', self._pick_optional, text)
        return text

    def _pick_choice(self, match) -> str:
        """从 {a|b|c} 中随机选择"""
        options = match.group(1).split('|')
        return random.choice(options).strip()

    def _pick_from_file(self, match) -> str:
        """从通配符文件中随机选择"""
        name = match.group(1)
        # 先查内置目录，再查 imported
        for search_dir in [self.wildcard_dir, self.imported_dir]:
            filepath = search_dir / f"{name}.txt"
            if filepath.exists():
                lines = self._load_wildcard_file(filepath)
                if lines:
                    return random.choice(lines)
        return match.group(0)  # 找不到文件就原样返回

    def _pick_optional(self, match) -> str:
        """50%概率返回内容"""
        if random.random() < 0.5:
            return match.group(1)
        return ""

    def _load_wildcard_file(self, filepath: Path) -> List[str]:
        """加载通配符文件，返回非空行列表"""
        try:
            content = filepath.read_text(encoding='utf-8')
            lines = [line.strip() for line in content.splitlines()
                     if line.strip() and not line.strip().startswith('#')]
            return lines
        except Exception as e:
            print(f"[WildcardEngine] 加载文件失败 {filepath}: {e}")
            return []

    def resolve_parts(self, parts: Dict[str, str], seed: Optional[int] = None) -> Dict[str, str]:
        """批量解析多个提示词片段

        Args:
            parts: {"user_input": "...", "character": "...", ...}
            seed: 随机种子

        Returns:
            每个片段解析后的结果
        """
        if seed is not None:
            random.seed(seed)
        return {k: self.resolve(v) for k, v in parts.items()}

    def preview(self, text: str, seed: Optional[int] = None) -> Dict[str, Any]:
        """预览解析结果

        Args:
            text: 输入文本
            seed: 随机种子（可选）

        Returns:
            {"original": str, "resolved": str, "wildcards_found": list}
        """
        if seed is not None:
            random.seed(seed)
        wildcards = []
        wildcards.extend(re.findall(r'\{([^{}]+\|[^{}]+)\}', text))
        wildcards.extend(re.findall(r'__([a-zA-Z0-9_]+)__', text))
        wildcards.extend(re.findall(r'\[([^\[\]]+)\]', text))

        return {
            "original": text,
            "resolved": self.resolve(text, seed=seed),
            "wildcards_found": wildcards
        }

    def list_wildcards(self) -> Dict[str, Dict[str, int]]:
        """列出所有可用通配符

        Returns:
            {
                "builtin": {"name": [options], ...},
                "imported": {"name": [options], ...}
            }
        """
        result = {"builtin": {}, "imported": {}}

        # 内置通配符
        if self.wildcard_dir.exists():
            for f in sorted(self.wildcard_dir.glob("*.txt")):
                name = f.stem
                lines = self._load_wildcard_file(f)
                result["builtin"][name] = len(lines)

        # 导入的通配符
        if self.imported_dir.exists():
            for f in sorted(self.imported_dir.glob("*.txt")):
                name = f.stem
                lines = self._load_wildcard_file(f)
                result["imported"][name] = len(lines)

        return result

    def get_wildcard(self, name: str) -> List[str]:
        """获取指定通配符的选项列表"""
        for search_dir in [self.wildcard_dir, self.imported_dir]:
            filepath = search_dir / f"{name}.txt"
            if filepath.exists():
                return self._load_wildcard_file(filepath)
        return []

    def get_wildcard_text(self, name: str) -> str:
        """获取通配符文件的原始文本（含注释与空行），用于编辑器回显"""
        for search_dir in [self.wildcard_dir, self.imported_dir]:
            filepath = search_dir / f"{name}.txt"
            if filepath.exists():
                try:
                    return filepath.read_text(encoding='utf-8')
                except Exception as e:
                    print(f"[WildcardEngine] 读取文件失败 {filepath}: {e}")
                    return ""
        return ""

    def save_wildcard(self, name: str, text: str, overwrite: bool = False) -> Dict[str, Any]:
        """创建或覆盖一个用户通配符（写入 imported/）

        Args:
            name: 通配符名称（仅字母数字下划线中划线）
            text: 多行文本，每行一条提示词
            overwrite: True 表示允许覆盖已存在的 imported 通配符

        Returns:
            {"success": bool, "name": str, "count": int, "error": str}
        """
        clean = re.sub(r'[^\w\-]', '_', (name or "").strip())
        if not clean:
            return {"success": False, "name": "", "count": 0, "error": "名称不能为空"}

        target = self.imported_dir / f"{clean}.txt"
        builtin = self.wildcard_dir / f"{clean}.txt"
        if builtin.exists():
            return {"success": False, "name": clean, "count": 0, "error": "与内置通配符同名，不允许覆盖"}

        if target.exists() and not overwrite:
            return {"success": False, "name": clean, "count": 0, "error": "通配符已存在，未开启覆盖"}

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            # 统一换行；去掉尾部多余空行
            content = (text or "").replace('\r\n', '\n').rstrip() + '\n'
            target.write_text(content, encoding='utf-8')
            lines = self._load_wildcard_file(target)
            return {"success": True, "name": clean, "count": len(lines), "error": ""}
        except Exception as e:
            return {"success": False, "name": clean, "count": 0, "error": str(e)}

    def roll_combo(self, names: List[str], seed: Optional[int] = None) -> Dict[str, Any]:
        """从多个通配符类型中各随机抽一条，用于「方案」式随机组合

        Returns:
            {
                "picks": {name: picked_line, ...},
                "combined": ", picked1, picked2, ..."  # 拼接结果
                "missing": [不存在的类型名, ...]
            }
        """
        if seed is not None:
            random.seed(seed)
        picks: Dict[str, str] = {}
        missing: List[str] = []
        for n in names:
            options = self.get_wildcard(n)
            if not options:
                missing.append(n)
                continue
            picks[n] = random.choice(options)
        # 拼接（按传入顺序）
        combined = ", ".join(picks[n] for n in names if n in picks)
        return {"picks": picks, "combined": combined, "missing": missing}

    def validate(self, text: str) -> List[str]:
        """检查语法错误

        Returns:
            警告列表，空表示无错误
        """
        warnings = []
        # 检查花括号匹配
        open_brace = text.count('{')
        close_brace = text.count('}')
        if open_brace != close_brace:
            warnings.append(f"花括号不匹配: {open_brace} 个 '{{' vs {close_brace} 个 '}}'")

        # 检查方括号匹配
        open_sq = text.count('[')
        close_sq = text.count(']')
        if open_sq != close_sq:
            warnings.append(f"方括号不匹配: {open_sq} 个 '[' vs {close_sq} 个 ']'")

        # 检查引用的通配符文件是否存在
        for name in re.findall(r'__([a-zA-Z0-9_]+)__', text):
            found = False
            for search_dir in [self.wildcard_dir, self.imported_dir]:
                if (search_dir / f"{name}.txt").exists():
                    found = True
                    break
            if not found:
                warnings.append(f"通配符文件不存在: __{name}__")

        # 检查空选项
        for match in re.findall(r'\{([^{}]*)\}', text):
            options = match.split('|')
            if any(not opt.strip() for opt in options):
                warnings.append(f"存在空选项: {{{match}}}")

        return warnings

    def import_file(self, source_path: str, name: Optional[str] = None) -> Dict[str, Any]:
        """导入单个 .txt 文件

        Args:
            source_path: 源文件路径
            name: 可选，重命名（不含扩展名）

        Returns:
            {"success": bool, "name": str, "count": int, "error": str}
        """
        source = Path(source_path)
        if not source.exists():
            return {"success": False, "name": "", "count": 0, "error": "文件不存在"}

        if source.suffix.lower() != '.txt':
            return {"success": False, "name": "", "count": 0, "error": "只支持 .txt 文件"}

        # 确定目标名称
        if name:
            clean_name = re.sub(r'[^\w\-]', '_', name)
        else:
            clean_name = source.stem

        # 检查是否已存在
        target = self.imported_dir / f"{clean_name}.txt"
        if target.exists():
            return {"success": False, "name": clean_name, "count": 0, "error": "同名通配符已存在"}

        try:
            shutil.copy2(source, target)
            lines = self._load_wildcard_file(target)
            return {"success": True, "name": clean_name, "count": len(lines), "error": ""}
        except Exception as e:
            return {"success": False, "name": "", "count": 0, "error": str(e)}

    def import_zip(self, zip_path: str, pack_name: Optional[str] = None) -> Dict[str, Any]:
        """导入 .zip 通配符包

        Args:
            zip_path: zip 文件路径
            pack_name: 可选，包名（作为子目录）

        Returns:
            {"success": bool, "imported": list, "skipped": list, "error": str}
        """
        source = Path(zip_path)
        if not source.exists():
            return {"success": False, "imported": [], "skipped": [], "error": "文件不存在"}

        if source.suffix.lower() != '.zip':
            return {"success": False, "imported": [], "skipped": [], "error": "只支持 .zip 文件"}

        imported = []
        skipped = []

        try:
            # 确定目标目录
            if pack_name:
                clean_name = re.sub(r'[^\w\-]', '_', pack_name)
                target_dir = self.imported_dir / clean_name
            else:
                target_dir = self.imported_dir
            target_dir.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(source, 'r') as zf:
                for info in zf.infolist():
                    if info.filename.endswith('.txt'):
                        name = Path(info.filename).stem
                        target = target_dir / f"{name}.txt"
                        if target.exists():
                            skipped.append(name)
                        else:
                            with zf.open(info) as src, open(target, 'wb') as dst:
                                dst.write(src.read())
                            lines = self._load_wildcard_file(target)
                            imported.append({"name": name, "count": len(lines)})

            return {"success": True, "imported": imported, "skipped": skipped, "error": ""}
        except Exception as e:
            return {"success": False, "imported": [], "skipped": [], "error": str(e)}

    def import_from_url(self, url: str) -> Dict[str, Any]:
        """从 URL 导入通配符
        支持直链 .txt 和 .zip
        """
        try:
            # 下载到临时目录
            temp_dir = Path(__file__).parent / "temp"
            temp_dir.mkdir(parents=True, exist_ok=True)

            # 从 URL 推断文件名
            parsed = urllib.parse.urlparse(url)
            filename = Path(parsed.path).name or "download"
            temp_path = temp_dir / filename

            urllib.request.urlretrieve(url, temp_path)

            suffix = temp_path.suffix.lower()
            if suffix == '.txt':
                result = self.import_file(str(temp_path))
            elif suffix == '.zip':
                result = self.import_zip(str(temp_path))
            else:
                return {"success": False, "error": f"不支持的文件类型: {suffix}"}

            # 清理临时文件
            temp_path.unlink(missing_ok=True)
            return result
        except Exception as e:
            return {"success": False, "error": f"下载失败: {e}"}

    def delete_wildcard(self, name: str) -> Dict[str, Any]:
        """删除通配符文件

        Args:
            name: 通配符名称（支持 "pack/name" 格式）
        """
        # 不能删除内置通配符
        builtin_path = self.wildcard_dir / f"{name}.txt"
        if builtin_path.exists():
            return {"success": False, "error": "不能删除内置通配符"}

        imported_path = self.imported_dir / f"{name}.txt"
        if not imported_path.exists():
            return {"success": False, "error": "通配符不存在"}

        try:
            imported_path.unlink()
            # 如果是空目录也删掉
            if imported_path.parent != self.imported_dir:
                if not any(imported_path.parent.iterdir()):
                    imported_path.parent.rmdir()
            return {"success": True, "error": ""}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def export_pack(self, names: List[str], output_path: str) -> Dict[str, Any]:
        """导出选中的通配符为 .zip 包"""
        try:
            output = Path(output_path)
            output.parent.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
                for name in names:
                    for search_dir in [self.wildcard_dir, self.imported_dir]:
                        filepath = search_dir / f"{name}.txt"
                        if filepath.exists():
                            zf.write(filepath, f"{name}.txt")
                            break

            return {"success": True, "error": ""}
        except Exception as e:
            return {"success": False, "error": str(e)}


# 全局默认引擎实例
_default_engine = None


def get_engine() -> WildcardEngine:
    """获取全局默认引擎实例"""
    global _default_engine
    if _default_engine is None:
        _default_engine = WildcardEngine()
    return _default_engine


def resolve(text: str, seed: Optional[int] = None) -> str:
    """快捷函数：解析通配符"""
    return get_engine().resolve(text, seed)


def preview(text: str) -> Dict[str, Any]:
    """快捷函数：预览解析结果"""
    return get_engine().preview(text)


def list_wildcards() -> Dict[str, Dict[str, int]]:
    """快捷函数：列出所有通配符"""
    return get_engine().list_wildcards()
