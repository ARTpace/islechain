"""支持 python -m dedupe_styles 调用"""
from .cli import main
import sys

if __name__ == "__main__":
    sys.exit(main())
