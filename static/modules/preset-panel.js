/**
 * preset-panel.js - 预设面板组件
 * 
 * 功能：
 *   - 标签预设：点击追加到提示词末尾
 *   - 风格预设：点击弹出选择菜单（替换 / 追加）
 *   - 搜索过滤
 *   - 中英文切换
 *   - 折叠/展开分类
 */

import { PresetType, getPresetTypeConfig, isStylePreset, fillSubjectPlaceholder, getDisplayLabel } from './preset-types.js';

export class PresetPanel {
  /**
   * @param {HTMLElement} container - 挂载容器
   * @param {object} options
   * @param {function} options.onApplyTag - 标签预设点击回调 (tag: string) => void
   * @param {function} options.onApplyStyle - 风格预设回调 (preset: object, action: 'replace'|'append') => void
   * @param {string} options.subject - 当前用户输入的主题（用于替换 {subject}）
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onApplyTag = options.onApplyTag || (() => {});
    this.onApplyStyle = options.onApplyStyle || (() => {});
    this.subject = options.subject || '';

    this.tagPresets = [];
    this.stylePresets = [];
    this.i18nMap = {};
    this.lang = 'cn';
    this.searchQuery = '';
    this.expandedCats = new Set();
    this.activeTab = 'style'; // 默认显示风格预设

    this._init();
  }

  async _init() {
    this._renderSkeleton();
    await this._loadData();
    this._bindEvents();
    this._render();
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="preset-panel">
        <div class="preset-header">
          <div class="preset-tabs">
            <button class="preset-tab active" data-tab="style">🎨 风格</button>
            <button class="preset-tab" data-tab="tag">🏷️ 标签</button>
          </div>
          <div class="preset-controls">
            <input type="text" class="preset-search" placeholder="搜索预设..." />
            <button class="preset-lang-btn" title="切换语言">CN/EN</button>
          </div>
        </div>
        <div class="preset-body">
          <div class="preset-list"></div>
        </div>
      </div>
    `;

    this.listEl = this.container.querySelector('.preset-list');
    this.searchEl = this.container.querySelector('.preset-search');
    this.langBtn = this.container.querySelector('.preset-lang-btn');
    this.tabs = this.container.querySelectorAll('.preset-tab');
  }

  async _loadData() {
    try {
      const [allRes, i18nRes] = await Promise.all([
        fetch('/api/all-presets').then(r => r.json()),
        fetch('/api/preset-i18n').then(r => r.json()),
      ]);
      this.tagPresets = allRes.tag_presets || [];
      this.stylePresets = allRes.style_presets || [];
      this.i18nMap = i18nRes || {};

      // 默认展开所有风格预设分类
      this.stylePresets.forEach(cat => this.expandedCats.add(cat.id));
    } catch (e) {
      console.error('[PresetPanel] load error:', e);
    }
  }

  _bindEvents() {
    // Tab 切换
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this._render();
      });
    });

    // 搜索
    this.searchEl.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this._render();
    });

    // 语言切换
    this.langBtn.addEventListener('click', () => {
      this.lang = this.lang === 'cn' ? 'en' : 'cn';
      this.langBtn.textContent = this.lang === 'cn' ? 'CN/EN' : 'EN/CN';
      this._render();
    });

    // 列表事件委托
    this.listEl.addEventListener('click', (e) => {
      const catHeader = e.target.closest('.preset-cat-header');
      if (catHeader) {
        const catId = catHeader.dataset.catId;
        if (this.expandedCats.has(catId)) {
          this.expandedCats.delete(catId);
        } else {
          this.expandedCats.add(catId);
        }
        this._render();
        return;
      }

      const presetItem = e.target.closest('.preset-item');
      if (presetItem) {
        const preset = JSON.parse(presetItem.dataset.preset || '{}');
        this._handlePresetClick(preset);
        return;
      }

      const actionBtn = e.target.closest('.preset-action-btn');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        const preset = JSON.parse(actionBtn.closest('.preset-item')?.dataset.preset || '{}');
        this._handleStyleAction(preset, action);
        return;
      }
    });
  }

  _handlePresetClick(preset) {
    if (isStylePreset(preset)) {
      this._showStyleMenu(preset);
    } else {
      this.onApplyTag(preset.prompt || preset.id);
    }
  }

  _showStyleMenu(preset) {
    // 移除旧的菜单
    const old = this.container.querySelector('.style-action-menu');
    if (old) old.remove();

    const itemEl = this.listEl.querySelector(`[data-preset-id="${preset.id}"]`);
    if (!itemEl) return;

    const menu = document.createElement('div');
    menu.className = 'style-action-menu';
    menu.innerHTML = `
      <button class="preset-action-btn" data-action="replace">📝 替换全部</button>
      <button class="preset-action-btn" data-action="append">➕ 追加到末尾</button>
    `;
    itemEl.appendChild(menu);

    // 3秒后自动消失
    setTimeout(() => menu.remove(), 3000);

    // 点击外部关闭
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 100);
  }

  _handleStyleAction(preset, action) {
    const menu = this.container.querySelector('.style-action-menu');
    if (menu) menu.remove();

    let prompt = fillSubjectPlaceholder(preset.prompt, this.subject);
    let negativePrompt = preset.negative_prompt || '';

    this.onApplyStyle({
      ...preset,
      filledPrompt: prompt,
      filledNegative: negativePrompt,
    }, action);
  }

  _render() {
    const data = this.activeTab === 'style' ? this.stylePresets : this.tagPresets;
    const filtered = this._filterData(data);

    if (filtered.length === 0) {
      this.listEl.innerHTML = `
        <div class="preset-empty">
          ${this.searchQuery ? '没有找到匹配的预设' : '暂无预设数据'}
        </div>
      `;
      return;
    }

    this.listEl.innerHTML = filtered.map(cat => this._renderCategory(cat)).join('');
  }

  _filterData(categories) {
    if (!this.searchQuery) return categories;

    return categories.map(cat => {
      const filteredSubs = cat.subcategories
        .map(sub => {
          const filteredPresets = sub.presets.filter(p => {
            const label = getDisplayLabel(p, this.lang, this.i18nMap).toLowerCase();
            const prompt = (p.prompt || '').toLowerCase();
            return label.includes(this.searchQuery) || prompt.includes(this.searchQuery);
          });
          return filteredPresets.length > 0 ? { ...sub, presets: filteredPresets } : null;
        })
        .filter(Boolean);

      return filteredSubs.length > 0 ? { ...cat, subcategories: filteredSubs } : null;
    }).filter(Boolean);
  }

  _renderCategory(cat) {
    const expanded = this.expandedCats.has(cat.id);
    const config = getPresetTypeConfig(cat.type || PresetType.TAG);
    const catLabel = this.lang === 'cn'
      ? (this.i18nMap[cat.id] || cat.name || cat.id)
      : (cat.name || cat.id);

    const subHtml = expanded
      ? cat.subcategories.map(sub => this._renderSubCategory(sub, cat.type)).join('')
      : '';

    return `
      <div class="preset-category" data-cat-id="${cat.id}">
        <div class="preset-cat-header" data-cat-id="${cat.id}">
          <span class="preset-cat-icon">${expanded ? '▼' : '▶'}</span>
          <span class="preset-cat-badge" style="background:${config.color}">${config.icon}</span>
          <span class="preset-cat-name">${catLabel}</span>
          <span class="preset-cat-count">${this._countPresets(cat)}</span>
        </div>
        ${subHtml}
      </div>
    `;
  }

  _renderSubCategory(sub, catType) {
    const subLabel = this.lang === 'cn'
      ? (this.i18nMap[sub.id] || sub.name || sub.id)
      : (sub.name || sub.id);

    return `
      <div class="preset-subcategory">
        <div class="preset-sub-name">${subLabel}</div>
        <div class="preset-items">
          ${sub.presets.map(p => this._renderPresetItem(p, catType)).join('')}
        </div>
      </div>
    `;
  }

  _renderPresetItem(preset, catType) {
    const type = preset.type || catType || PresetType.TAG;
    const config = getPresetTypeConfig(type);
    const label = getDisplayLabel(preset, this.lang, this.i18nMap);
    const desc = preset.description || '';

    return `
      <div class="preset-item" data-preset='${JSON.stringify(preset).replace(/'/g, "&#39;")}' data-preset-id="${preset.id}">
        <div class="preset-item-main">
          <span class="preset-item-dot" style="background:${config.color}"></span>
          <span class="preset-item-label">${label}</span>
          ${type === PresetType.PROMPT ? '<span class="preset-item-type-badge">完整</span>' : ''}
        </div>
        ${desc ? `<div class="preset-item-desc">${desc}</div>` : ''}
      </div>
    `;
  }

  _countPresets(cat) {
    return cat.subcategories.reduce((sum, sub) => sum + sub.presets.length, 0);
  }

  /**
   * 更新主题（用于 {subject} 占位符替换）
   */
  setSubject(subject) {
    this.subject = subject;
  }

  /**
   * 刷新数据
   */
  async refresh() {
    await this._loadData();
    this._render();
  }
}
