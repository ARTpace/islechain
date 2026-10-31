"""项目公共底座：路径、配置与跨层共用的纯逻辑。

这一层被 routers / style_packs / character_packs / artist_packs / prompt /
tools / tests 等所有上层引用，因此必须保持「只依赖标准库与第三方库，
不反向依赖任何业务包」——依赖方向永远是「上层 → core」，不得倒置。

模块职责：

    路径与用户目录
        user_paths          用户数据目录（%APPDATA%\\art-canvas）与项目内路径
        media_paths         媒体文件路径推导（生成结果、缩略图、缓存目录）
        media_migration     旧版媒体目录结构迁移

    配置与预设
        preset_manager      提示词预设库（prompt-presets.yaml）读写
        feature_access      功能开关与访客模式降级判定

    提示词与生成
        smart_prompt        提示词增强（LLM 改写、配置加载）
        wildcard_engine     通配符（wildcards）展开
        random_source       随机角色/画师/预设数据源（走内容包体系）
        generation_data     生成记录与统计

    其它
        genre_registry      TTS 音色/体裁注册表
        smart_tts           语音合成（LLM 直调）
        image_cutout        图像抠图
        lan_sharing         局域网共享与访问控制

新增模块的判断标准：若它被两个以上业务包引用，且不依赖业务概念，
才放进这一层；否则请放到对应业务包内。
"""
