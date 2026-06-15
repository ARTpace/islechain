/**
 * preset-types.js - 预设类型定义和工具函数
 * 
 * 支持两种预设类型：
 *   - tag: 标签预设（单个 Danbooru 标签，追加到提示词）
 *   - prompt: 风格预设（完整自然语言提示词，替换或追加）
 */

export const PresetType = {
  TAG: 'tag',
  PROMPT: 'prompt',
};

/**
 * 预设类型配置
 */
export const PRESET_TYPE_CONFIG = {
  [PresetType.TAG]: {
    label: '标签',
    icon: '🏷️',
    color: '#6366f1',    // indigo
    action: 'append',    // 默认追加到提示词
    description: '单个标签，点击追加到提示词末尾',
  },
  [PresetType.PROMPT]: {
    label: '风格',
    icon: '🎨',
    color: '#f59e0b',    // amber
    action: 'choose',    // 弹出选择：替换 or 追加
    description: '完整提示词，点击选择替换或追加',
  },
};

/**
 * 获取预设类型配置
 * @param {string} type - PresetType 值
 * @returns {object} 类型配置
 */
export function getPresetTypeConfig(type) {
  return PRESET_TYPE_CONFIG[type] || PRESET_TYPE_CONFIG[PresetType.TAG];
}

/**
 * 判断预设是否为风格类型
 * @param {object} preset - 预设对象
 * @returns {boolean}
 */
export function isStylePreset(preset) {
  return preset?.type === PresetType.PROMPT;
}

/**
 * 判断预设是否为标签类型
 * @param {object} preset - 预设对象
 * @returns {boolean}
 */
export function isTagPreset(preset) {
  return !preset?.type || preset.type === PresetType.TAG;
}

/**
 * 规范化预设 key（与后端 _normalize_key 保持一致）
 * 小写字母数字保留，其他字符替换为 _，去首尾下划线
 * @param {string} rawId
 * @returns {string}
 */
export function normalizePresetKey(rawId) {
  const raw = String(rawId).toLowerCase();
  const result = [];
  let prevUs = false;
  for (const ch of raw) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      result.push(ch);
      prevUs = false;
    } else {
      if (!prevUs) result.push('_');
      prevUs = true;
    }
  }
  return result.join('').replace(/^_+|_+$/g, '');
}

/**
 * 将完整提示词中的 {subject} 占位符替换为用户输入
 * @param {string} prompt - 含占位符的提示词
 * @param {string} subject - 用户输入的主题
 * @returns {string} 替换后的提示词
 */
export function fillSubjectPlaceholder(prompt, subject) {
  if (!prompt || !subject) return prompt || '';
  return prompt.replace(/\{subject\}/gi, subject.trim());
}

/**
 * 多语言显示名称
 * @param {object} preset - 预设对象
 * @param {string} lang - 'cn' | 'en'
 * @param {object} i18nMap - 中文名映射表
 * @returns {string}
 */
export function getDisplayLabel(preset, lang = 'en', i18nMap = {}) {
  if (lang === 'cn') {
    const key = normalizePresetKey(preset.id);
    return i18nMap[key] || preset.name || preset.id;
  }
  return preset.name || preset.id || '';
}
