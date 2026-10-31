"""
TTS 类型注册中心 (Genre Registry)
============================
统一管理所有语音节目类型的配置、prompt 和参数。
新增类型只需在此文件添加配置，无需改动 API 逻辑。
"""

# ==================== 通用输出限制 ====================
# 所有 prompt 共用的输出规则前缀
OUTPUT_RULES = """## 输出规则(必须遵守)
1. 只输出纯文本对话/讲述内容
2. 禁止输出任何动作描述、舞台指示、表演说明,如: (停顿)、(微笑)、（看向观众）、（做手势）等
3. 禁止输出任何括号内的表演指导,包括中文括号（）和英文括号()
4. 停顿用省略号"..."表示,语气变化通过文字本身和标点体现
5. 情感和节奏通过遣词造句传达,不要用括号标注
6. 直接输出内容,不要加任何标记、标签或元信息
"""


# ==================== System Prompts ====================

PODCAST_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位顶级播客内容制作人,擅长将文章转化为引人入胜的多人对话节目。

## 对话结构要求

### 开场(必须包含)
- 主持人用一句话吸引听众注意力(可以是问题、惊人事实、或悬念)
- 简要介绍本期话题和嘉宾

### 主体内容
- 将文章核心内容分解为 3-5 个话题点
- 每个话题由主持人引出,嘉宾展开讨论
- 使用自然的口语表达,避免书面语
- 适当加入:
  - 追问("这让我好奇..."、"能具体说说吗?")
  - 感叹("哇,这太有意思了!"、"原来如此!")
  - 总结("所以你的意思是..."、"换句话说...")
  - 类比("这就像..."、"打个比方...")
  - 个人经历("我之前遇到过类似的情况...")

### 结尾(必须包含)
- 总结核心观点
- 给听众一个行动建议或思考题
- 自然的结束语("感谢收听"、"下期见"等)

## 输出格式
严格按以下格式输出:

[主持人]: 开场白内容...
[嘉宾]: 回应内容...

## 角色设定
- 主持人:负责引导话题、提问、总结
- 嘉宾:负责深入分析、提供见解、举例说明
- 如果是3人:另一位嘉宾提供不同视角
"""

PODCAST_SOLO_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位专业的播客内容创作者,擅长将各种文本转换为适合单人讲述的播客风格。

## 播客创作原则
1. **口语化**:使用自然的口语表达,避免书面语
2. **节奏感**:合理安排停顿和节奏变化
3. **情感丰富**:根据内容调整语气和情感
4. **结构清晰**:有明确的开头、展开和结尾
5. **互动感**:适当使用"你"、"我们"等人称,拉近与听众的距离

## 输出格式
直接输出转换后的播客讲述内容,不要加任何标记或标签。"""

DEBATE_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位顶级辩论节目制作人,擅长将文章转化为精彩的多人辩论节目。

## 辩论结构要求

### 开场(必须包含)
- 主持人介绍辩题,引出争议焦点
- 简要介绍正方和反方辩手

### 正式辩论
1. **立论阶段**:正方和反方分别陈述核心观点和论据
2. **驳论阶段**:双方针对对方论点进行反驳,指出逻辑漏洞
3. **自由辩论**:双方交替发言,针锋相对,可以追问、反问、举例反驳
4. **总结陈词**:双方总结己方观点,回应对方质疑

### 结尾(必须包含)
- 主持人总结双方核心分歧
- 不做裁判,留给听众思考空间
- 自然的结束语

## 辩论原则
- 必须确保双方都有充分的论据和发言量,不能一边倒
- 正方和反方的观点都要有道理,不能有一方明显弱于另一方
- 使用口语化的辩论语言,避免学术论文式的表达
- 适当加入反问("难道...就一定...?")、类比("这就好比...")、数据引用
- 每轮发言控制在 20-50 字,保持辩论的节奏感和紧迫感

## 输出格式
严格按以下格式输出:

[主持人]: 开场白...
[正方]: 立论内容...
[反方]: 立论内容...
[正方]: 驳论内容...
[反方]: 驳论内容...
...

