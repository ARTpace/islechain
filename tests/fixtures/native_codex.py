"""Offline Codex JSONL protocol fixture; no model calls or authentication."""
import json
import sys
from pathlib import Path

prompt = sys.stdin.buffer.read().decode('utf-8')
print(json.dumps(dict(type='thread.started', thread_id='fixture-session')), flush=True)
Path('src').mkdir(exist_ok=True)
Path('src/agent.ts').write_text('export const score = 1;\n', encoding='utf-8')
print(json.dumps(dict(type='turn.failed' if 'fixture-fail' in prompt else 'turn.completed')), flush=True)
