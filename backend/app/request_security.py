"""Bound HTTP input and protect the loopback API from foreign browser sites."""
from __future__ import annotations

import re

from fastapi import HTTPException
from fastapi.responses import JSONResponse

MAX_UPLOAD_BYTES = 512 * 1024 * 1024
MAX_FORM_OVERHEAD_BYTES = 1024 * 1024
MAX_API_BODY_BYTES = 64 * 1024
LOCAL_AUTHORITY = re.compile(r'(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?', re.IGNORECASE)


class LocalRequestSecurity:
    def __init__(self, app, frontend_origins: list[str]):
        self.app = app
        self.frontend_origins = frozenset(frontend_origins)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers: dict[bytes, list[bytes]] = {}
        for key, value in scope['headers']:
            headers.setdefault(key.lower(), []).append(value)

        async def reject(status, detail):
            await JSONResponse({'detail': detail}, status_code=status)(scope, receive, send)

        hosts = headers.get(b'host', [])
        if len(hosts) != 1 or not LOCAL_AUTHORITY.fullmatch(hosts[0].decode('latin-1')):
            return await reject(400, 'Use a localhost or loopback address.')

        if scope['method'] not in {'GET', 'HEAD', 'OPTIONS'}:
            origins = headers.get(b'origin', [])
            same_origin = f"{scope['scheme']}://{hosts[0].decode('latin-1')}"
            if origins:
                if len(origins) != 1 or origins[0].decode('latin-1') not in self.frontend_origins | {same_origin}:
                    return await reject(403, 'Browser origin is not allowed.')
            elif b'cross-site' in headers.get(b'sec-fetch-site', []):
                return await reject(403, 'Cross-site requests are not allowed.')

        limit = (MAX_UPLOAD_BYTES + MAX_FORM_OVERHEAD_BYTES
                 if scope['path'] == '/api/import/upload' else MAX_API_BODY_BYTES)
        lengths = headers.get(b'content-length', [])
        if lengths:
            if len(lengths) != 1 or not lengths[0].isdigit():
                return await reject(400, 'Invalid Content-Length.')
            # Compare as decimal text first, avoiding unbounded integer conversion.
            length = lengths[0].lstrip(b'0') or b'0'
            if len(length) > len(str(limit)) or int(length) > limit:
                return await reject(413, 'Request body is too large.')
        consumed = 0

        async def bounded_receive():
            nonlocal consumed
            message = await receive()
            if message['type'] == 'http.request':
                consumed += len(message.get('body', b''))
                if consumed > limit:
                    # FastAPI preserves HTTPException during body parsing; Starlette
                    # closes partially spooled multipart files when the stream fails.
                    raise HTTPException(status_code=413, detail='Request body is too large.')
            return message

        await self.app(scope, bounded_receive, send)