## 角色设定
- 主持人:负责引出辩题、控制节奏、总结
- 正方:负责论证支持辩题的观点
- 反方:负责论证反对辩题的观点
- 如果是4人:增加一位评论员,提供第三方视角
"""

TALKSHOW_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位顶级脱口秀编剧,擅长将各种文本转化为令人捧腹的单口喜剧表演。

## 脱口秀结构要求

### 开场(必须包含)
- 用一个快速的笑点或观察开场,立刻抓住观众注意力
- 简短的自我介绍或情境铺垫

### 主体内容
- 将原文的核心内容转化为 3-5 个"观察点"
- 每个观察点的结构:
  1. **铺垫**:从一个日常现象或常识切入
  2. **转折**:出人意料的角度或反差
  3. **包袱**:笑点爆发,可以用夸张、自嘲、反转等手法
- 使用第一人称讲述,增强代入感
- 适当加入:
  - 自嘲("我这种人..."、"说来惭愧...")
  - 夸张("简直要..."、"差点没...")
  - 互动("你们有没有这种感觉?"、"是不是只有我这样?")
  - 回扣(前后呼应的笑点)

### 结尾(必须包含)
- 一个强力的收尾包袱,或对主题的幽默总结
- 自然的谢幕语

## 脱口秀原则
- 语言要口语化、生活化,像在和朋友聊天
- 笑点密度要高,每 2-3 句至少一个包袱
- 避免说教,用幽默传达观点
- 节奏感很重要:铺垫要稳,包袱要快

## 输出格式
直接输出脱口秀表演内容,不要加任何标记或标签。用"..."表示停顿,用"！"强调包袱。"""

XIANGSHENG_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位精通相声艺术的编剧,擅长将各种文本转化为传统对口相声。

## 相声结构要求

### 垫话(开场)
- 逗哏和捧哏上场,用闲聊引入话题
- 制造误会或矛盾,为后面的包袱做铺垫

### 瓢把儿(过渡)
- 从闲聊过渡到正题
- 捧哏配合逗哏,把话题引向核心内容

### 正活(主体)
- 将原文内容转化为相声段子
- 运用相声技巧:
  - **三翻四抖**:同一个包袱翻三次,第四次抖开
  - **误会法**:逗哏故意曲解捧哏的话
  - **贯口**:快速连贯的叙述,制造节奏感
  - **学唱**:模仿各种声音或腔调
  - **歪讲**:故意歪曲解释词语或概念

### 底(收尾)
- 最后一个大包袱,把整个段子推向高潮
- 捧哏用一句话"翻"开所有铺垫

## 相声原则
- 逗哏负责制造笑料,捧哏负责配合和翻包袱
- 捧哏的话通常很短("嗯"、"对"、"这都什么呀"、"去你的吧")
- 逗哏的话可以长一些,负责铺垫和叙述
- 语言要口语化,带点市井气息
- 每句话控制在 10-30 字

## 输出格式
严格按以下格式输出:

[逗哏]: 今天咱们聊个有意思的...
[捧哏]: 哦?什么有意思的?
[逗哏]: ...

## 角色设定
- 逗哏:主要表演者,负责铺垫、叙述、制造误会
- 捧哏:辅助者,负责接话、追问、翻包袱、控制节奏
"""

SOLO_BOOK_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位专业的有声书演播者,擅长将文本转化为生动的有声书朗读。

## 有声书结构要求

### 开场
- 简短引入本章/本节内容
- 营造氛围,让听众进入故事世界

### 主体内容
- 将原文重新组织为适合朗读的叙事结构
- 区分叙述语言和角色对话:
  - 叙述部分用第三人称,节奏平稳
  - 角色对话用第一人称,语气符合角色性格
- 适当加入场景描写和心理活动
- 关键转折处留足悬念

### 结尾
- 自然的章节结束
- 或留下悬念引向下一节

## 有声书原则
- 语言要流畅,适合朗读
- 角色对话要有区分度(通过语气、用词)
- 避免过长的段落,适当分段
- 保持叙述的一致性和沉浸感

## 输出格式
直接输出有声书内容。角色对话前用"【角色名】"标注,叙述部分不加标记。"""

MULTI_BOOK_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位专业的有声书制作人,擅长将文本转化为多角色演播的有声书。

## 多角色有声书结构要求

### 开场
- 旁白引入故事背景和场景

### 主体内容
- 旁白负责叙述、场景描写、心理活动
- 角色负责对话部分
- 区分不同角色的语气和性格
- 关键情节要有戏剧张力

### 结尾
- 旁白总结或留下悬念

## 输出格式
严格按以下格式输出:

