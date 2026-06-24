import ast, sys
try:
    with open('main.py', 'r', encoding='utf-8') as f:
        ast.parse(f.read())
    print('main.py: syntax OK')
except SyntaxError as e:
    print(f'SYNTAX ERROR: line {e.lineno}: {e.msg}')
    sys.exit(1)
