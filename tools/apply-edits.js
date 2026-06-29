const fs = require('fs');
const path = 'H:/AI-Tools/art-canvas/static/app/zimage.html';
let code = fs.readFileSync(path, 'utf8');

// 1. Add script includes
code = code.replace(
  '<script src="/static/modules/random-prompt.js?v=20260629003"></script>',
  '<script src="/static/modules/random-prompt.js?v=20260629003"></script>\n    <script src="/static/modules/smart-prompt.js?v=20260629001"></script>\n    <script src="/static/modules/card-progress.js?v=20260629001"></script>\n    <script src="/static/modules/lora-manager.js?v=20260629001"></script>'
);

// 2. Remove smart-prompt-btn CSS
const cssBlocks = [
  '.smart-prompt-btn { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px; border-radius:10px; font-size:11px; font-weight:700; cursor:pointer; background:rgba(0,0,0,0.06)!important; color:#000!important; border:1px solid rgba(0,0,0,0.1); transition:all 0.2s; }\n        .smart-prompt-btn:hover { background:rgba(0,0,0,0.1)!important; transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.08); }\n        .smart-prompt-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; box-shadow:none; }\n        body.studio-theme-dark .smart-prompt-btn { background:rgba(0,240,255,0.1)!important; color:#00f0ff!important; border-color:rgba(0,240,255,0.2)!important; }\n        body.studio-theme-dark .smart-prompt-btn:hover { background:rgba(0,240,255,0.18)!important; box-shadow:0 4px 12px rgba(0,240,255,0.15); }\n        ',
  '.prompt-row .smart-prompt-btn { flex-shrink:0; }\n            ',
  '.prompt-row .smart-prompt-btn { height:28px; padding:0 10px; font-size:10px; }\n            ',
  '.prompt-row .smart-prompt-btn { padding:0 10px!important; }\n            '
];
for (const css of cssBlocks) {
  code = code.replace(css, '');
}

// 3. Replace smart prompt btn with container
code = code.replace(
  '<button onclick="smartPromptGenerate()" id="smartPromptBtn" class="smart-prompt-btn" title="智能生成标签">\n                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/></svg>\n                            <span class="btn-text">AI 生成</span>\n                        </button>',
  '<div id="smartPromptContainer"></div>'
);

// 4. Remove spPickerOpen button
code = code.replace(
  '<button onclick="spPickerOpen()" class="anima-ctrl" title="选择提示词预设" style="padding:0 8px; gap:4px;">\n                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>\n                            <span id="spCurrentLabel" class="btn-text" style="max-width:80px;overflow:hidden;text-overflow:ellipsis;">默认</span>\n                        </button>\n                        ',
  ''
);

// 5. Move randomPromptContainer to gen-row (remove from prompt-row)
code = code.replace(
  '<div id="randomPromptContainer"></div>\n                        <button onclick="document.getElementById(\'refImageInput\').click()"',
  '<button onclick="document.getElementById(\'refImageInput\').click()"'
);
// Add to gen-row before mainGenBtn
code = code.replace(
  '</div>\n                        <button id="mainGenBtn"',
  '</div>\n                        <div id="randomPromptContainer"></div>\n                        <button id="mainGenBtn"'
);

// 6. Remove quickRandomBtn HTML
code = code.replace(
  '<!-- 随机提示词：图案图标按钮 -->\n                        <button id="quickRandomBtn" onclick="quickRandomPrompt()" class="prompt-translate-corner" title="随机提示词" style="display:none;right:62px;">\n                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>\n                        </button>\n                        ',
  ''
);

// 7. Remove quickRandomPrompt function
code = code.replace(
  '// === 快速随机提示词 ===\n        function quickRandomPrompt() {\n            if (typeof RandomPrompt === \'undefined\') return;\n            RandomPrompt.quickRandom();\n        }\n\n        ',
  ''
);

// 8. Remove smartPromptGenerate function
const spStart = code.indexOf('// === 智能提示词生成 ===');
const spEnd = code.indexOf('// === 智能提示词配置（已集成到 API 设置页面） ===', spStart);
if (spStart > 0 && spEnd > 0) {
  code = code.substring(0, spStart) + code.substring(spEnd);
}

// 9. Replace progress HTML with CardProgress.HTML
const progHtmlTag = '<div class="card-progress" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">';
const progHtmlStart = code.indexOf(progHtmlTag);
const progHtmlEnd = code.indexOf('                </div>\n            `;\n            ', progHtmlStart);
if (progHtmlStart > 0 && progHtmlEnd > 0) {
  code = code.substring(0, progHtmlStart) + 'CardProgress.HTML' + code.substring(progHtmlEnd + 79);
}

