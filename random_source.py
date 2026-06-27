"""
随机源管理器 - 统一的随机选择接口
支持：角色、画师、预设、LoRA 及未来扩展
"""

import json
import random
import os
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
    """角色随机源"""
    
    def __init__(self):
        super().__init__("character", "角色", "👤")
        self.data_file = Path(__file__).parent / "static" / "app" / "character_data_full.js"
    
    def load(self):
        """加载角色数据"""
        try:
            if not self.data_file.exists():
                return
            
            content = self.data_file.read_text(encoding='utf-8')
            # 解析 JS 变量赋值格式
            import re
            match = re.search(r'const\s+ANIMA_CHAR_DB\s*=\s*(\[.*?\]);', content, re.DOTALL)
            if match:
                data = json.loads(match.group(1))
                self.items = []
                categories = set()
                
                for char in data:
                    item = {
                        "id": char.get("name", ""),
                        "name": char.get("name", ""),
                        "copyright": char.get("copyright", ""),
                        "gender": char.get("gender", ""),
                        "hair": char.get("hair", ""),
                        "eye": char.get("eye", ""),
                        "trigger": char.get("trigger", ""),
                        "tags": char.get("tags", []),
                        "categories": []
                    }
                    
                    # 自动提取类别
                    copyright = char.get("copyright", "")
                    gender = char.get("gender", "")
                    
                    if gender:
                        if "girl" in gender or "female" in gender:
                            item["categories"].append("女性")
                            categories.add("女性")
                        elif "boy" in gender or "male" in gender:
                            item["categories"].append("男性")
                            categories.add("男性")
                    
                    if copyright:
                        # 提取系列名
                        series = copyright.replace("_", " ").title()
                        item["categories"].append(series)
                        categories.add(series)
                    
                    self.items.append(item)
                
                self.categories = sorted(list(categories))
                
        except Exception as e:
            print(f"[CharacterSource] 加载失败: {e}")


class ArtistSource(RandomSource):
    """画师随机源"""
    
    def __init__(self):
        super().__init__("artist", "画师", "🎨")
        self.data_file = Path(__file__).parent / "static" / "app" / "artist_data.js"
    
    def load(self):
        """加载画师数据"""
        try:
            if not self.data_file.exists():
                return
            
            content = self.data_file.read_text(encoding='utf-8')
            import re
            match = re.search(r'const\s+.*?=\s*(\[.*?\]);', content, re.DOTALL)
            if match:
                data = json.loads(match.group(1))
                self.items = []
                
                for artist in data:
                    item = {
                        "id": artist.get("id", ""),
                        "name": artist.get("name", ""),
                        "post_count": artist.get("post_count", 0),
                        "danbooru_tag": artist.get("danbooru_tag", ""),
                        "categories": []
                    }
                    
                    # 按热度分类
                    post_count = artist.get("post_count", 0)
                    if post_count > 500:
                        item["categories"].append("热门")
                    elif post_count > 100:
                        item["categories"].append("中等")
                    else:
                        item["categories"].append("小众")
                    
                    self.items.append(item)
                
                self.categories = ["热门", "中等", "小众"]
                
        except Exception as e:
            print(f"[ArtistSource] 加载失败: {e}")


class PresetSource(RandomSource):
    """预设随机源"""
    
    def __init__(self):
        super().__init__("preset", "预设", "⚙️")
        self.data_file = Path(__file__).parent / "data" / "prompt-presets.json"
    
    def load(self):
        """加载预设数据"""
        try:
            if not self.data_file.exists():
                return
            
            with open(self.data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            self.items = []
            categories = set()
            
            # 解析嵌套结构: categories -> subcategories -> presets
            for category in data.get('categories', []):
                category_name = category.get('name', '')
                category_id = category.get('id', '')
                
                for subcategory in category.get('subcategories', []):
                    subcategory_name = subcategory.get('name', '')
                    
                    for preset in subcategory.get('presets', []):
                        item = {
                            "id": preset.get("id", ""),
                            "name": preset.get("name", ""),
                            "prompt": preset.get("prompt", ""),
                            "categories": []
                        }
                        
                        # 添加类别标签
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
        self._register_defaults()
    
    def _register_defaults(self):
        """注册默认随机源"""
        self.register(CharacterSource())
        self.register(ArtistSource())
        self.register(PresetSource())
        self.register(LoraSource())
    
    def register(self, source: RandomSource):
        """注册随机源"""
        self.sources[source.id] = source
        source.load()
        print(f"[RandomSource] 注册: {source.name} ({source.id}) - {len(source.items)} 项")
    
    def get_source(self, source_id: str) -> Optional[RandomSource]:
        """获取随机源"""
        return self.sources.get(source_id)
    
    def list_sources(self) -> List[Dict]:
        """列出所有随机源"""
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
