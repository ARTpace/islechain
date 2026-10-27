const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/app/zimage.html', 'utf8');
const start = html.indexOf('            const selectionGroups =');
const end = html.indexOf("            ['pickerClose',", start);
let open = true;
const context = {
    document: { getElementById: () => ({ classList: { contains: () => open } }) },
    updatePickerButtonsHighlight() {}
};
context.window = context;
for (const prefix of ['picker', 'artistPicker', 'presetPicker']) {
    let selected = false;
    let prompt = '';
    context[prefix + 'Toggle'] = () => { selected = !selected; };
    context[prefix + 'Apply'] = () => { prompt = selected ? 'selected prompt' : ''; };
    context[prefix + 'ReadPrompt'] = () => prompt;
}
vm.runInNewContext(html.slice(start, end), context);
for (const prefix of ['picker', 'artistPicker', 'presetPicker']) {
    context[prefix + 'Toggle']();
    assert.equal(context[prefix + 'ReadPrompt'](), 'selected prompt');
    context[prefix + 'Toggle']();
    assert.equal(context[prefix + 'ReadPrompt'](), '');
    open = false;
    context[prefix + 'Toggle']();
    assert.equal(context[prefix + 'ReadPrompt'](), '');
    open = true;
}
console.log('提示词选中与取消实时应用检查通过');