// 10. Replace updateCardProgress with CardProgress.update
code = code.replace(/updateCardProgress\(/g, 'CardProgress.update(');

// 11. Remove old progress functions + add compatibility stubs
const progFuncTag = '// === 进度条 ===\n        // === 卡片内进度更新';
const progFuncStart = code.indexOf(progFuncTag);
const progFuncEnd = code.indexOf('        async function saveToUserOutput', progFuncStart);
if (progFuncStart > 0 && progFuncEnd > 0) {
  code = code.substring(0, progFuncStart) +
    '        // 兼容旧引用（空操作，进度已由 CardProgress 管理）\n' +
    '        function startProgress() {}\n        function hideProgress() {}\n' +
    '        function updateRealProgress() {}\n        function completeProgress() {}\n\n        ' +
    code.substring(progFuncEnd);
}

// 12. Add LoraManager compatibility aliases
code = code.replace(
  'localStorage.setItem("client_id", CLIENT_ID);',
  'localStorage.setItem("client_id", CLIENT_ID);\n\n' +
  '        // ── LoRA 管理器兼容别名（替换旧的内联 LoRA 代码） ──\n' +
  '        if (typeof LoraManager !== \'undefined\') {\n' +
  '            var loraState = LoraManager.state;\n' +
  '            var loadAvailableLoras = () => LoraManager.load();\n' +
  '            var updateLoraSwitcherVisibility = () => LoraManager.updateVisibility();\n' +
  '            var toggleLoraPanel = () => LoraManager.togglePanel();\n' +
  '            var injectLoraNodes = (wf) => LoraManager.injectNodes(wf);\n' +
  '            var _loraSyncTriggerWords = (arr) => LoraManager.syncTriggerWords(arr);\n' +
  '            var _loraCollectTriggerWords = (arr) => LoraManager.collectTriggerWords(arr);\n' +
  '            var extractLoraModel = (n) => LoraManager.getModel(n);\n' +
  '            var getFilteredLoras = () => LoraManager.getFiltered();\n' +
  '            var cnFolder = (n) => LoraManager.cnFolder(n);\n' +
  '            var saveLoraConfig = () => LoraManager.saveConfig();\n' +
  '            var loadLoraConfig = () => LoraManager.loadConfig();\n' +
  '            var groupLoraVersions = () => {};\n' +
  '            var _rebuildTriggerWordMap = () => {};\n' +
  '            var _loraBuildEntry = () => {};\n' +
  '            var _loraBuildManagerEntry = () => {};\n' +
  '            var _loraEnrichFromManager = () => {};\n' +
  '            var _loraFetchScanRaw = () => Promise.resolve({ paths: [], previews: {}, entries: [] });\n' +
  '            var _loraBuildScanEntries = () => [];\n' +
  '            var _loraExtractFolder = () => \'\';\n' +
  '            var _loraExtractFileName = () => \'\';\n' +
  '            var _loraIsVideoUrl = () => false;\n' +
  '            var _loraSplitPreview = () => ({ preview: \'\', videoUrl: \'\' });\n' +
  '            var _loraExtractVideoUrl = () => \'\';\n' +
  '            var LORA_NODE_BASE = 9000;\n' +
  '        }'
);

// 13. Replace old LoRA section with minimal init + kept updatePickerButtonsHighlight
const loraHdr = '        // ============================================================\n        // === LoRA 管理 ===\n        // ============================================================\n        const LORA_STORAGE_KEY = \'zimage_lora_config\';\n        const LORA_NODE_BASE = 9000;';
if (code.includes(loraHdr)) {
  const loraStart = code.indexOf(loraHdr);
  const syncStart = code.indexOf('        function syncPickerStatesFromPrompt() {', loraStart);
  if (loraStart > 0 && syncStart > 0) {
    const uphStart = code.indexOf('        function updatePickerButtonsHighlight() {', loraStart);
    const uphEnd = code.indexOf('        window.updatePickerButtonsHighlight = updatePickerButtonsHighlight;', uphStart) + 67;
    const kept = code.substring(uphStart, uphEnd);
    const before = code.substring(0, loraStart);
    const after = code.substring(syncStart);
    code = before +
      '        // ============================================================\n' +
      '        //  LoRA 管理器（已提取为独立模块 static/modules/lora-manager.js）\n' +
      '        //  兼容别名定义在脚本顶部\n' +
      '        // ============================================================\n' +
      '        if (typeof LoraManager !== \'undefined\') {\n' +
      '            LoraManager.init();\n' +
      '            const _origLoraSW = switchWorkflow;\n' +
      '            switchWorkflow = function(name) {\n' +
      '                _origLoraSW(name);\n' +
      '                LoraManager.updateVisibility();\n' +
      '            };\n' +
      '        }\n\n' +
      kept + '\n\n' +
      after;
  }
}

// 14. Add SmartPrompt.init in window.onload
code = code.replace(
  '            spPickerInit(); \n            spmInit(); ',
  '            spPickerInit(); \n            spmInit(); \n' +
  '            \n            // 初始化智能提示词组件\n' +
  '            if (typeof SmartPrompt !== \'undefined\') {\n' +
  '                const promptEl = document.getElementById(\'prompt\');\n' +
  '                SmartPrompt.init(\'smartPromptContainer\', {\n' +
  '                    getText: () => promptEl ? promptEl.value : \'\',\n' +
  '                    setText: function(text) {\n' +
  '                        if (promptEl) {\n' +
  '                            promptEl.value = text;\n' +
  '                            promptEl.dispatchEvent(new Event(\'input\'));\n' +
  '                        }\n' +
  '                    },\n' +
  '                    isIdeogram4Mode: function() {\n' +
  '                        return typeof currentWorkflow !== \'undefined\' && currentWorkflow.includes(\'Ideogram4\');\n' +
  '                    },\n' +
  '                    setIdeogram4Json: function(json) {\n' +
  '                        ideogram4JsonPrompt = json || \'\';\n' +
  '                    },\n' +
  '                    syncPicker: function() {\n' +
  '                        if (typeof syncPickerStatesFromPrompt === \'function\') syncPickerStatesFromPrompt();\n' +
  '                    },\n' +
  '                    onPromptUpdate: function() {\n' +
  '                        if (typeof updatePromptTags === \'function\') updatePromptTags();\n' +
  '                    },\n' +
  '                    onLongPress: function() {\n' +
  '                        if (typeof spPickerOpen === \'function\') spPickerOpen();\n' +
  '                    }\n' +
  '                });\n' +
  '            }'
);

// Also update handleRender() to use isRandomEnabled instead of isAutoRandomEnabled
code = code.replace(
  'RandomPrompt.isAutoRandomEnabled()',
  'RandomPrompt.isRandomEnabled()'
);

// Write output
fs.writeFileSync(path, code, 'utf8');
console.log('Done. File size:', code.length, 'chars');
