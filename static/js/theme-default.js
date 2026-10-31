/* 主题默认值 —— 全站唯一配置点。
 *
 * 页面在首屏绘制前需要一个"用户没存过主题时用哪套"的答案，各页面各写一遍容易走偏，
 * 因此统一在这里声明一次。业务代码读取时一律写成：
 *     localStorage.getItem('studio_theme') || (window.STUDIO_DEFAULT_THEME || 'dark')
 * 括号里的 'dark' 只是本文件加载失败时的兜底，正常情况下以本文件为准。
 *
 * 要改默认主题，只改下面这一行（取值 'dark' 或 'light'），不要在业务里写死。
 */
window.STUDIO_DEFAULT_THEME = 'dark';
