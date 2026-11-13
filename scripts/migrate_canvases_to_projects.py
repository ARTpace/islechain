"""Default is read-only inventory; mutations require explicitly stopped writers."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from core.canvas_store import CanvasStore
from core import canvas_migration as migration
from core.user_paths import user_data_dir


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', default=user_data_dir())
    parser.add_argument('--canvas', action='append', default=[])
    parser.add_argument('--writers-stopped', action='store_true', help='确认服务写入、在途生成及相关同步已停止')
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--apply', action='store_true')
    actions.add_argument('--verify', metavar='LOG')
    actions.add_argument('--resume', metavar='LOG')
    actions.add_argument('--rollback', metavar='LOG')
    args = parser.parse_args()
    if (args.apply or args.resume or args.rollback) and not args.writers_stopped:
        parser.error('修改前必须停止写入与相关同步，并显式传入 --writers-stopped')
    if args.apply and not args.canvas:
        parser.error('--apply 必须显式指定 --canvas 范围')
    store = CanvasStore(args.home)
    try:
        if args.verify or args.resume or args.rollback:
            record = migration.load_log(store, args.verify or args.resume or args.rollback)
            result = (migration.verify if args.verify else migration.apply if args.resume else migration.rollback)(store, record)
        else:
            ids = args.canvas or [path.stem for path in store.legacy.glob('*.json') if not store.published(path.stem)]
            records = [migration.plan(store, canvas_id) for canvas_id in ids]
            result = [migration.apply(store, record) for record in records] if args.apply else records
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (HTTPException, OSError, ValueError) as error:
        print(getattr(error, 'detail', str(error)), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
