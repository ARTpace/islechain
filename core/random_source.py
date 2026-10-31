"""
随机源管理器 - 统一的随机选择接口
支持：角色、画师、预设、LoRA 及未来扩展
"""

import json
import random
from pathlib import Path
from typing import Optional, Dict, List, Any


class RandomSource:
    """随机源基类"""
    
    def __init__(self, source_id: str, name: str, icon: str = "🎲"):
        self.id = source_id
        self.name = name
        self.icon = icon
        self.items: List[Dict] = []
        self.categories: List[str] = []
    
    def load(self):
        """加载数据，子类实现"""
        pass
    
    def get_categories(self) -> List[str]:
        """获取所有类别"""
        return self.categories
    
    def random(self, filters: Optional[Dict] = None) -> Optional[Dict]:
        """随机选择一个"""
        filtered = self._apply_filters(filters)
        return random.choice(filtered) if filtered else None
    
    def random_multi(self, filters: Optional[Dict] = None, count: int = 1) -> List[Dict]:
        """随机选择多个"""
        filtered = self._apply_filters(filters)
        if not filtered:
            return []
        count = min(count, len(filtered))
        return random.sample(filtered, count)
    
    def _apply_filters(self, filters: Optional[Dict] = None) -> List[Dict]:
        """应用筛选条件"""
        if not filters:
            return self.items
        
        result = self.items
        
        # 按类别筛选
        category = filters.get('category')
        if category:
            result = [item for item in result if category in item.get('categories', [])]
        
        # 按标签筛选
        tags = filters.get('tags')
        if tags:
            result = [item for item in result if any(t in item.get('tags', []) for t in tags)]
        
        # 按收藏筛选
        favorites = filters.get('favorites')
        if favorites:
            result = [item for item in result if item.get('id') in favorites]
        
        return result
    
    def to_dict(self) -> Dict:
        """导出为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "categories": self.categories,
            "count": len(self.items)
        }


class CharacterSource(RandomSource):
    """角色随机源

    数据取自角色包体系（character_packs.store.merged_index），
    不再直接读 static/app/characters.json —— 该文件已不进仓库也不进安装包，
    随机源若继续硬读它，新装机器上角色随机会是空的。
    """

    def __init__(self):
        super().__init__("character", "角色", "👤")

    def load(self):
        """加载角色数据（来自所有已装角色包）"""
        try:
            from character_packs import store as character_store

            entries = character_store.merged_index().get("items") or []
            if not entries:
                print("[CharacterSource] 未发现角色包，角色随机源为空")
                return

            self.items = []
            categories = set()

            for entry in entries:
                item = {
                    "id": entry.get("id", ""),
                    "name": entry.get("name", ""),
                    "copyright": entry.get("copyright", ""),
                    "gender": entry.get("gender", ""),
                    "hair": entry.get("hair", ""),
                    "eye": entry.get("eye", ""),
                    "trigger": entry.get("trigger", ""),
                    # 索引层不保留原始 tags，特征已预计算成中文标签
                    "tags": list(entry.get("feat") or []),
                    "categories": [],
                }

                # 自动提取类别
                copyright_text = item["copyright"]
                gender = item["gender"]

                if gender:
                    if "girl" in gender or "female" in gender:
                        item["categories"].append("女性")
                        categories.add("女性")
                    elif "boy" in gender or "male" in gender:
                        item["categories"].append("男性")
                        categories.add("男性")

                if copyright_text:
                    # 提取系列名
                    series = copyright_text.replace("_", " ").title()
                    item["categories"].append(series)
                    categories.add(series)

                self.items.append(item)

            self.categories = sorted(list(categories))

        except Exception as e:
            print(f"[CharacterSource] 加载失败: {e}")


class ArtistSource(RandomSource):
    """画师随机源

    数据取自画师包体系（artist_packs.store.merged_index），
    不再解析 static/app/artist_data.js —— 该文件已不进仓库也不进安装包。
    索引层只有 id/tag/posts/img 四个字段，展示名由 tag 去掉 @ 得到。
    """

    # 与前端分档 UI 一致的展示名
    TIER_LABELS = {
        "legend": "传奇",
        "famous": "知名",
        "active": "活跃",
        "rising": "新锐",
        "newbie": "新人",
    }

    def __init__(self):
        super().__init__("artist", "画师", "🎨")

    def load(self):
        """加载画师数据（来自所有已装画师包）"""
        try:
            from artist_packs import store as artist_store
            from artist_packs.paths import tier_of

            entries = artist_store.merged_index().get("items") or []
            if not entries:
                print("[ArtistSource] 未发现画师包，画师随机源为空")
                return

            self.items = []
            for entry in entries:
                tag = str(entry.get("tag") or "")
                self.items.append({
                    "id": entry.get("id", ""),
                    "name": tag.lstrip("@") or str(entry.get("id") or ""),
                    "post_count": int(entry.get("posts") or 0),
                    "danbooru_tag": tag,
                    "url": entry.get("url", ""),
                    "categories": [self.TIER_LABELS.get(tier_of(entry.get("posts")), "新人")],
                })

            self.categories = list(self.TIER_LABELS.values())

        except Exception as e:
            print(f"[ArtistSource] 加载失败: {e}")


class PresetSource(RandomSource):
    """预设随机源"""

    def __init__(self):
        super().__init__("preset", "预设", "⚙️")
        # 兼容:旧单文件 path;实际加载以 data/presets/*.json 多文件为准
        # 本模块位于 core/，项目根在其上一层
        _root = Path(__file__).resolve().parents[1]
        self.data_file = _root / "data" / "prompt-presets.json"
        self.presets_dir = _root / "data" / "presets"

    def load(self):
        """加载预设数据(优先 data/presets/*.json 多文件,旧单文件作 fallback)"""
        try:
            # 1) 多文件目录(data/presets/*.json)优先
            files = []
            if self.presets_dir.exists():
                files = sorted(self.presets_dir.glob("*.json"))
            # 2) 兼容旧单文件
            if not files and self.data_file.exists():
                files = [self.data_file]
            if not files:
                print(f"[PresetSource] 未找到预设数据: 既无 {self.presets_dir} 也无 {self.data_file}")
                return

            self.items = []
            categories = set()
            seen_keys = set()  # 跨文件去重 name_key

            for fpath in files:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for category in data.get('categories', []):
                    category_id = category.get('id', '') or ''
                    category_name = category.get('name', '') or ''
                    for subcategory in category.get('subcategories', []):
                        subcategory_name = subcategory.get('name', '') or ''
                        for preset in subcategory.get('presets', []):
                            pid = preset.get('id', '') or ''
                            pname = preset.get('name', '') or ''
                            # 跨文件唯一键:category_id::preset_id;无 id 时退回 name
                            name_key = (f"{category_id}::{pid}" if (category_id and pid) else (pid or pname)).strip()
                            if not name_key or name_key in seen_keys:
                                continue
                            seen_keys.add(name_key)
                            item = {
                                "id": pid,
                                "name": pname,
                                "name_key": name_key,   # 后端按 name_key 严格匹配,避免同名串号
                                "prompt": preset.get("prompt", ""),
                                "categories": []
                            }
                            if category_name:
                                item["categories"].append(category_name)
                                categories.add(category_name)
                            if subcategory_name:
                                item["categories"].append(subcategory_name)
                                categories.add(subcategory_name)
                            self.items.append(item)

            self.categories = sorted(list(categories))
        except Exception as e:
            print(f"[PresetSource] 加载失败: {e}")


class LoraSource(RandomSource):
    """LoRA 随机源"""
    
    def __init__(self):
        super().__init__("lora", "LoRA", "🎯")
        self.comfyui_url = None
    
    def load(self):
        """从 ComfyUI 加载 LoRA 数据"""
        # 这里需要调用 ComfyUI API 获取 LoRA 列表
        # 暂时为空，后续实现
        self.items = []
        self.categories = []
    
    def set_comfyui_url(self, url: str):
        """设置 ComfyUI 地址"""
        self.comfyui_url = url


class RandomSourceManager:
    """随机源管理器"""
    
    def __init__(self):
        self.sources: Dict[str, RandomSource] = {}
        self._loaded_ids: set = set()
        self._register_defaults()
    
    def _register_defaults(self):
        """注册默认随机源"""
        self.register(CharacterSource())
        self.register(ArtistSource())
        self.register(PresetSource())
        self.register(LoraSource())
    
    def register(self, source: RandomSource):
        """注册随机源（数据懒加载，首次访问时才解析）"""
        self.sources[source.id] = source
        self._loaded_ids.discard(source.id)

    def _ensure_loaded(self):
        """按需加载各源数据——避免 import 阶段解析 10 万+ 条数据拖慢启动"""
        for sid, source in self.sources.items():
            if sid in self._loaded_ids:
                continue
            source.load()
            self._loaded_ids.add(sid)
            print(f"[RandomSource] 加载: {source.name} ({sid}) - {len(source.items)} 项")
    
    def get_source(self, source_id: str) -> Optional[RandomSource]:
        """获取随机源"""
        self._ensure_loaded()
        return self.sources.get(source_id)
    
    def list_sources(self) -> List[Dict]:
        """列出所有随机源"""
        self._ensure_loaded()
        return [source.to_dict() for source in self.sources.values()]
    
    def random_all(self, config: Dict[str, Dict]) -> Dict[str, Any]:
        """
        根据配置随机选择所有源
        
        config 格式：
        {
            "character": {"category": "女性", "enabled": true},
            "artist": {"count": 2, "enabled": true},
            "preset": {"enabled": true},
            "lora": {"enabled": false}
        }
        """
        result = {}
        self._ensure_loaded()
        
        for source_id, source in self.sources.items():
            source_config = config.get(source_id, {})
            
            if not source_config.get('enabled', True):
                continue
            
            filters = {k: v for k, v in source_config.items() if k not in ['enabled', 'count']}
            count = source_config.get('count', 1)
            
            if count == 1:
                item = source.random(filters)
                if item:
                    result[source_id] = item
            else:
                items = source.random_multi(filters, count)
                if items:
                    result[source_id] = items
        
        return result
    
    def get_categories(self, source_id: str) -> List[str]:
        """获取指定源的所有类别"""
        self._ensure_loaded()
        source = self.sources.get(source_id)
        return source.get_categories() if source else []


# 全局实例
_manager = None


def get_manager() -> RandomSourceManager:
    """获取全局随机源管理器"""
    global _manager
    if _manager is None:
        _manager = RandomSourceManager()
    return _manager


# 便捷函数
def random_character(filters: Optional[Dict] = None) -> Optional[Dict]:
    return get_manager().get_source("character").random(filters)


def random_artist(filters: Optional[Dict] = None) -> Optional[Dict]:
    return get_manager().get_source("artist").random(filters)


def random_preset(filters: Optional[Dict] = None) -> Optional[Dict]:
    return get_manager().get_source("preset").random(filters)


def random_all(config: Dict[str, Dict]) -> Dict[str, Any]:
    return get_manager().random_all(config)
