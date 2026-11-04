/* 三视图 · 声明式配置
 * ------------------------------------------------------------------
 * 只放「数据」，不放逻辑。接新模型 / 新工作流只改这个文件：
 *   1) 在 TV_ENGINES 里加一项（label / workflow / views / defaults / supports / nodeMap）
 *   2) UI 会自动多出一个菜单项，参数面板按 supports 自动显隐
 * 页面代码里不许出现节点 id 字面量，也不许写死张数（一律读 views.length）。
 */

/* 预设提示词：界面上不暴露提示词，用户只选预设。
 * prompts 是按视角顺序的数组，长度必须与该引擎的 views 一致
 * （不要用 {front, side, back} 对象，四视角引擎会没法用）。
 */
window.TV_PRESETS = {
    white: {
        badge: '全身白底',
        tip: '纯白背景全身站姿，三视角提示词已内置',
        prompts: [
            '创建该角色的正视图，纯白色背景上的全身站姿，双眼平视镜头，双臂自然下垂。严格保持参考图人物的面部五官、发色发型、服装款式与材质、身体纹样完全一致。一致的照明和风格，没有背景噪音，没有阴影。',
            '创建该角色的右侧面视图，纯白色背景上的全身站姿，身体朝向画面右侧。严格保持参考图人物的面部五官、发色发型、服装款式与材质、身体纹样完全一致。双臂自然下垂，不要抬手臂。一致的照明和风格，没有背景噪音，没有阴影。',
            '创建该角色的背视图，纯白色背景上的全身站姿，背对镜头，身形挺直。双臂自然下垂贴在身体两侧，双手垂在身后，不要抬手臂。严格保持参考图人物的发型、服装背面款式与材质、身体纹样完全一致。一致的照明和风格，没有背景噪音，没有阴影。'
        ]
    },
    sheet: {
        badge: '设定图灰底',
        tip: '浅灰棚拍背景 + 柔和顶光，适合做角色设定稿',
        prompts: [
            '创建该角色的正视图，浅灰色棚拍背景上的全身站姿，柔和顶光，双眼平视镜头，双臂自然下垂。严格保持参考图人物的面部五官、发色发型、服装款式与材质、身体纹样完全一致。干净的影棚照明，没有背景杂物。',
            '创建该角色的右侧面视图，浅灰色棚拍背景上的全身站姿，身体朝向画面右侧，柔和顶光。严格保持参考图人物的面部五官、发色发型、服装款式与材质、身体纹样完全一致。双臂自然下垂，不要抬手臂。干净的影棚照明，没有背景杂物。',
            '创建该角色的背视图，浅灰色棚拍背景上的全身站姿，背对镜头，身形挺直，柔和顶光。双臂自然下垂贴在身体两侧，不要抬手臂。严格保持参考图人物的发型、服装背面款式与材质、身体纹样完全一致。干净的影棚照明，没有背景杂物。'
        ]
    }
};

/* 生成引擎注册表。字段约定：
 *   label      菜单显示名
 *   model      徽章 + 历史记录里的模型名
 *   workflow   工作流 JSON 路径（放 /static/app/ 下，换工作流不用动 HTML）
 *   views      输出视角标签数组 → 决定张数、进度分档、输出摘要
 *   defaults   参数默认值（引擎各自的推荐档位）
 *   supports   能力开关 → 对应参数控件自动显隐（不用改 DOM）
 *   note       菜单项副标题（速度 / 显存 / 适用场景）
 *   secPerStep 每张每步大约几秒 → 只用来算界面上的「约 X 秒」，不参与提交
 *   presets    该引擎可用的预设（可共享 TV_PRESETS）
 *   nodeMap    唯一与具体工作流耦合的地方
 *     image        参考图 LoadImage 节点
 *     promptNodes  按 views 顺序的正面提示词节点
 *     samplerNodes 按 views 顺序的采样节点（进度分档用）
 *     outputNodes  按 views 顺序的 SaveImage 节点
 *     lora         一致性 LoRA 的 LoraLoader 节点（无则 null）
 *     scale        宽高生效的节点（无则 null）
 */
window.TV_ENGINES = {
    'qwen21-multiview': {
        label: 'Qwen-Image-2.1 · 多视角',
        model: 'Qwen-Image-2.1',
        workflow: '/static/app/threeview.workflow.json?v=20261103b',
        views: ['正视图', '侧视图', '背视图'],
        /* 1024×1536 是实测的清晰度拐点：同一张参考图、同一 seed，
         * 832×1216 + 4 步 turbo（锐度 10.5）→ 1024×1536（锐度 17.4，+66%），
         * 而 8 步 + turbo 0.7 只到 14.1 且耗时翻倍。所以尺寸优先、步数不加。
         * 再往上 1024→1280 收益递减，显存和时间翻倍，不划算。 */
        defaults: { consistency: 0.85, steps: 4, width: 1024, height: 1536, seed: 1234567 },
        supports: { consistency: true, steps: true, size: true, seed: true },
        note: '单图推 3 视角 · 4 步 turbo · 约 150 秒',
        secPerStep: 12.5,   // 1024×1536 每步每张约 12.5 秒，4 步 × 3 视角 ≈ 150 秒
        presets: window.TV_PRESETS,
        nodeMap: {
            image: '8',
            promptNodes: ['100', '110', '120'],
            samplerNodes: ['102', '112', '122'],
            outputNodes: ['104', '114', '124'],
            lora: '2',
            scale: '11'
        }
    }
    // 新增引擎示例（配置好 workflow 与 nodeMap 后取消注释即可出现在菜单里）：
    // 'trellis-multiview': {
    //     label: 'Trellis2 · 多视角重建',
    //     model: 'Trellis2',
    //     workflow: '/static/app/trellis.workflow.json',
    //     views: ['正视图', '侧视图', '背视图', '四分之三侧'],
    //     defaults: { steps: 20, width: 1024, height: 1024, seed: 1234567 },
    //     supports: { consistency: false, steps: true, size: true, seed: true },
    //     note: '多视角一致性重建 · 20 步 · 约 3 分钟',
    //     presets: window.TV_PRESETS,
    //     nodeMap: { image: '1', promptNodes: [], samplerNodes: [], outputNodes: ['9'], lora: null, scale: '5' }
    // }
};
