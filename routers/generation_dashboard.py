"""Generation dashboard: user-isolated queries; administrators can aggregate LAN users."""
import csv
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from generation_data import store

router = APIRouter()


@router.get('/api/generation-data')
def generation_data(request: Request, token: str = '', start: str = '', end: str = '',
                    user: str = '', kind: str = '', provider: str = '', model: str = '', status: str = '',
                    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), export: bool = False):
    import main
    token = main.request_auth_token(request, token)
    username = main.require_valid_token(token)
    admin = main.is_admin_by_token(token)
    filters = dict(user=user, kind=kind, provider=provider, model=model, status=status)
    tz = timezone(timedelta(hours=8))
    try:
        if start:
            filters['start'] = datetime.strptime(start, '%Y-%m-%d').replace(tzinfo=tz).timestamp()
        if end:
            filters['end'] = (datetime.strptime(end, '%Y-%m-%d').replace(tzinfo=tz) + timedelta(days=1)).timestamp()
        if filters.get('start', 0) >= filters.get('end', float('inf')):
            raise ValueError()
    except ValueError:
        raise HTTPException(400, '日期范围无效')
    result = store().query(None if admin else username, filters, page=1 if export else page, page_size=10000 if export else page_size)
    result['scope'] = 'all' if admin else 'self'
    if not export:
        return result
    if result['summary']['total'] > 10000:
        raise HTTPException(400, '导出最多 10000 条，请缩小筛选范围')
    output = io.StringIO()
    writer = csv.writer(output)
    keys = ('id', 'user', 'kind', 'provider', 'model', 'status', 'started', 'elapsed_ms', 'output_count', 'params', 'error')
    writer.writerow(keys)
    for record in result['records']:
        values = []
        for key in keys:
            value = record[key]
            if key == 'started':
                value = datetime.fromtimestamp(value, tz).isoformat()
            if isinstance(value, dict):
                value = json.dumps(value, ensure_ascii=False)
            text = str(value if value is not None else '')
            values.append("'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text)
        writer.writerow(values)
    return Response('\ufeff' + output.getvalue(), media_type='text/csv; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename="generation-data.csv"'})
