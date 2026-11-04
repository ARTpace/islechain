"""Normalize the deliberately small, script-free form markup contract."""

import html
from html.parser import HTMLParser

TAGS = {'div', 'span', 'p', 'label', 'input', 'select', 'option', 'textarea', 'button', 'fieldset',
        'legend', 'h2', 'h3', 'h4', 'br', 'hr', 'output', 'section', 'strong', 'small'}
ATTRIBUTES = {'class', 'title', 'type', 'min', 'max', 'step', 'placeholder', 'rows', 'cols', 'value',
              'disabled', 'data-field', 'data-action', 'aria-label'}
VOID = {'input', 'br', 'hr'}


class FormParser(HTMLParser):
    def __init__(self, fields):
        super().__init__(convert_charrefs=True)
        self.fields, self.parts, self.stack, self.count = fields, [], [], 0

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if tag not in TAGS or self.count > 300 or len(self.stack) > 20:
            raise ValueError('自定义表单只允许白名单元素，最多 300 个元素和 20 层嵌套')
        out = []
        seen = set()
        for name, value in attrs:
            if name not in ATTRIBUTES or name in seen or len(value or '') > 500:
                raise ValueError('自定义表单属性不支持或重复：' + name)
            seen.add(name)
            if name == 'data-field' and value not in self.fields:
                raise ValueError('自定义表单绑定了不存在的字段')
            if name == 'type' and value not in ('text', 'number', 'range', 'color', 'checkbox', 'button'):
                raise ValueError('自定义表单 input 类型不支持')
            out.append(f' {name}="{html.escape(value or "", quote=True)}"')
        if tag == 'button' and 'type' not in seen:
            out.append(' type="button"')
        self.parts.append('<' + tag + ''.join(out) + '>')
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            raise ValueError('自定义表单标签未正确闭合')
        self.stack.pop()
        self.parts.append('</' + tag + '>')

    def handle_data(self, data):
        self.parts.append(html.escape(data))

    def handle_decl(self, decl):
        raise ValueError('自定义表单不接受文档声明')


def normalize_form(markup, fields):
    parser = FormParser(fields)
    parser.feed(markup)
    parser.close()
    if parser.stack:
        raise ValueError('自定义表单标签未闭合')
    return ''.join(parser.parts)
