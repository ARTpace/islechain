"""离线多 Agent 事件流；不读取凭据、不请求模型。"""
import json
import sys
from pathlib import Path

agent = sys.argv[1]
prompt = sys.stdin.buffer.read().decode('utf-8')
Path('agent-note.txt').write_text(agent,encoding='utf-8')
if agent == 'codex':
    events = [dict(type='thread.started',thread_id='fixture-codex'),
              dict(type='item.completed',item=dict(type='agent_message',text='移动已修复')),
              dict(type='turn.completed')]
elif agent == 'claude':
    events = [dict(type='system',session_id='fixture-claude'),
              dict(type='result',subtype='success',session_id='fixture-claude',result='增加冲刺')]
else:
    events = [dict(type='text',sessionID='fixture-opencode',part=dict(text='调整难度')),
              dict(type='step_finish',sessionID='fixture-opencode',part=dict(reason='stop'))]
if 'fixture-fail' in prompt:
    events = [dict(type='error')]
for i,event in enumerate(events):
    # 最后一行故意没有换行，覆盖流式读尾处理。
    sys.stdout.buffer.write(json.dumps(event,ensure_ascii=False).encode('utf-8')+(b'\n' if i<len(events)-1 else b''))
    sys.stdout.buffer.flush()
