/**
 * LoRA 管理器（模块化版）
 * 数据管理 + 触发词同步 + 面板控制 + 工作流注入
 * 
 * 使用方法：
 *   LoraManager.init();                // 启动加载
 *   LoraManager.togglePanel();         // 打开选择器面板
 *   LoraManager.injectNodes(wf);       // 注入到工作流
 *   LoraManager.updateVisibility();    // 更新按钮显示
 *   LoraManager.syncTriggerWords();    // 同步触发词
 */
const LoraManager = (function() {

    // ─────────────────────────────────────────────
    //  常量
    // ─────────────────────────────────────────────
    const STORAGE_KEY = 'zimage_lora_config';
    const LORA_NODE_BASE = 9000;
    const LORA_EXT_RE = /\.(safetensors|ckpt|pt|bin|pth)$/i;
    const LORA_STEM_VER_RE = /[-_][vV](\d+(?:\.\d+)*)$/;
    const LORA_VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv)(\?|&|$|%|$)/i;

    // ─────────────────────────────────────────────
    //  状态
    // ─────────────────────────────────────────────
    const state = {
        loraMap: {},
        triggerWordMap: {},
        available: [],
        models: [],
        modelFilter: 'all',
        modelFilterLabel: null,
        modelFilterFolder: null,
        active: [],
        scanEntries: null,
        groups: {}
    };

    let _activeTriggerWords = new Set();

    // ─────────────────────────────────────────────
    //  工具函数
    // ─────────────────────────────────────────────
    function _extractFolder(name) {
        const parts = name.replace(/\\/g, '/').split('/');
        return parts.length > 1 ? parts[0] : '';
    }
    function _extractFileName(name) {
        return name.split('\\').pop().split('/').pop();
    }
    // 统一清理 displayName：只保留文件名（去掉路径前缀和 .safetensors 后缀）
    function _cleanDisplayName(raw) {
        if (!raw) return '';
        return raw.split(/[/\\]/).pop().replace(/\.safetensors$/i, '');
    }

    const FOLDER_CN = {
        'anima': '动画角色', 'custom_anima': '自定义动画',
        'flux1': 'FLUX1', 'flux2': 'FLUX2', 'custom_flux2': '自定义FLUX2',
        'qwen': 'Qwen', 'qwen-edit': 'Qwen编辑',
        'custom_qwen': '自定义Qwen', 'custom_qwen_edit': '自定义Qwen编辑',
        'z-image': 'Z-Image', 'zimage': 'ZImage', 'custom_zimage': '自定义ZImage',
        'recipes': '配方', 'character': '角色', 'style': '风格',
        'lighting': '光影', 'concept': '概念', 'poses': '姿势',
        'clothing': '服装', 'background': '背景', 'composition': '构图',
        'detail': '细节', 'emotion': '表情', 'hair': '发型',
        'camera': '镜头', 'texture': '材质', 'effect': '特效',
        'person': '人物', 'scene': '场景', 'animal': '动物',
        'architect': '建筑', 'food': '食物', 'vehicle': '载具',
        'fantasy': '幻想', 'sci-fi': '科幻', 'cyberpunk': '赛博朋克',
        'watercolor': '水彩', 'oil-painting': '油画', 'sketch': '素描',
        'anime': '动漫', 'realistic': '写实', '3d': '3D', '2d': '2D',
        'sd1': 'SD1.5', 'sd2': 'SD2', 'sdxl': 'SDXL', 'sd3': 'SD3',
        'flux': 'FLUX', 'lora': 'LoRA', 'embedding': 'Embedding',
        'controlnet': 'ControlNet', 'upscale': '放大', 'inpaint': '局部绘制'
    };
    function cnFolder(name) { return FOLDER_CN[name] || name; }

    function _isVideoUrl(url) {
        if (!url) return false;
        const s = String(url);
        const noQuery = s.split('?')[0];
        if (LORA_VIDEO_EXT_RE.test(noQuery)) return true;
        if (LORA_VIDEO_EXT_RE.test(s)) return true;
        try {
            const u = new URL(s, window.location.origin);
            const innerUrl = u.searchParams.get('url') || '';
            if (innerUrl) {
                const decoded = decodeURIComponent(innerUrl);
                if (LORA_VIDEO_EXT_RE.test(decoded.split('?')[0])) return true;
                if (LORA_VIDEO_EXT_RE.test(decoded)) return true;
            }
        } catch (e) {}
        return false;
    }
    function _splitPreview(proxyUrl, rawUrl) {
        if (!proxyUrl) return { preview: '', videoUrl: '' };
        return _isVideoUrl(rawUrl || proxyUrl)
            ? { preview: '', videoUrl: proxyUrl }
            : { preview: proxyUrl, videoUrl: '' };
    }

    function _buildEntry(name, fileName, previews, opts) {
        const { stripExt = false, splitPreview = false } = opts || {};
        const pv = previews[name] || previews[fileName] || '';
        const { preview, videoUrl } = splitPreview ? _splitPreview(pv, pv) : { preview: pv, videoUrl: '' };
        return {
            name,
            displayName: _cleanDisplayName(fileName),
            preview, videoUrl,
            triggerWords: [], baseModel: '', folder: _extractFolder(name)
        };
    }

    function _extractVideoUrl(civitai, fallbackRaw) {
        if (civitai && civitai.images) {
            for (const img of civitai.images) {
                if (img.type === 'video' && img.url) {
                    return img.url.startsWith('/')
                        ? `/api/lora-manager/proxy-preview?url=${encodeURIComponent(img.url)}` : img.url;
                }
            }
        }
        const raw = fallbackRaw || '';
        return raw
            ? (raw.startsWith('/') ? `/api/lora-manager/proxy-preview?url=${encodeURIComponent(raw)}` : raw) : '';
    }

    function _buildManagerEntry(m) {
        const folder = m.folder || '';
        const fileName = m.file_name || '';
        const filePath = m.file_path || '';
        const fullFileName = filePath
            ? filePath.split(/\\/).pop().split('/').pop()
            : (fileName.endsWith('.safetensors') ? fileName : fileName + '.safetensors');
        const loraName = folder ? `${folder}\\${fullFileName}` : fullFileName;
        if (!loraName) return null;
        const previewRaw = m.preview_url || '';
        const previewProxy = previewRaw
            ? `/api/lora-manager/proxy-preview?url=${encodeURIComponent(previewRaw)}` : '';
        const split = _splitPreview(previewProxy, previewRaw);
        const civitai = m.civitai;
        const triggerWords = (civitai && civitai.trainedWords && Array.isArray(civitai.trainedWords))
            ? civitai.trainedWords.slice() : [];
        const videoUrl = _extractVideoUrl(civitai, m.video_url || m.animated_preview || m.preview_video) || split.videoUrl;
        return {
            name: loraName, displayName: _cleanDisplayName(m.model_name || fileName),
            preview: split.preview, videoUrl, triggerWords,
            baseModel: m.base_model || '', tags: m.tags || '', folder
        };
    }

    function _enrichFromManager(metaItems) {
        if (!Array.isArray(metaItems)) return;
        for (const m of metaItems) {
            const folder = m.folder || '';
            const fileName = m.file_name || '';
            const filePath = m.file_path || '';
            const fullFileName = filePath
                ? filePath.split(/\\/).pop().split('/').pop()
                : (fileName.endsWith('.safetensors') ? fileName : fileName + '.safetensors');
            const key = folder ? `${folder}\\${fullFileName}` : fullFileName;
            const matchedKey = state.loraMap[key] ? key
                : (state.loraMap[fullFileName] ? fullFileName : null);
            if (!matchedKey) continue;
            const entry = state.loraMap[matchedKey];
            const previewRaw = m.preview_url || '';
            const previewProxy = previewRaw
                ? `/api/lora-manager/proxy-preview?url=${encodeURIComponent(previewRaw)}` : '';
            const split = _splitPreview(previewProxy, previewRaw);
            const civitai = m.civitai;
            const triggerWords = (civitai && civitai.trainedWords && Array.isArray(civitai.trainedWords))
                ? civitai.trainedWords.slice() : [];
            const videoUrl = _extractVideoUrl(civitai, m.video_url || m.animated_preview || m.preview_video) || split.videoUrl;
            if (split.preview) entry.preview = split.preview;
            if (videoUrl) entry.videoUrl = videoUrl;
            if (triggerWords.length) entry.triggerWords = triggerWords;
            if (m.base_model) entry.baseModel = m.base_model;
            if (m.tags) entry.tags = m.tags;
            if (m.model_name) entry.displayName = _cleanDisplayName(m.model_name);
        }
    }

    function _buildScanEntries(raw) {
        return raw.map(name => {
            const fileName = _extractFileName(name);
            const stem = fileName.replace(LORA_EXT_RE, '');
            const m = LORA_STEM_VER_RE.exec(stem);
            return { name, modelRoot: m ? stem.slice(0, m.index) : stem, versionLabel: m ? m[0].replace(/^[-_]/, '') : '' };
        });
    }

    async function _fetchScanRaw() {
        const res = await fetch('/api/loras/scan');
        if (!res.ok) return { paths: [], previews: {}, entries: [] };
        const data = await res.json();
        return { paths: data.loras || [], previews: data.previews || {}, entries: data.entries || [] };
    }

    // ─────────────────────────────────────────────
    //  重建触发词索引
    // ─────────────────────────────────────────────
    function rebuildTriggerWordMap() {
        state.triggerWordMap = {};
        if (!state.loraMap) return;
        for (const key of Object.keys(state.loraMap)) {
            const entry = state.loraMap[key];
            if (!entry || !entry.triggerWords || !entry.triggerWords.length) continue;
            for (const tw of entry.triggerWords) {
                const twLower = String(tw).toLowerCase().replace(/^@/, '');
                if (twLower && !state.triggerWordMap[twLower]) {
                    state.triggerWordMap[twLower] = {
                        preview: entry.preview || '',
                        name: entry.name,
                        displayName: _cleanDisplayName(entry.displayName) || _cleanDisplayName(entry.name)
                    };
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    //  多版本合并
    // ─────────────────────────────────────────────
    function groupVersions() {
        let entries = state.scanEntries || [];
        if (entries.length === 0 && state.loraMap) {
            const stemRe = /[-_][vV](\d+(?:\.\d+)*)$/;
            for (const name of Object.keys(state.loraMap)) {
                const fn = _extractFileName(name);
                const stem = fn.replace(LORA_EXT_RE, '');
                const m = stemRe.exec(stem);
                entries.push({
                    name,
                    modelRoot: m ? stem.slice(0, m.index) : stem,
                    versionLabel: m ? m[0].replace(/^[-_]/, '') : ''
                });
            }
        }
        state.groups = {};
        const groups = {};
        for (const e of entries) {
            const root = e.modelRoot || e.name;
            if (!groups[root]) groups[root] = [];
            groups[root].push(e);
        }
        for (const [root, vers] of Object.entries(groups)) {
            if (vers.length <= 1) continue;
            const firstEntry = vers[0];
            const meta = state.loraMap[firstEntry.name] || {};
            state.groups[root] = {
                isGroup: true, modelRoot: root,
                displayName: _cleanDisplayName(meta.displayName) || _cleanDisplayName(root),
                name: root, preview: meta.preview || '',
                videoUrl: meta.videoUrl || '',
                triggerWords: meta.triggerWords || [],
                baseModel: meta.baseModel || '',
                folder: _extractFolder(firstEntry.name),
                versions: vers.map(v => {
                    const m = state.loraMap[v.name] || {};
                    return {
                        name: v.name, label: v.versionLabel || 'v1',
                        preview: m.preview || '', videoUrl: m.videoUrl || '',
                        baseModel: m.baseModel || ''
                    };
                }),
                currentVersionIdx: 0
            };
            if (state.loraMap) {
                state.loraMap[root] = state.groups[root];
            }
        }
    }

    // ─────────────────────────────────────────────
    //  加载 LoRA（4 条回退链）
    // ─────────────────────────────────────────────
    async function load() {
        // ① ComfyUI + 本地扫描
        try {
            const res = await fetch('/api/comfyui/loras');
            if (res.ok) {
                const data = await res.json();
                const raw = data.loras || [];
                if (raw.length > 0) {
                    let scan = { paths: [], previews: {}, entries: [] };
                    try { scan = await _fetchScanRaw(); } catch (e) { console.warn('[Lora] 本地扫描失败:', e); }
                    const fileNameToFullPath = {};
                    for (const fullPath of scan.paths) {
                        const fn = fullPath.split('\\').pop();
                        if (!fileNameToFullPath[fn]) fileNameToFullPath[fn] = fullPath;
                    }
                    state.available = [];
                    state.loraMap = {};
                    for (const comfyName of raw) {
                        const fullPath = fileNameToFullPath[comfyName] || comfyName;
                        state.available.push(fullPath);
                        state.loraMap[fullPath] = _buildEntry(fullPath, comfyName, scan.previews, { stripExt: true, splitPreview: false });
                    }
                    state.available.sort();
                    state.models = [...new Set(state.available.map(n => _extractFolder(n) || '通用'))].sort();
                    groupVersions();
                    try {
                        const metaRes = await fetch('/api/lora-manager/loras');
                        if (metaRes.ok) {
                            const metaData = await metaRes.json();
                            _enrichFromManager(metaData.items || metaData.models || []);
                            rebuildTriggerWordMap();
                        }
                    } catch (e) { console.warn('[Lora] Manager 元数据补充失败:', e); }
                    return;
                }
            }
        } catch (e) { console.warn('[Lora] ComfyUI API 失败:', e); }

        // ② 本地扫描
        try {
            const scan = await _fetchScanRaw();
            if (scan.paths.length > 0) {
                state.available = scan.paths;
                state.loraMap = {};
                for (const name of scan.paths) {
                    state.loraMap[name] = _buildEntry(name, _extractFileName(name), scan.previews, { splitPreview: true });
                }
                state.models = [...new Set(scan.paths.map(n => _extractFolder(n) || '通用'))].sort();
                state.scanEntries = _buildScanEntries(scan.paths);
                groupVersions();
                rebuildTriggerWordMap();
                return;
            }
        } catch (e) { console.warn('[Lora] 本地扫描失败:', e); }

        // ③ LoRA Manager
        try {
            const res = await fetch('/api/lora-manager/loras');
            if (res.ok) {
                const data = await res.json();
                const items = data.items || data.models || [];
                if (Array.isArray(items) && items.length > 0) {
                    state.loraMap = {};
                    for (const m of items) {
                        const entry = _buildManagerEntry(m);
                        if (!entry) continue;
                        state.loraMap[entry.name] = entry;
                    }
                    state.available = Object.keys(state.loraMap).sort();
                    state.models = [...new Set(state.available.map(n => _extractFolder(n) || '通用'))].sort();
                    groupVersions();
                    rebuildTriggerWordMap();
                    return;
                }
            }
        } catch (e) { console.warn('[Lora] Manager 不可用:', e); }

        // ④ 兜底
        try {
            const scan = await _fetchScanRaw();
            if (scan.paths.length > 0) {
                state.available = scan.paths;
                state.loraMap = {};
                for (const name of scan.paths) {
                    state.loraMap[name] = _buildEntry(name, _extractFileName(name), scan.previews, { stripExt: true, splitPreview: true });
                }
                state.scanEntries = scan.entries;
                groupVersions();
                rebuildTriggerWordMap();
                state.models = [...new Set(scan.paths.map(n => _extractFolder(n) || '通用'))].sort();
                return;
            }
        } catch (e) { console.warn('[Lora] 本地扫描失败:', e); }

        try {
            const res = await fetch('/api/comfyui/loras');
            if (!res.ok) return;
            const data = await res.json();
            const raw = data.loras || [];
            state.available = raw;
            state.loraMap = {};
            const modelSet = new Set();
            for (const name of raw) {
                const folder = _extractFolder(name);
                state.loraMap[name] = { name, displayName: _cleanDisplayName(name), preview: '', videoUrl: '', triggerWords: [], baseModel: '', folder };
                modelSet.add(folder || '通用');
            }
            state.models = [...modelSet].sort();
        } catch (e) { console.warn('[Lora] 加载失败:', e); }
    }

    // ─────────────────────────────────────────────
    //  触发词收集
    // ─────────────────────────────────────────────
    function collectTriggerWords(selectedArr) {
        const words = [];
        for (const lora of (selectedArr || [])) {
            if (!lora.name) continue;
            // 跳过用户标记为"不写入触发词"的 LoRA
            if (lora.skipTriggerWord) continue;
            const meta = state.loraMap[lora.name];
            if (meta && Array.isArray(meta.triggerWords) && meta.triggerWords.length > 0) {
                // 使用 API 返回的真正的触发词（如 Civitai trainedWords）
                words.push(meta.triggerWords[0]);
            } else {
                // 无真正触发词时 fallback 到 LoRA 显示名（方便用户在提示词框看到）
                const fallbackName = (meta && meta.displayName) ? meta.displayName
                    : lora.name.split(/[/\\]/).pop().replace(/\.safetensors$/i, '');
                // 只把纯文本（不含路径分隔符的）作为 fallback，避免技术路径写入
                if (fallbackName && !fallbackName.includes('\\') && !fallbackName.includes('/')) {
                    words.push(fallbackName);
                }
            }
        }
        return words;
    }

    // ─────────────────────────────────────────────
    //  触发词同步到提示词框
    // ─────────────────────────────────────────────
    function syncTriggerWords(selectedArr) {
        const promptEl = document.getElementById('prompt');
        if (!promptEl) return;
        const newTriggerWords = collectTriggerWords(selectedArr);
        const newSet = new Set(newTriggerWords);
        const splitFn = window.splitPrompt || function(v) { return v.split(/,\s*/).filter(Boolean); };

        if (_activeTriggerWords.size > 0) {
            const parts = splitFn(promptEl.value);
            const filtered = parts.filter(p => !_activeTriggerWords.has(p.toLowerCase()));
            promptEl.value = filtered.join(', ');
        }
        if (newTriggerWords.length > 0) {
            const currentParts = splitFn(promptEl.value);
            const currentLowerSet = new Set(currentParts.map(p => p.toLowerCase()));
            const toAdd = newTriggerWords.filter(t => !currentLowerSet.has(t.toLowerCase()));
            if (toAdd.length > 0) {
                const cur = promptEl.value.trim();
                promptEl.value = cur ? cur + ', ' + toAdd.join(', ') : toAdd.join(', ');
            }
        }
        _activeTriggerWords = newSet;
        if (typeof updatePromptTags === 'function') updatePromptTags();
        if (typeof window.updatePickerButtonsHighlight === 'function') window.updatePickerButtonsHighlight();
    }

    // ─────────────────────────────────────────────
    //  面板操作
    // ─────────────────────────────────────────────
    function togglePanel() {
        _activeTriggerWords = new Set(collectTriggerWords(state.active));
        if (typeof window.loraPickerOnSelectionChange !== 'undefined') {
            window.loraPickerOnSelectionChange = function(selected) {
                syncTriggerWords(selected);
            };
        }
        if (typeof window.loraPickerOpen === 'function') {
            window.loraPickerOpen(function(selected) {
                if (typeof window.loraPickerOnSelectionChange !== 'undefined') window.loraPickerOnSelectionChange = null;
                state.active = selected;
                syncTriggerWords(selected);
                saveConfig();
                updateVisibility();
            });
        }
    }

    // ─────────────────────────────────────────────
    //  UI 可见性
    // ─────────────────────────────────────────────
    function updateVisibility() {
        const btn = document.getElementById('loraBtn');
        if (!btn) return;
        const wf = (typeof currentWorkflow !== 'undefined') ? currentWorkflow.toLowerCase() : '';
        const show = wf.includes('anima') || wf.includes('z-image') || wf.includes('z_image') || wf.includes('krea2') || wf.includes('ideogram4');
        btn.style.display = show ? '' : 'none';
        const btnText = document.getElementById('loraBtnText');
        const count = state.active.length;
        if (btnText) btnText.textContent = count > 0 ? ` LoRA(${count})` : ' LoRA';
        if (count > 0) btn.classList.add('is-in-use');
        else btn.classList.remove('is-in-use');
    }

    // ─────────────────────────────────────────────
    //  工作流注入
    // ─────────────────────────────────────────────
    function injectNodes(workflow) {
        if (!workflow) return;
        // 清理之前注入的动态节点 (ID >= LORA_NODE_BASE)
        for (const key of Object.keys(workflow)) {
            if (parseInt(key) >= LORA_NODE_BASE) delete workflow[key];
        }

        const validLoras = state.active.filter(l => l.name);
        if (validLoras.length === 0) return;

        let nextNodeId = LORA_NODE_BASE;

        // 动态查找需要注入 LoRA 的节点
        const targetClassTypes = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced'];
        const injectedNodes = new Set();

        for (const [wNodeId, node] of Object.entries(workflow)) {
            if (!node || !node.class_type || !node.inputs) continue;
            if (!targetClassTypes.includes(node.class_type)) continue;
            if (injectedNodes.has(wNodeId)) continue;

            const modelInput = node.inputs.model;
            if (!modelInput || !Array.isArray(modelInput)) continue;

            let currentModelInput = modelInput;
            for (const lora of validLoras) {
                const nid = String(nextNodeId++);
                workflow[nid] = {
                    inputs: {
                        lora_name: lora.name,
                        strength_model: lora.strength || 0.8,
                        model: currentModelInput
                    },
                    class_type: 'LoraLoaderModelOnly',
                    _meta: { title: '自定义 LoRA: ' + lora.name.split('\\').pop().split('/').pop() }
                };
                currentModelInput = [nid, 0];
            }
            node.inputs.model = currentModelInput;
            injectedNodes.add(wNodeId);
        }
    }

    // ─────────────────────────────────────────────
    //  持久化（已禁用）
    // ─────────────────────────────────────────────
    function saveConfig() {}
    function loadConfig() {}

    // ─────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────
    function init() {
        load();
        updateVisibility();
    }

    // ─────────────────────────────────────────────
    //  公开 API
    // ─────────────────────────────────────────────
    return {
        /** LoRA 状态对象（外部只读引用） */
        state,
        /** 启动加载 */
        init,
        /** 手动触发加载 */
        load,
        /** 打开 LoRA 选择器面板 */
        togglePanel,
        /** 更新按钮可见性及数量 */
        updateVisibility,
        /** 同步触发词到提示词框 */
        syncTriggerWords: (arr) => syncTriggerWords(arr),
        /** 收集当前选中 LoRA 的触发词 */
        collectTriggerWords: (arr) => collectTriggerWords(arr),
        /** 注入 LoRA 节点到工作流 */
        injectNodes,
        /** 获取筛选后的列表 */
        getFiltered: function() {
            if (!state.modelFilter || state.modelFilter === 'all') return state.available;
            return state.available.filter(n => (this.getModel(n) || '').toLowerCase() === (state.modelFilter || '').toLowerCase());
        },
        getModel: function(loraName) {
            const meta = state.loraMap[loraName];
            return meta ? meta.baseModel || _extractFolder(loraName) : _extractFolder(loraName);
        },
        setModelFilter: function(model) { state.modelFilter = model; },
        /** 工作流 → 模型文件夹映射（用于按工作流筛选兼容 LoRA） */
        workflowToFolder: function(workflowName) {
            const wf = (workflowName || '').toLowerCase();
            if (wf.includes('anima')) return 'anima';
            if (wf.includes('krea2')) return 'flux2-klein';
            if (wf.includes('ideogram4')) return 'ideogram4';
            if (wf.includes('boogu')) return 'boogu';
            if (wf.includes('zimage') || wf.includes('z-image')) return 'z-image';
            return null; // 未知工作流 → 显示全部
        },
        /** 工作流 → 显示名映射 */
        workflowToLabel: function(workflowName) {
            const wf = (workflowName || '').toLowerCase();
            if (wf.includes('anima')) return 'ANIMA';
            if (wf.includes('krea2')) return 'Krea2';
            if (wf.includes('ideogram4')) return 'Ideogram4';
            if (wf.includes('boogu')) return 'Boogu';
            if (wf.includes('zimage') || wf.includes('z-image')) return 'Z-Image';
            return null;
        },
        /** 根据当前工作流设置模型过滤 */
        setWorkflowFilter: function(workflowName) {
            const folder = this.workflowToFolder(workflowName);
            state.modelFilter = folder || 'all';
            state.modelFilterLabel = this.workflowToLabel(workflowName) || '全部';
            state.modelFilterFolder = folder;
        },
        cnFolder,
        saveConfig,
        loadConfig
    };
})();
