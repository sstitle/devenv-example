from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pycrdt.websocket import WebsocketServer
from pycrdt.websocket.asgi_server import ASGIServer

websocket_server = WebsocketServer()
yjs_asgi = ASGIServer(websocket_server)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with websocket_server:
        yield


app = FastAPI(lifespan=lifespan)

# Mount the Yjs ASGI server directly — handles the WebSocket protocol correctly
app.mount("/ws", yjs_asgi)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