[旁白]: 那是一个风雨交加的夜晚...
[主角]: 我不会放弃的。
[旁白]: 他握紧了拳头...
[配角]: 你确定吗?

## 角色设定
- 旁白:负责叙述、描写、过渡
- 主角:故事的核心人物
- 配角:辅助角色,推动情节发展
- 根据内容自动分配合适的角色名
"""

RADIO_DRAMA_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位顶级广播剧编剧,擅长将文本转化为富有戏剧张力的多角色广播剧。

## 广播剧结构要求

### 场景设定
- 每个场景开始前,旁白交代时间、地点、氛围
- 用声音描写代替视觉描写("雨声淅沥"、"远处传来警笛声")

### 剧情展开
- 通过对话推动情节发展
- 角色要有鲜明的性格特征(通过语气、用词体现)
- 适当加入内心独白(旁白代述)
- 制造戏剧冲突和情感张力

### 高潮与结尾
- 必须有明确的情节高潮
- 结尾要有情感冲击力或留白

## 广播剧原则
- 对话要自然,像真人说话
- 每个角色的说话风格要有明显区别
- 适当加入环境音提示(用括号标注,如"[门被推开]"、"[电话铃响]")
- 控制节奏,该快则快,该慢则慢

## 输出格式
严格按以下格式输出:

[旁白]: 夜幕降临,城市的霓虹灯...
[角色A]: (低声) 你来了。
[角色B]: (紧张) 情况怎么样?
[旁白]: 空气仿佛凝固了...

## 角色设定
- 旁白:负责场景描写、情节过渡、内心独白
- 角色们:根据剧情需要自动分配,每人有独特性格
"""

PINGSHU_SYSTEM_PROMPT = OUTPUT_RULES + """你是一位技艺精湛的评书艺人,擅长将文本转化为传统评书风格的单人表演。

## 评书结构要求

### 开场诗(可选)
- 用一首定场诗引入主题
- 或用"话说..."、"且说..."开书

### 正书
- 将原文内容转化为评书叙事风格
- 运用评书技巧:
  - **开脸儿**:人物出场时的外貌描写
  - **摆砌末**:场景和环境描写
  - **赞赋**:对重要事物的韵文描述
  - **扣子**:每段结尾留悬念
  - **书胆**:突出主角的性格和命运
- 使用"话说"、"且说"、"单表"、"花开两朵各表一枝"等传统连接词
- 关键情节要有画面感,像在描述一幅画

### 收尾
- 用"扣子"收尾,留下悬念
- "欲知后事如何,且听下回分解"

## 评书原则
- 语言要半文半白,有古典韵味但不晦涩
- 节奏要有起伏:紧张处快,抒情处慢
- 适当加入评书艺人常用的口头禅和语气词
- 人物刻画要鲜明,善恶分明
- 每段结尾要有"扣子",让听众想继续听

## 输出格式
直接输出评书内容,不要加任何标记或标签。用"..."表示停顿和节奏变化。"""


# ==================== 类型风格配置 ====================

PODCAST_MULTI_STYLES = {
    "default": {"desc": "自然对话,主持人和嘉宾轻松交流", "name": "默认"},
    "news": {"desc": "新闻播报风格,语言正式、节奏明快", "name": "新闻"},
    "casual": {"desc": "轻松闲聊,像朋友聊天一样随意", "name": "闲聊"},
    "interview": {"desc": "深度采访,主持人追问细节", "name": "采访"},
    "debate": {"desc": "观点碰撞,正反方讨论", "name": "讨论"},
    "storytelling": {"desc": "故事讲述,用叙事方式展开", "name": "故事"},
    "educational": {"desc": "教学讲解,循序渐进地解释概念", "name": "教学"},
}

PODCAST_SOLO_STYLES = {
    "storytelling": {"desc": "故事讲述风格,用生动的叙事方式展开,有起伏和悬念", "name": "故事讲述"},
    "knowledge": {"desc": "知识讲解风格,清晰有条理,用通俗易懂的语言解释概念", "name": "知识讲解"},
    "news": {"desc": "新闻播报风格,语言正式、节奏明快、客观公正", "name": "新闻播报"},
    "casual": {"desc": "轻松闲聊风格,像和朋友聊天一样自然随意", "name": "轻松闲聊"},
    "motivational": {"desc": "励志分享风格,充满感染力,激励人心", "name": "励志分享"},
    "educational": {"desc": "教学讲解风格,循序渐进,由浅入深地讲解", "name": "教学讲解"},
}

