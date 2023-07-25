import asyncio
from aiohttp import web

callback = {}

async def handle_request(request):
    # 这里可以添加处理请求的逻辑
    data = await request.text()
    data = callback(data)
    return web.Response(body=data)

async def handle_check(request):
    data = {}
    return web.json_response(data)

async def init_app():
    app = web.Application()
    app.router.add_get('/check', handle_check)
    app.router.add_get('/msg', handle_request)
    return app

def Run():
    # 获取异步应用
    app = asyncio.run(init_app())

    # 创建服务器并启动
    web.run_app(app,host="127.0.0.1", port=8000)