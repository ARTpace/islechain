"""Extract top-level object_info keys without retaining huge model option lists."""

import codecs
import json


class NodeIndex:
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder('utf-8')()
        self.depth = 0
        self.started = False
        self.in_string = False
        self.escaped = False
        self.expect_key = False
        self.capture = False
        self.key = ''
        self.names = []

    def feed(self, chunk, final=False):
        for char in self.decoder.decode(chunk, final=final):
            if not self.started:
                if char.isspace():
                    continue
                if char != '{':
                    raise ValueError('object_info 必须返回节点字典')
                self.started, self.depth, self.expect_key = True, 1, True
                continue
            if self.in_string:
                if self.capture:
                    self.key += char
                    if len(self.key) > 512:
                        raise ValueError('节点名称过长')
                if self.escaped:
                    self.escaped = False
                elif char == '\\':
                    self.escaped = True
                elif char == '"':
                    self.in_string = False
                    if self.capture:
                        self.names.append(json.loads(self.key))
                        if len(self.names) > 20000:
                            raise ValueError('节点数量超出目录上限')
                        self.expect_key = False
                continue
            if char == '"':
                self.in_string = True
                self.capture = self.depth == 1 and self.expect_key
                self.key = '"' if self.capture else ''
            elif char in '{[':
                self.depth += 1
            elif char in '}]':
                self.depth -= 1
            elif char == ',' and self.depth == 1:
                self.expect_key = True
            elif self.depth == 0 and not char.isspace():
                raise ValueError('节点目录包含额外数据')
        if final and (not self.started or self.depth != 0 or self.in_string):
            raise ValueError('节点目录响应不完整')
        return self.names