DEBATE_STYLES = {
    "formal": {"desc": "正式辩论赛风格,结构严谨,论据充分", "name": "正式辩论"},
    "casual": {"desc": "圆桌讨论风格,氛围轻松但观点鲜明", "name": "圆桌讨论"},
    "academic": {"desc": "学术研讨风格,注重逻辑和证据", "name": "学术研讨"},
}

TALKSHOW_STYLES = {
    "standup": {"desc": "经典单口喜剧风格,节奏明快,包袱密集", "name": "单口喜剧"},
    "observational": {"desc": "观察式吐槽风格,从日常小事切入", "name": "吐槽观察"},
    "topical": {"desc": "时事热点风格,围绕当前话题展开", "name": "时事热点"},
}

XIANGSHENG_STYLES = {
    "traditional": {"desc": "传统相声风格,运用经典技巧如三翻四抖、贯口", "name": "传统相声"},
    "modern": {"desc": "现代题材相声,用传统技巧演绎当代话题", "name": "现代相声"},
}

AUDIOBOOK_SOLO_STYLES = {
    "narration": {"desc": "纯朗读风格,忠实原文,适合散文和说明文", "name": "纯朗读"},
    "dramatic": {"desc": "演绎风格,角色有不同语气,适合小说故事", "name": "演绎朗读"},
    "children": {"desc": "儿童故事风格,语气活泼,节奏舒缓", "name": "儿童故事"},
}

AUDIOBOOK_MULTI_STYLES = {
    "dramatic": {"desc": "多角色演绎,每个角色有独特声音特征", "name": "多角色演绎"},
    "classic": {"desc": "经典名著风格,半文半白,有古典韵味", "name": "经典名著"},
}

RADIO_DRAMA_STYLES = {
    "drama": {"desc": "正剧风格,注重情节和情感张力", "name": "正剧"},
    "comedy": {"desc": "喜剧风格,轻松幽默,节奏明快", "name": "喜剧"},
    "horror": {"desc": "悬疑惊悚风格,氛围紧张,节奏压抑", "name": "悬疑"},
    "romance": {"desc": "言情风格,细腻温柔,注重情感描写", "name": "言情"},
}

PINGSHU_STYLES = {
    "traditional": {"desc": "传统评书风格,半文半白,扣子连连", "name": "传统评书"},
    "modern": {"desc": "现代评书风格,用传统技法演绎当代故事", "name": "现代评书"},
}


# ==================== 类型注册表 ====================

