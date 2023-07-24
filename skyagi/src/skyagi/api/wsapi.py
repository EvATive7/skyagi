import websockets
import json

server = {}
callbacks = []
canInteractData=json.dumps({"type":"inform","content":"started"})

async def handle_client(ws,path):
    async for message in ws:
        print(f"Received message: {message}")
        response = f"Server received: {message}"
        await ws.send(response)

async def startWebSocket():
    server = await websockets.serve(handle_client, "localhost", 8765)
    print("WebSocket API server started at ws://localhost:8765")
    await server.wait_closed()
    
def CallCallbacks():
    for callback_func in callbacks:
        callback_func()

def AppendCallback(cbk):
    callbacks.append(cbk)
    
def SendCanInteractData():
    server.send(canInteractData)