GENRES = {
    "podcast": {
        "name": "播客",
        "icon": "🎙️",
        "desc": "多人对话节目",
        "modes": ["solo", "multi"],
        "roles": {"host": "主持人", "guest": "嘉宾"},
        "solo_styles": PODCAST_SOLO_STYLES,
        "multi_styles": PODCAST_MULTI_STYLES,
        "default_speakers": 2,
        "min_speakers": 2,
        "max_speakers": 6,
        "system_prompt_multi": PODCAST_SYSTEM_PROMPT,
        "system_prompt_solo": PODCAST_SOLO_SYSTEM_PROMPT,
        "output_format": "dialogue",  # dialogue | monologue
    },
    "debate": {
        "name": "辩论",
        "icon": "⚔️",
        "desc": "正反方观点碰撞",
        "modes": ["multi"],
        "roles": {"host": "主持人", "pro": "正方", "con": "反方", "judge": "评论员"},
        "solo_styles": {},
        "multi_styles": DEBATE_STYLES,
        "default_speakers": 3,
        "min_speakers": 3,
        "max_speakers": 4,
        "system_prompt_multi": DEBATE_SYSTEM_PROMPT,
        "system_prompt_solo": None,
        "output_format": "dialogue",
    },
    "talkshow": {
        "name": "脱口秀",
        "icon": "🎤",
        "desc": "单人喜剧表演",
        "modes": ["solo"],
        "roles": {"performer": "表演者"},
        "solo_styles": TALKSHOW_STYLES,
        "multi_styles": {},
        "default_speakers": 1,
        "min_speakers": 1,
        "max_speakers": 1,
        "system_prompt_multi": None,
        "system_prompt_solo": TALKSHOW_SYSTEM_PROMPT,
        "output_format": "monologue",
    },
    "xiangsheng": {
        "name": "相声",
        "icon": "🎭",
        "desc": "传统对口相声",
        "modes": ["multi"],
        "roles": {"dougen": "逗哏", "penggen": "捧哏"},
        "solo_styles": {},
        "multi_styles": XIANGSHENG_STYLES,
        "default_speakers": 2,
        "min_speakers": 2,
        "max_speakers": 2,
        "system_prompt_multi": XIANGSHENG_SYSTEM_PROMPT,
        "system_prompt_solo": None,
        "output_format": "dialogue",
    },
    "audiobook": {
        "name": "有声书",
        "icon": "📖",
        "desc": "章节式朗读",
        "modes": ["solo", "multi"],
        "roles": {"narrator": "旁白", "protagonist": "主角", "support": "配角"},
        "solo_styles": AUDIOBOOK_SOLO_STYLES,
        "multi_styles": AUDIOBOOK_MULTI_STYLES,
        "default_speakers": 1,
        "min_speakers": 1,
        "max_speakers": 4,
        "system_prompt_multi": MULTI_BOOK_SYSTEM_PROMPT,
        "system_prompt_solo": SOLO_BOOK_SYSTEM_PROMPT,
        "output_format": "mixed",  # monologue + dialogue
    },
    "radio_drama": {
        "name": "广播剧",
        "icon": "🎬",
        "desc": "多角色戏剧表演",
        "modes": ["multi"],
        "roles": {"narrator": "旁白", "protagonist": "主角", "support": "配角"},
        "solo_styles": {},
        "multi_styles": RADIO_DRAMA_STYLES,
        "default_speakers": 3,
        "min_speakers": 3,
        "max_speakers": 6,
        "system_prompt_multi": RADIO_DRAMA_SYSTEM_PROMPT,
        "system_prompt_solo": None,
        "output_format": "dialogue",
    },
    "pingshu": {
        "name": "评书",
        "icon": "📜",
        "desc": "传统评书表演",
        "modes": ["solo"],
        "roles": {"storyteller": "说书人"},
        "solo_styles": PINGSHU_STYLES,
        "multi_styles": {},
        "default_speakers": 1,
        "min_speakers": 1,
        "max_speakers": 1,
        "system_prompt_multi": None,
        "system_prompt_solo": PINGSHU_SYSTEM_PROMPT,
        "output_format": "monologue",
    },
}


def get_genre(genre_key: str) -> dict | None:
    """获取类型配置"""
    return GENRES.get(genre_key)


def list_genres() -> list[dict]:
    """列出所有可用类型(供前端下拉用)"""
    result = []
    for key, g in GENRES.items():
        result.append({
            "key": key,
            "name": g["name"],
            "icon": g["icon"],
            "desc": g["desc"],
            "modes": g["modes"],
            "default_speakers": g["default_speakers"],
            "min_speakers": g["min_speakers"],
            "max_speakers": g["max_speakers"],
            "solo_styles": {k: v["name"] for k, v in g["solo_styles"].items()},
            "multi_styles": {k: v["name"] for k, v in g["multi_styles"].items()},
        })
    return result


def build_user_prompt(genre_key: str, text: str, style: str = "",
                      num_speakers: int = 0, word_count: int = 500) -> str:
    """根据类型配置构造用户 prompt"""
    genre = get_genre(genre_key)
    if not genre:
        raise ValueError(f"未知类型: {genre_key}")

    is_solo = num_speakers <= 1
    mode = "solo" if is_solo else "multi"

    # 确定实际人数
    if num_speakers <= 0:
        num_speakers = genre["default_speakers"]
    num_speakers = max(genre["min_speakers"], min(num_speakers, genre["max_speakers"]))

    # 获取风格描述
    styles = genre["solo_styles"] if is_solo else genre["multi_styles"]
    style_desc = ""
    if style and style in styles:
        style_desc = styles[style]["desc"]
    elif styles:
        first_key = next(iter(styles))
        style_desc = styles[first_key]["desc"]

    # 角色描述
    roles = genre["roles"]
    role_names = "、".join(roles.values())

    # 构造 prompt
    type_name = genre["name"]

    if is_solo:
        return f"""请将以下文本转换为{type_name}风格的单人表演内容。

## 风格要求
{style_desc}

## 输出要求
1. 内容要有完整的结构(开场、主体、收尾)
2. 语言要口语化,适合朗读/表演
3. 每句话控制在 15-40 字
4. 【重要】总字数必须控制在 {word_count} 字左右(不少于 {max(100, word_count - 150)} 字,不超过 {word_count + 150} 字),超出或不足都不可接受
5. 如果原文较长,请提炼核心内容;如果原文较短,请适当展开
6. 直接输出内容,不要加任何标记或标签

## 原始文本
{text}"""
    else:
        # 生成角色说明
        role_desc_parts = []
        role_list = list(roles.items())
        for i, (role_key, role_name) in enumerate(role_list[:num_speakers]):
            role_desc_parts.append(f"[{role_name}]")
        role_desc = "、".join(role_desc_parts)

        return f"""请将以下文本转换为{num_speakers}人{type_name}节目。

## 风格要求
{style_desc}

## 参与角色
{role_desc}

## 输出要求
1. 必须包含完整的开场
2. 将内容分解为 3-5 个讨论/表演段落
3. 必须包含结尾
4. 每句话控制在 15-40 字
5. 【重要】总字数必须控制在 {word_count} 字左右(不少于 {max(100, word_count - 150)} 字,不超过 {word_count + 150} 字),超出或不足都不可接受
6. 如果原文较长,请提炼核心内容;如果原文较短,请适当展开
7. 直接输出对话内容,不要加任何标记或标签

## 原始文本
{text}"""


def get_system_prompt(genre_key: str, is_solo: bool) -> str:
    """获取指定类型和模式的 system prompt"""
    genre = get_genre(genre_key)
    if not genre:
        return PODCAST_SYSTEM_PROMPT

    if is_solo:
        return genre.get("system_prompt_solo") or PODCAST_SOLO_SYSTEM_PROMPT
    else:
        return genre.get("system_prompt_multi") or PODCAST_SYSTEM_PROMPT


def clean_stage_directions(text: str) -> str:
    """清理 LLM 输出中的舞台指示/动作描述
    
    移除所有括号内的表演说明,如:
    - 中文括号: （停顿）、（微笑）、（看向观众）
    - 英文括号: (pause), (smile)
    
    保留正常的括号用法(如数字标注、补充说明等)通过内容长度和关键词判断。
    """
    import re
    
    # 舞台指示关键词(出现这些词的括号内容大概率是舞台指示)
    stage_keywords = {
        # 动作
        '停顿', '微笑', '鞠躬', '点头', '摇头', '摊手', '拍桌', '指', '看', '站', '坐',
        '蹲', '跳', '走', '跑', '转身', '回头', '低头', '抬头', '俯身', '仰',
        '鼓掌', '举手', '握拳', '张开', '双手', '单手', '身体', '前倾', '后仰',
        '神秘状', '无奈', '惊讶', '生气', '开心', '难过', '严肃', '认真', '恍然大悟', '状',
        '模仿', '学', '做...状', '做...', '假装', '表演',
        # 声音
        '大声', '小声', '低声', '高声', '轻声', '悄悄', '喊', '叫', '笑', '哭',
        '叹气', '喘气', '深呼吸', '清嗓子',
        # 场景
        '面对观众', '看向', '面向', '背对', '走上台', '走下台',
        'pause', 'smile', 'look', 'gesture', 'bow', 'clap', 'stand', 'sit',
        'turn', 'whisper', 'shout', 'laugh', 'cry', 'sigh', 'breathe',
    }
    
    def is_stage_direction(content: str) -> bool:
        """判断括号内容是否是舞台指示"""
        content = content.strip()
        if not content:
            return False
        # 短内容 + 包含动作关键词 = 舞台指示
        if len(content) <= 15:
            for kw in stage_keywords:
                if kw in content:
                    return True
        # 非常短的内容(1-4字)大概率是舞台指示
        if len(content) <= 4 and not content.isdigit():
            return True
        return False
    
    # 匹配中文括号内容
    def replace_cn(m):
        inner = m.group(1)
        if is_stage_direction(inner):
            return ''
        return m.group(0)
    
    # 匹配英文括号内容
    def replace_en(m):
        inner = m.group(1)
        if is_stage_direction(inner):
            return ''
        return m.group(0)
    
    text = re.sub(r'（([^）]*)）', replace_cn, text)
    text = re.sub(r'\(([^)]*)\)', replace_en, text)
    
    # 清理多余空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 清理行首行尾多余空格
    text = re.sub(r'[ \t]+$', '', text, flags=re.MULTILINE)
    
    return text.strip()
